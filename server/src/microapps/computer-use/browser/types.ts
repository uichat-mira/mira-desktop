import type { BrowserRuntimeStatus } from "../runtime/types.js";

export type BrowserSessionConfig = {
  channel?: "chromium" | "chrome" | "edge";
  executablePath?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  allowedDomains: string[];
  allowedSchemes?: string[];
  initialUrl?: string;
  actionTimeoutMs?: number;
  sessionTimeoutMs?: number;
};

export type BrowserInspectInput = {
  sessionId: string;
  includeScreenshot?: boolean;
  includeVisibleText?: boolean;
  maxSnapshotChars?: number;
};

export type BrowserAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; ref: string }
  | { kind: "type"; ref: string; text: string }
  | { kind: "select"; ref: string; value: string }
  | { kind: "press"; ref: string; key: string }
  | { kind: "scroll"; x?: number; y?: number }
  | { kind: "wait"; ref?: string; text?: string; timeoutMs?: number };

export type BrowserActInput = {
  sessionId: string;
  pageUrl: string;
  snapshotHash: string;
  action: BrowserAction;
};

export type BrowserNavigateInput = {
  sessionId: string;
  url: string;
};

export type BrowserWaitCondition =
  | { kind: "text"; value: string }
  | { kind: "url"; value: string }
  | { kind: "visible"; ref: string; pageUrl: string; snapshotHash: string };

export type BrowserWaitInput = {
  sessionId: string;
  condition: BrowserWaitCondition;
  timeoutMs?: number;
};

export type BrowserAssertion =
  | { kind: "title"; expected: string }
  | { kind: "url"; expected: string }
  | { kind: "text"; expected: string }
  | { kind: "visible"; ref: string }
  | { kind: "value"; ref: string; expected: string };

export type BrowserAssertInput = {
  sessionId: string;
  assertion: BrowserAssertion;
};

export type BrowserArtifact = {
  id: string;
  kind: "screenshot" | "json";
  title: string;
  uri: string;
};

export type BrowserPageState = {
  url: string;
  title: string;
  snapshotHash?: string;
};

export type BrowserToolError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type BrowserToolResult = {
  ok: boolean;
  sessionId: string;
  invocationId: string;
  page: BrowserPageState;
  observation?: {
    snapshot?: string;
    visibleText?: string;
    truncated?: boolean;
  };
  assertion?: { kind: BrowserAssertion["kind"]; passed: boolean };
  artifacts: BrowserArtifact[];
  error?: BrowserToolError;
};

export type BrowserSessionStatus = "creating" | "ready" | "busy" | "stopped" | "failed" | "blocked";

export type BrowserSessionInfo = {
  id: string;
  status: BrowserSessionStatus;
  config: BrowserSessionConfig;
  error?: BrowserToolError;
};

export type BrowserRuntimeResolver = {
  resolveRuntime(): BrowserRuntimeStatus;
};
