import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { TextArea, TextInput } from "@/shared/ui/Input";
import type {
  ExternalMcpConfigSchemaResolution,
  ExternalMcpServerConfigRecord,
} from "@/shared/api/tools";

type McpConfigModalContentProps = {
  schema: ExternalMcpConfigSchemaResolution;
  config: ExternalMcpServerConfigRecord;
  isSubmitting: boolean;
  error: string | null;
  labels: {
    endpointUrl: string;
    bearerToken: string;
    timeoutMs: string;
    customHeadersJson: string;
    cwd: string;
    envJson: string;
    authType: string;
    authTypeNone: string;
    authTypeBearer: string;
    knownPartial: string;
    notesTitle: string;
    cancel: string;
    save: string;
    saveLoading: string;
    clearTokenHint: string;
  };
  onCancel: () => void;
  onSubmit: (input: {
    endpointUrl?: string;
    command?: string;
    argsText?: string;
    cwd?: string;
    envJson?: string;
    authType: "none" | "bearer";
    timeoutMs: number;
    customHeadersJson: string;
    bearerToken?: string | null;
  }) => void | Promise<void>;
};

type FormState = {
  endpointUrl: string;
  command: string;
  argsText: string;
  packageName: string;
  cwd: string;
  envJson: string;
  authType: "none" | "bearer";
  timeoutMs: string;
  customHeadersJson: string;
  bearerToken: string;
};

const getFieldLabel = (
  key: string,
  labels: McpConfigModalContentProps["labels"],
  fallback: string,
) => {
  switch (key) {
    case "endpointUrl":
      return labels.endpointUrl;
    case "bearerToken":
      return labels.bearerToken;
    case "timeoutMs":
      return labels.timeoutMs;
    case "customHeadersJson":
      return labels.customHeadersJson;
    default:
      return fallback;
  }
};

export default function McpConfigModalContent({
  schema,
  config,
  isSubmitting,
  error,
  labels,
  onCancel,
  onSubmit,
}: McpConfigModalContentProps) {
  const [form, setForm] = useState<FormState>({
    endpointUrl: config.endpointUrl ?? "",
    command: config.command ?? "",
    argsText: config.argsText ?? "",
    packageName: config.packageName ?? "",
    cwd: config.cwd ?? "",
    envJson: config.envJson ?? "{}",
    authType: config.authType,
    timeoutMs: String(config.timeoutMs),
    customHeadersJson: config.customHeadersJson,
    bearerToken: "",
  });

  useEffect(() => {
    setForm({
      endpointUrl: config.endpointUrl ?? "",
      command: config.command ?? "",
      argsText: config.argsText ?? "",
      packageName: config.packageName ?? "",
      cwd: config.cwd ?? "",
      envJson: config.envJson ?? "{}",
      authType: config.authType,
      timeoutMs: String(config.timeoutMs),
      customHeadersJson: config.customHeadersJson,
      bearerToken: "",
    });
  }, [config]);

  const fieldKeys = useMemo(() => new Set(schema.fields.map((field) => field.key)), [schema.fields]);
  const showsAuth = fieldKeys.has("bearerToken") || fieldKeys.has("customHeadersJson");
  const isCommandTransport =
    fieldKeys.has("command") || fieldKeys.has("argsText") || fieldKeys.has("cwd") || fieldKeys.has("envJson");
  const packageHint = config.packageName?.trim();

  const renderField = (field: ExternalMcpConfigSchemaResolution["fields"][number]) => {
    const label = getFieldLabel(field.key, labels, field.label);
    const commonProps = {
      label,
      placeholder: field.placeholder,
      disabled: isSubmitting,
    };

    switch (field.key) {
      case "endpointUrl":
        return (
          <TextInput
            key={field.key}
            {...commonProps}
            value={form.endpointUrl}
            onChange={(value) => setForm((current) => ({ ...current, endpointUrl: value }))}
            type="url"
          />
        );
      case "command":
        return (
          <TextInput
            key={field.key}
            {...commonProps}
            value={form.command}
            onChange={(value) => setForm((current) => ({ ...current, command: value }))}
          />
        );
      case "argsText":
      case "customHeadersJson":
      case "cwd":
        return (
          <TextArea
            key={field.key}
            {...commonProps}
            value={
              field.key === "argsText"
                ? form.argsText
                : field.key === "cwd"
                  ? form.cwd
                  : form.customHeadersJson
            }
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                [field.key]: value,
              }))
            }
            rows={6}
          />
        );
      case "envJson":
        return (
          <TextArea
            key={field.key}
            {...commonProps}
            value={form.envJson}
            onChange={(value) => setForm((current) => ({ ...current, envJson: value }))}
            rows={6}
          />
        );
      case "timeoutMs":
        return (
          <TextInput
            key={field.key}
            {...commonProps}
            value={form.timeoutMs}
            onChange={(value) => setForm((current) => ({ ...current, timeoutMs: value }))}
            type="number"
          />
        );
      case "bearerToken":
        return (
          <div key={field.key} className="space-y-2">
            <TextInput
              {...commonProps}
              value={form.bearerToken}
              onChange={(value) => setForm((current) => ({ ...current, bearerToken: value }))}
              type="password"
              placeholder={config.hasBearerToken ? labels.clearTokenHint : field.placeholder}
            />
            {config.hasBearerToken ? (
              <div className="text-xs text-text-tertiary">{labels.clearTokenHint}</div>
            ) : null}
          </div>
        );
      default:
        return (
          <TextInput
            key={field.key}
            {...commonProps}
            value={String(field.defaultValue ?? "")}
            onChange={() => undefined}
            disabled
          />
        );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="stable-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="rounded-ui-control border border-border bg-surface-secondary px-3 py-2 text-xs text-text-secondary">
          {labels.knownPartial}
        </div>

        {isCommandTransport ? (
          <div className="space-y-2 rounded-ui-control border border-border bg-surface-secondary px-3 py-3">
            <div className="text-xs font-medium text-text-secondary">Launcher</div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              <span className="rounded-full border border-border bg-surface-primary px-2 py-0.5 text-[11px] text-text-tertiary">
                {form.command || "npx"}
              </span>
              {packageHint ? (
                <span className="rounded-full border border-border bg-surface-primary px-2 py-0.5 text-[11px] text-text-tertiary">
                  {packageHint}
                </span>
              ) : null}
            </div>
            <div className="text-xs leading-5 text-text-tertiary">
              {packageHint ? "包启动器" : "本地启动器"}
            </div>
          </div>
        ) : null}

        {schema.fields.map(renderField)}

        {showsAuth ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-text-secondary">{labels.authType}</div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={form.authType === "none" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setForm((current) => ({ ...current, authType: "none" }))}
                disabled={isSubmitting}
              >
                {labels.authTypeNone}
              </Button>
              <Button
                variant={form.authType === "bearer" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setForm((current) => ({ ...current, authType: "bearer" }))}
                disabled={isSubmitting}
              >
                {labels.authTypeBearer}
              </Button>
            </div>
          </div>
        ) : null}

        {schema.notes && schema.notes.length > 0 ? (
          <div className="space-y-1 rounded-ui-control border border-border bg-surface-secondary px-3 py-3">
            <div className="text-xs font-medium text-text-secondary">{labels.notesTitle}</div>
            {schema.notes.map((note) => (
              <div key={note} className="text-xs text-text-tertiary">
                {note}
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-ui-control border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSubmitting}>
          {labels.cancel}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={isSubmitting}
          onClick={() =>
            onSubmit({
              endpointUrl: fieldKeys.has("endpointUrl") ? form.endpointUrl : undefined,
              command: fieldKeys.has("command") ? form.command : undefined,
              argsText: fieldKeys.has("argsText") ? form.argsText : undefined,
              cwd: fieldKeys.has("cwd") ? form.cwd : undefined,
              envJson: fieldKeys.has("envJson") ? form.envJson : undefined,
              authType: form.authType,
              timeoutMs: Number(form.timeoutMs || "0"),
              customHeadersJson: fieldKeys.has("customHeadersJson") ? form.customHeadersJson : "",
              bearerToken:
                fieldKeys.has("bearerToken") && form.authType === "bearer"
                  ? form.bearerToken
                  : null,
            })
          }
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isSubmitting ? labels.saveLoading : labels.save}
        </Button>
      </div>
    </div>
  );
}
