import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/Button";
import type { CustomMcpDraft, CustomMcpMode } from "../customDrafts";
import { parseCustomMcpConfig, formatCustomMcpConfig } from "../customDrafts";

const LOCAL_TEMPLATE = `{
  "mcpServers": {
    "my-local-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-name"]
    }
  }
}`;
const CLOUD_TEMPLATE = `{
  "mcpServers": {
    "my-cloud-server": {
      "url": "https://example.com/mcp",
      "headers": {}
    }
  }
}`;

function draftJson(draft: CustomMcpDraft) {
  return JSON.stringify({ mcpServers: { [draft.name]: draft.config } }, null, 2);
}

export default function CustomMcpConfigModalContent({
  draft,
  onCancel,
  onSubmit,
}: {
  draft?: CustomMcpDraft;
  onCancel: () => void;
  onSubmit: (mode: CustomMcpMode, servers: Array<{ name: string; config: CustomMcpDraft["config"] }>) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CustomMcpMode>(draft?.mode ?? "local");
  const [localJson, setLocalJson] = useState(draft?.mode === "local" ? draftJson(draft) : LOCAL_TEMPLATE);
  const [cloudJson, setCloudJson] = useState(draft?.mode === "cloud" ? draftJson(draft) : CLOUD_TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const value = mode === "local" ? localJson : cloudJson;
  const setValue = mode === "local" ? setLocalJson : setCloudJson;
  const lineCount = value.split("\n").length;

  const format = () => {
    const result = formatCustomMcpConfig(value, mode);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setValue(result.value);
    setError(null);
  };

  const confirm = () => {
    const result = parseCustomMcpConfig(value, mode);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onSubmit(mode, result.servers);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm leading-6 text-text-secondary">{t("app.connectors.custom.description")}</p>
        <p className="text-xs leading-5 text-text-tertiary">{t("app.connectors.custom.sessionOnly")}</p>
      </div>
      <div className="flex items-center gap-1 rounded-ui-control bg-surface-secondary p-1">
        {(["local", "cloud"] as const).map((value) => (
          <Button
            key={value}
            size="xs"
            variant={mode === value ? "secondary" : "ghost"}
            aria-pressed={mode === value}
            onClick={() => { setMode(value); setError(null); }}
          >
            {t(`app.connectors.custom.modes.${value}`)}
          </Button>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="custom-mcp-json" className="text-xs font-medium text-text-secondary">
            {t("app.connectors.custom.jsonLabel")}
          </label>
          <Button size="xs" variant="ghost" onClick={format}>{t("app.connectors.custom.format")}</Button>
        </div>
        <div className={`relative h-[300px] overflow-hidden rounded-ui-control border bg-surface-secondary focus-within:ring-2 focus-within:ring-primary/20 ${error ? "border-danger" : "border-border"}`}>
          <div className="absolute inset-0 flex font-mono text-[13px] leading-[22px]">
            <div ref={lineNumbersRef} aria-hidden="true" className="stable-scrollbar w-10 shrink-0 overflow-hidden border-r border-border/70 px-2 text-right text-text-tertiary">
              {Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}
            </div>
            <textarea
              id="custom-mcp-json"
              ref={textareaRef}
              aria-label={t("app.connectors.custom.jsonLabel")}
              spellCheck={false}
              value={value}
              onChange={(event) => { setValue(event.target.value); setError(null); }}
              onScroll={(event) => { if (lineNumbersRef.current) lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop; }}
              className="stable-scrollbar h-full min-w-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2.5 font-mono text-[13px] leading-[22px] text-text-primary outline-none"
            />
          </div>
        </div>
        {error ? <p role="alert" className="text-xs text-danger">{t(`app.connectors.custom.errors.${error}`)}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-warning-text">{t("app.connectors.custom.securityHint")}</p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel}>{t("app.connectors.custom.cancel")}</Button>
          <Button size="sm" onClick={confirm}>{t("app.connectors.custom.confirm")}</Button>
        </div>
      </div>
    </div>
  );
}
