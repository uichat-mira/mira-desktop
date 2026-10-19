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
