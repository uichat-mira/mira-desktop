import { Globe2, KeyRound, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import { NumberInput, TextInput } from "@/shared/ui/Input";
import {
  normalizeWebSearchMaxResults,
  type WebSearchConfig,
} from "../hooks/useWebSearchConfig";

type WebSearchConfigPanelProps = {
  config: WebSearchConfig;
  isLoading?: boolean;
  isSaving?: boolean;
  loadError?: string | null;
  onReload?: () => void | Promise<void>;
  onChange: (update: (current: WebSearchConfig) => WebSearchConfig) => void;
  onSave: () => void | Promise<boolean | void>;
};

export default function WebSearchConfigPanel({
  config,
  isLoading = false,
  isSaving = false,
  loadError = null,
  onReload,
  onChange,
  onSave,
}: WebSearchConfigPanelProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return <div className="py-8 text-sm text-text-secondary">{t("settings.development.capabilities.config.loading")}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pr-1">
      <div className="text-sm leading-6 text-text-secondary">
        {t("settings.development.capabilities.config.description")}
      </div>

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-ui-control border border-warning-border bg-warning-background px-3 py-2 text-sm text-warning-text">
          <span>{loadError}</span>
          {onReload ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={isLoading}
              onClick={() => void Promise.resolve(onReload()).catch(() => undefined)}
            >
              {t("settings.development.capabilities.actions.refresh")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card padding="none" className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <KeyRound className="h-4 w-4 text-icon-secondary" aria-hidden="true" />
            {t("settings.tools.package.webSearchTavily")}
          </div>
          <div className="mt-1 text-xs leading-5 text-text-tertiary">
            {t("settings.tools.package.webSearchTavilyHint")}
          </div>
          <div className="mt-3">
            <TextInput
              label={t("settings.tools.package.webSearchApiKey")}
              type="password"
              value={config.apiKey}
              onChange={(value) => onChange((current) => ({ ...current, apiKey: value }))}
              placeholder={t("settings.tools.package.webSearchApiKeyPlaceholder")}
              autoComplete="off"
            />
          </div>
        </Card>

        <Card padding="none" className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Globe2 className="h-4 w-4 text-icon-secondary" aria-hidden="true" />
            {t("settings.tools.package.webSearchSearxng")}
          </div>
          <div className="mt-1 text-xs leading-5 text-text-tertiary">
            {t("settings.tools.package.webSearchSearxngHint")}
          </div>
          <div className="mt-3">
            <TextInput
              label={t("settings.tools.package.webSearchBaseUrl")}
              value={config.baseUrl}
              onChange={(value) => onChange((current) => ({ ...current, baseUrl: value }))}
              placeholder={t("settings.tools.package.webSearchBaseUrlPlaceholder")}
            />
          </div>
        </Card>
      </div>

      <Card padding="none" className="p-4">
        <NumberInput
          label={t("settings.tools.package.webSearchMaxResults")}
          value={config.maxResults}
          onChange={(value) =>
            onChange((current) => ({
              ...current,
              maxResults: normalizeWebSearchMaxResults(value),
            }))
          }
          step={1}
          labelHelp={t("settings.tools.package.webSearchMaxResultsHint")}
        />
      </Card>

      <div className="mt-auto flex justify-end border-t border-border pt-4">
        <Button
          size="sm"
          variant="primary"
          disabled={isLoading || isSaving || Boolean(loadError)}
          onClick={() => void onSave()}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {isSaving
            ? t("settings.development.capabilities.config.saving")
            : t("settings.development.capabilities.config.save")}
        </Button>
      </div>
    </div>
  );
}
