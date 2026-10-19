import type { ChatToolTraceEntry } from "../core";

export type BrowserTraceDisplayStatus =
  | ChatToolTraceEntry["status"]
  | "awaiting_approval";

const browserActionKeyByToolName = {
  browser_navigate: "navigate",
  browser_snapshot: "snapshot",
  browser_screenshot: "screenshot",
  browser_click: "click",
  browser_fill: "fill",
  browser_press_key: "pressKey",
  browser_select_option: "selectOption",
  browser_scroll: "scroll",
  browser_wait_for: "waitFor",
  browser_assert: "assert",
  browser_tabs_list: "tabsList",
  browser_tab_select: "tabSelect",
} as const;

export type BrowserToolName = keyof typeof browserActionKeyByToolName;

export interface BrowserTraceArtifact {
  id: string;
  title: string;
  previewUrl: string | null;
}

export interface BrowserTraceView {
  toolName: BrowserToolName;
  actionKey: (typeof browserActionKeyByToolName)[BrowserToolName];
  status: BrowserTraceDisplayStatus;
  targetUrl: string | null;
  page: {
    title: string | null;
    url: string | null;
  };
  assertion: {
    kind: string;
    passed: boolean;
  } | null;
  observation: {
    available: boolean;
    truncated: boolean;
  } | null;
  error: {
    code: string | null;
    message: string;
  } | null;
  artifacts: BrowserTraceArtifact[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const isBrowserToolName = (toolName: string): toolName is BrowserToolName =>
  Object.prototype.hasOwnProperty.call(browserActionKeyByToolName, toolName);

export const formatBrowserUrlForDisplay = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.replace(/[?#].*$/, "").slice(0, 300);
  }
};

export const redactUrlQueries = (value: string): string =>
  value.replace(/https?:\/\/[^\s"'<>]+/g, (match) => {
    const safe = formatBrowserUrlForDisplay(match);
    return safe || match;
  });

const isAuthorizedScreenshotPreviewSource = (value: string): boolean =>
  value.startsWith("/attachments/") ||
  /^https?:\/\//i.test(value) ||
  /^data:image\//i.test(value);

const readArtifacts = (
  output: Record<string, unknown> | null,
): BrowserTraceArtifact[] => {
  if (!Array.isArray(output?.artifacts)) {
    return [];
  }

  return output.artifacts.flatMap<BrowserTraceArtifact>((artifact) => {
    const record = asRecord(artifact);
    if (!record || readString(record.kind) !== "screenshot") {
      return [];
    }

    const uri = readString(record.uri);
    return [
      {
        id: readString(record.id) ?? "",
        title: readString(record.title) ?? "",
        previewUrl:
          uri && isAuthorizedScreenshotPreviewSource(uri) ? uri : null,
      },
    ];
  });
};

const resolveDisplayStatus = (
  reportedStatus: string,
  output: Record<string, unknown> | null,
  assertionPassed: boolean | null,
): BrowserTraceDisplayStatus => {
  if (reportedStatus === "awaiting_approval") {
    return "awaiting_approval";
  }

  if (reportedStatus === "failed") {
    return "failed";
  }

  if (reportedStatus === "requested" || reportedStatus === "running") {
    return reportedStatus;
  }

  if (output?.ok === false || assertionPassed === false) {
    return "failed";
  }

  return reportedStatus === "succeeded" ? "succeeded" : "requested";
};

export const getBrowserTraceView = (
  entry: ChatToolTraceEntry,
): BrowserTraceView | null => {
  if (!isBrowserToolName(entry.toolName)) {
    return null;
  }

  const input = asRecord(entry.input);
  const output = asRecord(entry.output);
  const page = asRecord(output?.page);
  const assertion = asRecord(output?.assertion);
  const observation = asRecord(output?.observation);
  const outputError = asRecord(output?.error);

  const assertionPassed =
    typeof assertion?.passed === "boolean" ? assertion.passed : null;
  const assertionKind = readString(assertion?.kind);
  const pageTitle = readString(page?.title);
  const pageUrlRaw = readString(page?.url);
  const targetUrlRaw =
    readString(input?.url) ?? readString(input?.pageUrl);
  const pageUrl = pageUrlRaw ? formatBrowserUrlForDisplay(pageUrlRaw) : "";
  const targetUrl = targetUrlRaw
    ? formatBrowserUrlForDisplay(targetUrlRaw)
    : "";

  const errorCode = readString(outputError?.code);
  const outputErrorMessage = readString(outputError?.message);
  const entryErrorMessage = readString(entry.errorMessage);
  const errorMessage = outputErrorMessage ?? entryErrorMessage;

  return {
    toolName: entry.toolName,
    actionKey: browserActionKeyByToolName[entry.toolName],
    status: resolveDisplayStatus(entry.status, output, assertionPassed),
    targetUrl: targetUrl || null,
    page: {
      title: pageTitle,
      url: pageUrl || null,
    },
    assertion:
      assertionKind && assertionPassed !== null
        ? { kind: assertionKind, passed: assertionPassed }
        : null,
    observation: observation
      ? {
          available:
            typeof observation.snapshot === "string" &&
            observation.snapshot.length > 0,
          truncated: observation.truncated === true,
        }
      : null,
    error: errorMessage
      ? { code: errorCode, message: redactUrlQueries(errorMessage) }
      : errorCode
        ? { code: errorCode, message: errorCode }
        : null,
    artifacts: readArtifacts(output),
  };
};
