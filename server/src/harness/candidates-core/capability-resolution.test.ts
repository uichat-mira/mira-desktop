import { describe, expect, it, vi } from "vitest";
import {
  lexicalSearchCapabilities,
  resolveCapabilityCascade,
  type CapabilityResolutionDocument,
} from "./capability-resolution.js";

const doc = (
  overrides: Partial<CapabilityResolutionDocument> & {
    capabilityId: string;
  },
): CapabilityResolutionDocument => ({
  title: overrides.capabilityId,
  description: "",
  domain: "read",
  tags: [],
  toolIds: [overrides.capabilityId],
  aliases: [overrides.capabilityId],
  ...overrides,
});

describe("deterministic-first capability resolution cascade", () => {
  it("resolves an exact known Tool without Tool Search", async () => {
    const capabilities = [
      doc({ capabilityId: "web_search", domain: "web_search", tags: ["web"] }),
      doc({ capabilityId: "read" }),
    ];

    const result = await resolveCapabilityCascade({
      query: "please look this up",
      capabilities,
      knownCapabilityId: "web_search",
    });

    expect(result.path).toBe("exact");
    expect(result.selectedCapabilityId).toBe("web_search");
    expect(result.trace.modelCalls).toBe(0);
    expect(result.trace.semanticAttempted).toBe(false);
  });

  it("resolves an exact canonical capability named in the query", async () => {
    const capabilities = [
      doc({ capabilityId: "web_search", domain: "web_search", tags: ["web"] }),
      doc({ capabilityId: "read" }),
    ];

    const result = await resolveCapabilityCascade({
      query: "please use web_search for this",
      capabilities,
    });

    expect(result.path).toBe("exact");
    expect(result.selectedCapabilityId).toBe("web_search");
    expect(result.trace.modelCalls).toBe(0);
  });

  it("resolves a clear capability/domain case structurally without a semantic model call", async () => {
    const capabilities = [
      doc({
        capabilityId: "terminal_execution",
        domain: "terminal",
        tags: ["terminal", "shell", "command", "process"],
      }),
      doc({
        capabilityId: "workspace_edit",
        domain: "edit",
        tags: ["workspace", "edit", "write"],
      }),
      doc({
        capabilityId: "web",
        domain: "web_search",
        tags: ["web", "search", "public"],
      }),
    ];
    const semanticResolver = vi.fn(async () => "workspace_edit");

    const result = await resolveCapabilityCascade({
      query: "run a terminal command",
      capabilities,
      semanticResolver,
    });

    expect(result.path).toBe("structural");
    expect(result.selectedCapabilityId).toBe("terminal_execution");
    expect(result.trace.modelCalls).toBe(0);
    expect(result.trace.semanticAttempted).toBe(false);
    expect(semanticResolver).not.toHaveBeenCalled();
  });

  it("locates a correct Tool outside the first-20 window via lexical lookup", async () => {
    const capabilities = Array.from({ length: 30 }, (_, index) =>
      doc({
        capabilityId: `capability_${index}`,
        description: "generic capability",
        tags: ["noise"],
      }),
    );
    capabilities[25] = doc({
      capabilityId: "capability_25",
      description: "Handles the zephyrix ingestion pipeline",
      tags: ["ingest"],
    });

    const result = await resolveCapabilityCascade({
      query: "zephyrix",
      capabilities,
    });

    expect(result.path).toBe("lexical");
    expect(result.selectedCapabilityId).toBe("capability_25");
    expect(result.trace.modelCalls).toBe(0);
    expect(result.trace.semanticAttempted).toBe(false);
    // The correct Tool is far beyond the historical deterministic first 20.
    const rank = capabilities.findIndex(
      (candidate) => candidate.capabilityId === result.selectedCapabilityId,
    );
    expect(rank).toBeGreaterThanOrEqual(20);
  });

  it("makes deterministic BM25 lookup available without vector infrastructure", () => {
    const capabilities = [
      doc({
        capabilityId: "news_research",
        domain: "web_search",
        tags: ["news", "headline"],
        description: "Search the local news cache.",
      }),
      doc({ capabilityId: "read", description: "Read workspace files." }),
    ];

    const result = lexicalSearchCapabilities({
      query: "latest news headline",
      capabilities,
      minScore: 0.5,
    });

    expect(result.candidates[0]?.capabilityId).toBe("news_research");
    expect(result.confident).toBe(true);
  });

  it("invokes the semantic Resolver only for genuine ambiguity", async () => {
    const capabilities = [
      doc({
        capabilityId: "alpha",
        description: "zephyrix handler",
        tags: ["alpha"],
      }),
      doc({
        capabilityId: "beta",
        description: "zephyrix handler",
        tags: ["beta"],
      }),
      doc({
        capabilityId: "gamma",
        description: "unrelated",
        domain: "web_search",
        tags: ["gamma"],
      }),
    ];
    const semanticResolver = vi.fn(async () => "beta");

    const result = await resolveCapabilityCascade({
      query: "zephyrix alpha beta gamma delta",
      capabilities,
      semanticResolver,
    });

    expect(result.path).toBe("semantic");
    expect(result.selectedCapabilityId).toBe("beta");
    expect(result.trace.modelCalls).toBe(1);
    expect(result.trace.ambiguous).toBe(true);
    expect(semanticResolver).toHaveBeenCalledTimes(1);
  });

  it("stops transparently on a no-match without spending a model call", async () => {
    const capabilities = [
      doc({ capabilityId: "read", tags: ["workspace"] }),
      doc({ capabilityId: "write", domain: "edit", tags: ["workspace"] }),
    ];
    const semanticResolver = vi.fn(async () => "read");

    const result = await resolveCapabilityCascade({
      query: "zzzzqqqq",
      capabilities,
      semanticResolver,
    });

    expect(result.path).toBe("none");
    expect(result.selectedCapabilityId).toBeNull();
    expect(result.trace.modelCalls).toBe(0);
    expect(result.trace.semanticAttempted).toBe(false);
    expect(semanticResolver).not.toHaveBeenCalled();
  });

  it("stops transparently when the requested domain is unavailable in scope", async () => {
    const capabilities = [
      doc({ capabilityId: "read", tags: ["workspace"] }),
      doc({ capabilityId: "write", domain: "edit", tags: ["workspace"] }),
    ];

    const result = await resolveCapabilityCascade({
      query: "send an email to the whole team",
      capabilities,
    });

    expect(result.path).toBe("none");
    expect(result.selectedCapabilityId).toBeNull();
    expect(result.trace.modelCalls).toBe(0);
  });

  it("bounds and traces wrong-domain recovery across the semantic stage", async () => {
    const capabilities = [
      doc({
        capabilityId: "terminal_execution",
        domain: "terminal",
        tags: ["terminal"],
      }),
      doc({
        capabilityId: "mail_reading",
        domain: "read",
        tags: ["inbox"],
        description: "zephyrix mailbox reader",
      }),
    ];
    const semanticResolver = vi.fn(async () => "mail_reading");

    const result = await resolveCapabilityCascade({
      query: "zephyrix terminal alpha beta",
      capabilities,
      semanticResolver,
      minLexicalScore: 5,
    });

    expect(result.path).toBe("semantic");
    expect(result.selectedCapabilityId).toBe("mail_reading");
    expect(result.trace.domainHint).toBe("terminal");
    expect(result.trace.selectedDomain).toBe("read");
    expect(result.trace.wrongDomainRecovered).toBe(true);
    expect(result.trace.modelCalls).toBe(1);
    expect(semanticResolver).toHaveBeenCalledTimes(1);
  });

  it("never manufactures a selection for an unknown or out-of-scope capability", async () => {
    const capabilities = [doc({ capabilityId: "read", tags: ["workspace"] })];
    const semanticResolver = vi.fn(async () => "not_registered");

    const result = await resolveCapabilityCascade({
      query: "zephyrix",
      capabilities,
      knownCapabilityId: "not_registered",
      semanticResolver,
    });

    expect(result.selectedCapabilityId).toBeNull();
    expect(result.path).toBe("none");
    // An id the Resolver hallucinates outside the shortlist is never selected.
    expect(semanticResolver).not.toHaveBeenCalled();
  });

  it("honours the semantic call budget seam", async () => {
    const capabilities = [
      doc({ capabilityId: "alpha", description: "zephyrix handler", tags: ["alpha"] }),
      doc({ capabilityId: "beta", description: "zephyrix handler", tags: ["beta"] }),
    ];
    const semanticResolver = vi.fn(async () => "beta");

    const result = await resolveCapabilityCascade({
      query: "zephyrix alpha beta gamma delta",
      capabilities,
      semanticResolver,
      budget: { maxSemanticCalls: 0 },
    });

    expect(result.path).toBe("ambiguous");
    expect(result.trace.modelCalls).toBe(0);
    expect(result.trace.semanticAttempted).toBe(false);
    expect(semanticResolver).not.toHaveBeenCalled();
  });
});
