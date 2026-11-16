// @vitest-environment jsdom
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, test, vi } from "vitest";
import i18n from "@/shared/i18n";
import type { ChatToolTraceEntry } from "../core";
import { UChatToolTrace } from "./UChatToolTrace";
import {
  formatBrowserUrlForDisplay,
  visibleChatToolTraceEntries,
} from "./browserToolTrace";

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});

afterAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

test("UChatToolTrace renders a collapsed summary and expandable details", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "search-1",
          toolName: "web_search",
          status: "requested",
          input: {
            query: "今天是什么日期",
          },
        },
        {
          toolCallId: "search-1",
          toolName: "web_search",
          status: "succeeded",
          input: {
            query: "今天是什么日期",
          },
          output: {
            provider: "searxng",
            results: [{ title: "Today" }, { title: "Calendar" }],
          },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Tool Calls"));
  assert.ok(screen.getByText("web_search"));
  assert.ok(screen.getByText("Succeeded"));
  assert.ok(screen.getByText("web_search completed · searxng · 2"));

  fireEvent.click(screen.getByRole("button", { name: "Show details" }));

  assert.equal(screen.getAllByText("Call ID: search-1").length, 2);
  assert.ok(screen.getAllByText("Input").length >= 1);
  assert.ok(screen.getByText("Output"));
  assert.equal(screen.getAllByText(/今天是什么日期/).length, 2);
});

test("UChatToolTrace surfaces failure details", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "search-2",
          toolName: "web_search",
          status: "failed",
          errorMessage: "SearXNG returned no usable results.",
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Failed"));
  assert.ok(screen.getByText("SearXNG returned no usable results."));

  fireEvent.click(screen.getByRole("button", { name: "Show details" }));

  assert.ok(screen.getByText("Error"));
});

test("UChatToolTrace keeps non-Browser traces on the generic presentation", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "search-3",
          toolName: "web_search",
          status: "succeeded",
          output: { provider: "tavily", results: [{ title: "Today" }] },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Tool Calls"));
  assert.equal(screen.queryByText("Managed Browser"), null);
  assert.ok(screen.getByText("web_search completed · tavily · 1"));
});

test("touch-realm browser_attached tools keep the generic Trace presentation", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "attached-1",
          toolName: "browser_attached_look",
          status: "succeeded",
          output: { url: "https://example.com/?token=raw-token" },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Tool Calls"));
  assert.equal(screen.queryByText("Managed Browser"), null);
  assert.ok(screen.getByText("browser_attached_look"));
});

test("UChatToolTrace renders a Browser request without claiming page completion", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "browser-1",
          toolName: "browser_navigate",
          status: "requested",
          input: {
            url: "https://user:secret@example.com/search?token=raw-token#fragment",
          },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Managed Browser"));
  assert.ok(screen.getByText("Open page"));
  assert.ok(screen.getByText("Requested"));
  assert.ok(screen.getByText("Target: https://example.com/search"));
  assert.equal(screen.queryByText(/raw-token/), null);
  assert.equal(screen.queryByText("browser_navigate"), null);

  fireEvent.click(screen.getByRole("button", { name: "Show details" }));
  assert.ok(screen.getByText("browser_navigate"));
});

test("UChatToolTrace shows Browser page identity after a real observation", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "browser-2",
          toolName: "browser_snapshot",
          status: "succeeded",
          output: {
            ok: true,
            page: {
              url: "https://example.com/docs?token=raw-token",
              title: "Example Docs",
              snapshotHash: "hash-1",
            },
            observation: {
              snapshot: "- heading Example",
              truncated: true,
            },
            artifacts: [],
          },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Observe page"));
  assert.ok(screen.getByText("Succeeded"));
  assert.ok(
    screen.getByText("Page: Example Docs · https://example.com/docs"),
  );
  assert.equal(screen.queryByText(/raw-token/), null);
});

test("a Browser ok:false result is shown as failed instead of succeeded", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "browser-3",
          toolName: "browser_click",
          status: "succeeded",
          output: {
            ok: false,
            page: { url: "https://example.com/", title: "Example Domain" },
            artifacts: [],
            error: {
              code: "stale_snapshot",
              message: "The observed ref is stale. Observe the page again.",
              retryable: true,
            },
          },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Click element"));
  assert.ok(screen.getByText("Failed"));
  assert.equal(screen.queryByText("Succeeded"), null);
  assert.ok(
    screen.getByText(
      "stale_snapshot: The observed ref is stale. Observe the page again.",
    ),
  );
});

test("a Browser approval wait stays pending and does not add approval controls", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "browser-4",
          toolName: "browser_click",
          status:
            "awaiting_approval" as unknown as ChatToolTraceEntry["status"],
          input: {
            pageUrl: "https://example.com/",
            snapshotHash: "hash-1",
            ref: "e2",
          },
          errorMessage: "browser_click requires approval before execution.",
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Awaiting approval"));
  assert.ok(
    screen.getByText("browser_click requires approval before execution."),
  );
  assert.equal(screen.queryByRole("button", { name: "Approve" }), null);
  assert.equal(screen.queryByRole("button", { name: "Reject" }), null);
});

test("malformed and missing Browser fields render safely", () => {
  render(
    <UChatToolTrace
      entries={[
        {
          toolName: "browser_snapshot",
          status: "succeeded",
          output: null,
        },
        {
          toolCallId: "browser-5",
          toolName: "browser_click",
          status: "running",
          input: { pageUrl: 42 } as unknown as Record<string, unknown>,
          output: "not-a-structured-result",
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Click element"));
  assert.ok(screen.getByText("Running"));
  assert.equal(screen.queryByText(/42/), null);
});

test("a Browser screenshot without an authorized preview URL shows Artifact identity only", () => {
  const { container } = render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "browser-6",
          toolName: "browser_screenshot",
          status: "succeeded",
          output: {
            ok: true,
            page: { url: "https://example.com/", title: "Example Domain" },
            artifacts: [
              {
                id: "shot-1",
                kind: "screenshot",
                title: "Browser screenshot",
                uri: "C:\\Users\\mira\\artifacts\\shot-1.png",
              },
            ],
          },
        },
      ]}
    />,
  );

  assert.ok(screen.getByText("Capture screenshot"));
  assert.ok(screen.getByText(/Screenshot preview unavailable/));
  assert.equal(screen.queryByText(/shot-1\.png/), null);
  assert.equal(container.querySelector("img"), null);

  fireEvent.click(screen.getByRole("button", { name: "Show details" }));
  assert.ok(screen.getByText("Artifact: shot-1"));
  assert.ok(screen.getAllByText("Screenshot preview unavailable").length >= 1);
  assert.equal(container.querySelector("img"), null);
});

test("a Browser screenshot with an authorized preview URL opens the existing image preview", () => {
  const onPreviewImage = vi.fn();
  render(
    <UChatToolTrace
      entries={[
        {
          toolCallId: "browser-7",
          toolName: "browser_screenshot",
          status: "succeeded",
          output: {
            ok: true,
            page: { url: "https://example.com/", title: "Example Domain" },
            artifacts: [
              {
                id: "shot-2",
                kind: "screenshot",
                title: "Browser screenshot",
                uri: "/attachments/shot-2.png",
              },
            ],
          },
        },
      ]}
      resolveAttachmentSource={(value) => `http://127.0.0.1:3000${value}`}
      onPreviewImage={onPreviewImage}
    />,
  );

  assert.equal(screen.queryByText("Screenshot preview unavailable"), null);

  fireEvent.click(screen.getByRole("button", { name: "Show details" }));
  const image = screen.getByAltText("Browser screenshot");
  assert.equal(
    image.getAttribute("src"),
    "http://127.0.0.1:3000/attachments/shot-2.png",
  );

  fireEvent.click(screen.getByRole("button", { name: "Open screenshot preview" }));
  assert.equal(onPreviewImage.mock.calls.length, 1);
  assert.equal(
    onPreviewImage.mock.calls[0]?.[0],
    "http://127.0.0.1:3000/attachments/shot-2.png",
  );
});

test("Browser trace remains available alongside canonical execution-node events", () => {
  const entries: ChatToolTraceEntry[] = [
    { toolName: "web_search", status: "succeeded" },
    { toolName: "browser_snapshot", status: "succeeded" },
    { toolName: "browser_attached_look", status: "succeeded" },
    { toolName: "browser_click", status: "failed" },
  ];
  assert.deepEqual(
    visibleChatToolTraceEntries(entries, true).map((entry) => entry.toolName),
    ["browser_snapshot", "browser_click"],
  );
  assert.deepEqual(visibleChatToolTraceEntries(entries, false), entries);
});

test("arbitrary remote and data screenshot URIs never become image preview sources", () => {
  const { container } = render(
    <UChatToolTrace entries={[{
      toolCallId: "browser-remote-screenshot",
      toolName: "browser_screenshot",
      status: "succeeded",
      output: {
        ok: true,
        artifacts: [
          { id: "remote", kind: "screenshot", uri: "https://untrusted.invalid/x.png" },
          { id: "inline", kind: "screenshot", uri: "data:image/png;base64,AAAA" },
          { id: "local", kind: "screenshot", uri: "file:///tmp/x.png" },
        ],
      },
    }]} />,
  );

  assert.equal(container.querySelector("img"), null);
  fireEvent.click(screen.getByRole("button", { name: "Show details" }));
  assert.equal(container.querySelector("img"), null);
  assert.equal(screen.getAllByText("Screenshot preview unavailable").length >= 1, true);
});

test("formatBrowserUrlForDisplay strips credentials, query tokens and fragments", () => {
  assert.equal(
    formatBrowserUrlForDisplay(
      "https://user:secret@example.com/private?token=raw#fragment",
    ),
    "https://example.com/private",
  );
  assert.equal(formatBrowserUrlForDisplay("file:///tmp/private.txt"), "");
  assert.equal(formatBrowserUrlForDisplay("unparseable-user:pass@domain?token=secret"), "");
});
