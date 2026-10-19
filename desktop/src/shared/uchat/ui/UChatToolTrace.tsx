import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Globe2,
  Image as ImageIcon,
  LoaderCircle,
  Wrench,
} from "lucide-react";
import type { ChatToolTraceEntry } from "../core";
import {
  getBrowserTraceView,
  type BrowserTraceArtifact,
  type BrowserTraceDisplayStatus,
  type BrowserTraceView,
} from "./browserToolTrace";

const statusClassNameMap: Record<BrowserTraceDisplayStatus, string> = {
  requested: "border-border/70 bg-surface-primary/92 text-text-secondary",
  running: "border-primary/20 bg-primary/10 text-primary",
  awaiting_approval: "border-primary/20 bg-primary/10 text-primary",
  succeeded: "border-success-border bg-success-soft text-success-text",
  failed: "border-warning-border bg-warning-soft text-warning-text",
};

const statusIconMap: Record<BrowserTraceDisplayStatus, React.ReactNode> = {
  requested: <Clock3 className="h-3.5 w-3.5" />,
  running: <LoaderCircle className="h-3.5 w-3.5 animate-spin" />,
  awaiting_approval: <Clock3 className="h-3.5 w-3.5" />,
  succeeded: <CheckCircle2 className="h-3.5 w-3.5" />,
  failed: <AlertCircle className="h-3.5 w-3.5" />,
};

const stringifyValue = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getOutputSummary = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    results?: unknown[];
    provider?: string;
  };

  if (Array.isArray(candidate.results)) {
    if (typeof candidate.provider === "string") {
      return `${candidate.provider} · ${candidate.results.length}`;
    }
    return `${candidate.results.length}`;
  }

  return null;
};

const getEntryDisplayStatus = (
  entry: ChatToolTraceEntry,
  browserView: BrowserTraceView | null,
): BrowserTraceDisplayStatus => {
  if (browserView) {
    return browserView.status;
  }
  return String(entry.status) === "awaiting_approval"
    ? "awaiting_approval"
    : entry.status;
};

function StatusBadge({
  status,
}: {
  status: BrowserTraceDisplayStatus;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        statusClassNameMap[status]
      }`}
    >
      {statusIconMap[status]}
      <span>{t(`chat.thread.tools.status.${status}`)}</span>
    </span>
  );
}

function BrowserPageLine({ view }: { view: BrowserTraceView }) {
  const { t } = useTranslation();
  const { title, url } = view.page;

  if (title && url) {
    return (
      <span>
        {t("chat.thread.tools.browser.pageWithUrl", { title, url })}
      </span>
    );
  }
  if (url) {
    return (
      <span>{t("chat.thread.tools.browser.pageUrl", { url })}</span>
    );
  }
  if (title) {
    return (
      <span>{t("chat.thread.tools.browser.pageTitle", { title })}</span>
    );
  }
  if (view.targetUrl) {
    return (
      <span>{t("chat.thread.tools.browser.target", { url: view.targetUrl })}</span>
    );
  }
  return null;
}

function BrowserAssertionLine({ view }: { view: BrowserTraceView }) {
  const { t } = useTranslation();
  if (!view.assertion) {
    return null;
  }
  return (
    <span
      className={
        view.assertion.passed ? "text-success-text" : "text-warning-text"
      }
    >
      {t(
        view.assertion.passed
          ? "chat.thread.tools.browser.assertion.passed"
          : "chat.thread.tools.browser.assertion.failed",
        { kind: view.assertion.kind },
      )}
    </span>
  );
}

function BrowserStatusMessage({ view }: { view: BrowserTraceView }) {
  const { t } = useTranslation();

  if (view.status !== "failed" && view.status !== "awaiting_approval") {
    return null;
  }

  const fallback =
    view.status === "awaiting_approval"
      ? t("chat.thread.tools.browser.awaitingApproval")
      : t("chat.thread.tools.browser.failed");
  const message = view.error?.message ?? fallback;
  const code = view.error?.code;
  const text = code && code !== message ? `${code}: ${message}` : message;

  return (
    <div
      className={`mt-1 break-words text-xs ${
        view.status === "failed" ? "text-warning-text" : "text-primary"
      }`}
    >
      {text}
    </div>
  );
}

function BrowserArtifactSummary({ artifacts }: { artifacts: BrowserTraceArtifact[] }) {
  const { t } = useTranslation();
  return (
    <>
      {artifacts.map((artifact, index) => {
        const label =
          artifact.title || artifact.id || t("chat.thread.tools.browser.screenshot");
        return (
          <div
            key={`${artifact.id || label}-${index}`}
            className="mt-1 flex items-center gap-1.5 text-xs text-text-secondary"
          >
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">
              {t("chat.thread.tools.browser.screenshotArtifact", { value: label })}
              {artifact.previewUrl
                ? ""
                : ` · ${t("chat.thread.tools.browser.previewUnavailable")}`}
            </span>
          </div>
        );
      })}
    </>
  );
}

function BrowserScreenshotArtifact({
  artifact,
  resolveAttachmentSource,
  onPreviewImage,
}: {
  artifact: BrowserTraceArtifact;
  resolveAttachmentSource?: (value: string) => string;
  onPreviewImage?: (src: string) => void;
}) {
  const { t } = useTranslation();
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const label =
    artifact.title || artifact.id || t("chat.thread.tools.browser.screenshot");
  const identity = artifact.id
    ? t("chat.thread.tools.browser.screenshotArtifact", { value: artifact.id })
    : label;

  if (!artifact.previewUrl) {
    return (
      <div className="rounded-[12px] border border-border/60 bg-surface-primary/80 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
          <ImageIcon className="h-3.5 w-3.5" />
          <span>{identity}</span>
        </div>
        <div className="mt-1 text-[11px] leading-5 text-text-tertiary">
          {t("chat.thread.tools.browser.previewUnavailable")}
        </div>
        <div className="mt-0.5 text-[11px] leading-5 text-text-tertiary">
          {t("chat.thread.tools.browser.previewUnavailableDetail")}
        </div>
      </div>
    );
  }

  const previewUrl = resolveAttachmentSource
    ? resolveAttachmentSource(artifact.previewUrl)
    : artifact.previewUrl;

  if (loadState === "error") {
    return (
      <div className="rounded-[12px] border border-warning-border bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning-text">
        {t("chat.thread.tools.browser.previewError")}
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border/60 bg-surface-primary/80 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
        <ImageIcon className="h-3.5 w-3.5" />
        <span>{identity}</span>
      </div>
      <button
        type="button"
        className="mt-2 block max-w-[min(100%,22rem)] overflow-hidden rounded-[10px] border border-border/70 bg-surface-secondary disabled:cursor-default"
        onClick={() => onPreviewImage?.(previewUrl)}
        disabled={!onPreviewImage}
        aria-label={t("chat.thread.tools.browser.previewOpen")}
      >
        <img
          src={previewUrl}
          alt={label}
          className="block max-h-48 w-full cursor-zoom-in object-contain"
          draggable={false}
          onLoad={() => setLoadState("loaded")}
          onError={() => setLoadState("error")}
        />
      </button>
      {loadState === "loading" ? (
        <div className="mt-1 text-[11px] text-text-tertiary">
          {t("chat.thread.tools.browser.previewLoading")}
        </div>
      ) : null}
    </div>
  );
}

function BrowserEntryDetails({
  view,
  resolveAttachmentSource,
  onPreviewImage,
}: {
  view: BrowserTraceView;
  resolveAttachmentSource?: (value: string) => string;
  onPreviewImage?: (src: string) => void;
}) {
  const { t } = useTranslation();
  const pageLine = <BrowserPageLine view={view} />;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
        <Globe2 className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">
          {t(`chat.thread.tools.browser.actions.${view.actionKey}`)}
        </span>
        {pageLine ? <span className="min-w-0 break-words">{pageLine}</span> : null}
        <BrowserAssertionLine view={view} />
        {view.observation?.available ? (
          <span className="text-text-tertiary">
            {t(
              view.observation.truncated
                ? "chat.thread.tools.browser.observationTruncated"
                : "chat.thread.tools.browser.observation",
            )}
          </span>
        ) : null}
      </div>

      <BrowserStatusMessage view={view} />

      {view.artifacts.length > 0 ? (
        <div className="space-y-2">
          {view.artifacts.map((artifact, index) => (
            <BrowserScreenshotArtifact
              key={`${artifact.id || artifact.title}-${index}`}
              artifact={artifact}
              resolveAttachmentSource={resolveAttachmentSource}
              onPreviewImage={onPreviewImage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function UChatToolTrace({
  entries,
  resolveAttachmentSource,
  onPreviewImage,
}: {
  entries: ChatToolTraceEntry[];
  resolveAttachmentSource?: (value: string) => string;
  onPreviewImage?: (src: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const browserViews = useMemo(
    () => entries.map((entry) => getBrowserTraceView(entry)),
    [entries],
  );
  const latestEntry = entries.at(-1) ?? null;
  const latestBrowserView = browserViews.at(-1) ?? null;

  const summary = useMemo(() => {
    if (!latestEntry || latestBrowserView) {
      return "";
    }

    if (latestEntry.status === "failed") {
      return latestEntry.errorMessage ?? t("chat.thread.tools.failed");
    }

    if (latestEntry.status === "succeeded") {
      const outputSummary = getOutputSummary(latestEntry.output);
      if (outputSummary) {
        return t("chat.thread.tools.succeededSummary", {
          toolName: latestEntry.toolName,
          outputSummary,
        });
      }
      return t("chat.thread.tools.succeeded");
    }

    if (latestEntry.status === "running") {
      return t("chat.thread.tools.runningSummary", {
        toolName: latestEntry.toolName,
      });
    }

    return t("chat.thread.tools.requestedSummary", {
      toolName: latestEntry.toolName,
    });
  }, [latestEntry, latestBrowserView, t]);

  if (!latestEntry) {
    return null;
  }

  return (
    <div className="mt-3 rounded-2xl border border-border/70 bg-surface-primary/68 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            {latestBrowserView ? (
              <Globe2 className="h-3.5 w-3.5" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            <span>
              {latestBrowserView
                ? t("chat.thread.tools.browser.title")
                : t("chat.thread.tools.title")}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge
              status={getEntryDisplayStatus(latestEntry, latestBrowserView)}
            />
            <span className="truncate text-sm font-medium text-text-primary">
              {latestBrowserView
                ? t(
                    `chat.thread.tools.browser.actions.${latestBrowserView.actionKey}`,
                  )
                : latestEntry.toolName}
            </span>
          </div>
          {latestBrowserView ? (
            <>
              {latestBrowserView.page.title ||
              latestBrowserView.page.url ||
              latestBrowserView.targetUrl ? (
                <div className="mt-2 break-words text-xs text-text-secondary">
                  <BrowserPageLine view={latestBrowserView} />
                </div>
              ) : null}
              {latestBrowserView.assertion ? (
                <div className="mt-1 break-words text-xs">
                  <BrowserAssertionLine view={latestBrowserView} />
                </div>
              ) : null}
              <BrowserStatusMessage view={latestBrowserView} />
              <BrowserArtifactSummary artifacts={latestBrowserView.artifacts} />
            </>
          ) : summary ? (
            <div className="mt-2 break-words text-xs text-text-secondary">
              {summary}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-[10px] border border-border/70 bg-surface-primary/92 px-2.5 text-xs text-text-secondary transition-colors hover:border-border hover:bg-surface-primary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          onClick={() => setExpanded((current) => !current)}
        >
          <span>
            {expanded
              ? t("chat.thread.tools.hideDetails")
              : t("chat.thread.tools.showDetails")}
          </span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          {entries.map((entry, index) => {
            const browserView = browserViews[index];
            return (
              <div
                key={`${entry.toolCallId ?? entry.toolName}-${index}`}
                className="rounded-[14px] border border-border/60 bg-surface-secondary/70 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {entry.toolName}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      statusClassNameMap[
                        getEntryDisplayStatus(entry, browserView)
                      ]
                    }`}
                  >
                    {statusIconMap[getEntryDisplayStatus(entry, browserView)]}
                    <span>
                      {t(
                        `chat.thread.tools.status.${getEntryDisplayStatus(
                          entry,
                          browserView,
                        )}`,
                      )}
                    </span>
                  </span>
                </div>

                {browserView ? (
                  <BrowserEntryDetails
                    view={browserView}
                    resolveAttachmentSource={resolveAttachmentSource}
                    onPreviewImage={onPreviewImage}
                  />
                ) : null}

                {entry.toolCallId ? (
                  <div className="mt-2 text-[11px] text-text-tertiary">
                    {t("chat.thread.tools.callId", {
                      value: entry.toolCallId,
                    })}
                  </div>
                ) : null}

                {entry.input ? (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                      {t("chat.thread.tools.input")}
                    </div>
                    <pre className="overflow-x-auto rounded-[12px] bg-surface-primary/90 px-3 py-2 text-[11px] leading-5 text-text-secondary">
                      {stringifyValue(entry.input)}
                    </pre>
                  </div>
                ) : null}

                {Object.prototype.hasOwnProperty.call(entry, "output") ? (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                      {t("chat.thread.tools.output")}
                    </div>
                    <pre className="overflow-x-auto rounded-[12px] bg-surface-primary/90 px-3 py-2 text-[11px] leading-5 text-text-secondary">
                      {stringifyValue(entry.output)}
                    </pre>
                  </div>
                ) : null}

                {entry.errorMessage && !browserView ? (
                  <div className="mt-3">
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-warning-text/90">
                      {t("chat.thread.tools.error")}
                    </div>
                    <div className="rounded-[12px] border border-warning-border bg-warning-soft px-3 py-2 text-[11px] leading-5 text-warning-text">
                      {entry.errorMessage}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
