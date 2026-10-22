import type { ToolInvocationStatus } from "@/shared/api/tools";
import type { BrowserJourneySpec } from "./types";

export type BrowserJourneyStepId =
  | "navigate"
  | "snapshot"
  | "click"
  | "observe-after-click"
  | "assert";

export type BrowserJourneyStepStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "rejected"
  | "skipped";

export type BrowserJourneyStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "rejected";

export type BrowserJourneyPage = {
  url: string;
  title: string;
  snapshotHash?: string;
};

export type BrowserJourneyError = {
  code: string;
  message: string;
};

export type BrowserJourneyStep = {
  id: BrowserJourneyStepId;
  toolId: string;
  status: BrowserJourneyStepStatus;
  invocationId: string | null;
  approvalInvocationId: string | null;
  invocationStatus: ToolInvocationStatus | null;
  approvalDecision: "approved" | "rejected" | null;
  resultOk: boolean | null;
  sessionId: string | null;
  page: BrowserJourneyPage | null;
  ref: string | null;
  assertion: { kind: string; passed: boolean } | null;
  error: BrowserJourneyError | null;
};

export type BrowserJourneyState = {
  status: BrowserJourneyStatus;
  handle: string | null;
  spec: BrowserJourneySpec | null;
  steps: BrowserJourneyStep[];
  error: BrowserJourneyError | null;
};

export type BrowserResultView = {
  ok: boolean;
  sessionId: string | null;
  page: BrowserJourneyPage | null;
  observationSnapshot: string | null;
  assertion: { kind: string; passed: boolean } | null;
  error: BrowserJourneyError | null;
};

export const BROWSER_JOURNEY_STEP_DEFINITIONS: ReadonlyArray<{
  id: BrowserJourneyStepId;
  toolId: string;
}> = [
  { id: "navigate", toolId: "browser_navigate" },
  { id: "snapshot", toolId: "browser_snapshot" },
  { id: "click", toolId: "browser_click" },
  { id: "observe-after-click", toolId: "browser_snapshot" },
  { id: "assert", toolId: "browser_assert" },
];

export const createBrowserJourneyState = (
  spec: BrowserJourneySpec | null = null,
): BrowserJourneyState => ({
  status: "idle",
  handle: null,
  spec,
  steps: BROWSER_JOURNEY_STEP_DEFINITIONS.map((step) => ({
    id: step.id,
    toolId: step.toolId,
    status: "pending",
    invocationId: null,
    approvalInvocationId: null,
    invocationStatus: null,
    approvalDecision: null,
    resultOk: null,
    sessionId: null,
    page: null,
    ref: null,
    assertion: null,
    error: null,
  })),
  error: null,
});

const readString = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

export function readBrowserResult(value: unknown): BrowserResultView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean") return null;

  const rawPage =
    record.page && typeof record.page === "object" && !Array.isArray(record.page)
      ? (record.page as Record<string, unknown>)
      : null;
  const page =
    rawPage && typeof rawPage.url === "string" && typeof rawPage.title === "string"
      ? {
          url: rawPage.url,
          title: rawPage.title,
          ...(readString(rawPage.snapshotHash)
            ? { snapshotHash: readString(rawPage.snapshotHash)! }
            : {}),
        }
      : null;

  const rawObservation =
    record.observation &&
    typeof record.observation === "object" &&
    !Array.isArray(record.observation)
      ? (record.observation as Record<string, unknown>)
      : null;

  const rawAssertion =
    record.assertion &&
    typeof record.assertion === "object" &&
    !Array.isArray(record.assertion)
      ? (record.assertion as Record<string, unknown>)
      : null;
  const assertion =
    rawAssertion &&
    typeof rawAssertion.kind === "string" &&
    typeof rawAssertion.passed === "boolean"
      ? { kind: rawAssertion.kind, passed: rawAssertion.passed }
      : null;

  const rawError =
    record.error && typeof record.error === "object" && !Array.isArray(record.error)
      ? (record.error as Record<string, unknown>)
      : null;

  return {
    ok: record.ok,
    sessionId: readString(record.sessionId),
    page,
    observationSnapshot: rawObservation ? readString(rawObservation.snapshot) : null,
    assertion,
    error: rawError
      ? {
          code: readString(rawError.code) ?? "browser_tool_error",
          message: readString(rawError.message) ?? "Browser Tool failed.",
        }
      : null,
  };
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function findBrowserSnapshotRef(
  snapshot: string | null | undefined,
  target: { role: "button" | "link"; name: string },
): string | null {
  if (!snapshot) return null;
  const pattern = new RegExp(
    `\\b${target.role}\\s+"${escapeRegExp(target.name)}"\\s+\\[ref=([^\\]]+)\\]`,
  );
  return pattern.exec(snapshot)?.[1] ?? null;
}
