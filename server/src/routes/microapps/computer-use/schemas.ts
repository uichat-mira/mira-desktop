import {
  errorEnvelope,
  successEnvelope,
} from "@/routes/schema-helpers.js";

const runtimeStatusValues = [
  "ready",
  "not_installed",
  "downloading",
  "broken",
] as const;

const browserEngineValues = ["chromium", "chrome", "edge"] as const;

const debuggerSessionParams = { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", minLength: 1 } } } as const;
const debuggerSessionConfig = {
  type: "object",
  required: ["runtime", "url", "allowedDomains", "limits", "approvalPolicy"],
  additionalProperties: false,
  properties: {
    runtime: { type: "string", enum: ["managed", "system"] },
    url: { type: "string", minLength: 1 },
    allowedDomains: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    limits: { type: "object", required: ["timeoutMs", "maxSnapshotChars"], additionalProperties: false, properties: { timeoutMs: { type: "integer", minimum: 1 }, maxSnapshotChars: { type: "integer", minimum: 100 } } },
    approvalPolicy: { type: "string", enum: ["always", "write_actions", "never"] },
  },
} as const;
const debuggerAction = {
  type: "object", required: ["pageUrl", "snapshotHash", "action"], additionalProperties: false,
  properties: {
    pageUrl: { type: "string", minLength: 1 }, snapshotHash: { type: "string", minLength: 1 },
    // MCP owns the strict action union. Keeping this route-level object open
    // prevents Fastify/Ajv from deleting fields while trying oneOf branches.
    action: { type: "object", additionalProperties: true },
  },
} as const;
const debuggerAssertion = {
  type: "object", required: ["assertion"], additionalProperties: false,
  properties: { assertion: { oneOf: [
    { type: "object", required: ["kind", "expected"], additionalProperties: false, properties: { kind: { enum: ["title", "url", "text"] }, expected: { type: "string" } } },
    { type: "object", required: ["kind", "ref"], additionalProperties: false, properties: { kind: { const: "visible" }, ref: { type: "string", minLength: 1 } } },
    { type: "object", required: ["kind", "ref", "expected"], additionalProperties: false, properties: { kind: { const: "value" }, ref: { type: "string", minLength: 1 }, expected: { type: "string" } } },
  ] } },
} as const;

const looseObjectSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const runtimeStateSchema = {
  type: "object",
  required: ["status", "checkedAt"],
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: runtimeStatusValues },
    browserEngine: { type: "string", enum: browserEngineValues },
    version: { type: "string" },
    message: { type: "string" },
    checkedAt: { type: "string", format: "date-time" },
    details: looseObjectSchema,
  },
} as const;

const installRuntimeBodySchema = {
  type: "object",
  additionalProperties: false,
    properties: {
      version: { type: "string" },
      archiveUrl: { type: "string", minLength: 1 },
      executableRelativePath: { type: "string", minLength: 1 },
      expectedSha256: { type: "string" },
      force: { type: "boolean" },
    },
} as const;

export const computerUseRouteSchemas = {
  debuggerCreateSession: { tags: ["MicroAPP"], summary: "Create a Computer Use debugger browser session", body: debuggerSessionConfig },
  debuggerSession: { tags: ["MicroAPP"], summary: "Get a Computer Use debugger browser session", params: debuggerSessionParams },
  debuggerAction: { tags: ["MicroAPP"], summary: "Execute a structured Computer Use browser action", params: debuggerSessionParams, body: debuggerAction },
  debuggerAssertion: { tags: ["MicroAPP"], summary: "Assert structured Computer Use browser state", params: debuggerSessionParams, body: debuggerAssertion },
  debuggerArtifact: { tags: ["MicroAPP"], summary: "Read a Computer Use browser artifact", params: { type: "object", required: ["id", "artifactId"], additionalProperties: false, properties: { id: { type: "string", minLength: 1 }, artifactId: { type: "string", minLength: 1 } } } },
  debuggerApproval: { tags: ["MicroAPP"], summary: "Approve a pending Computer Use browser action", params: debuggerSessionParams, body: { type: "object", required: ["invocationId"], additionalProperties: false, properties: { invocationId: { type: "string", minLength: 1 } } } },
  debuggerRejectApproval: { tags: ["MicroAPP"], summary: "Reject a pending Computer Use browser action", params: debuggerSessionParams, body: { type: "object", required: ["invocationId"], additionalProperties: false, properties: { invocationId: { type: "string", minLength: 1 }, reason: { type: "string" } } } },
  getRuntime: {
    tags: ["MicroAPP"],
    summary: "Get computer use runtime state",
    security: [{ bearerAuth: [] }],
    response: {
      200: successEnvelope(runtimeStateSchema),
      401: errorEnvelope,
      500: errorEnvelope,
    },
  },
  installRuntime: {
    tags: ["MicroAPP"],
    summary: "Install managed computer use browser runtime",
    security: [{ bearerAuth: [] }],
    body: installRuntimeBodySchema,
    response: {
      200: successEnvelope(runtimeStateSchema),
      400: errorEnvelope,
      401: errorEnvelope,
      500: errorEnvelope,
    },
  },
} as const;
