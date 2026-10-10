import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { message } from "@/shared/ui/Message";
import {
  getMcpWebSearchConfig,
  saveMcpWebSearchConfig,
  type McpWebSearchConfig,
} from "@/shared/api/tools";

const DEFAULT_MAX_RESULTS = 4;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 10;

export type WebSearchConfig = McpWebSearchConfig;

export const defaultWebSearchConfig: WebSearchConfig = {
  apiKey: "",
  baseUrl: "",
  maxResults: DEFAULT_MAX_RESULTS,
};

export const normalizeWebSearchMaxResults = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(MAX_MAX_RESULTS, Math.max(MIN_MAX_RESULTS, Math.trunc(value)));
};

const normalizeConfig = (config: Partial<WebSearchConfig> | null | undefined): WebSearchConfig => ({
  apiKey: config?.apiKey ?? "",
  baseUrl: config?.baseUrl ?? "",
  maxResults: normalizeWebSearchMaxResults(config?.maxResults),
});

export function useWebSearchConfig(enabled = true) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<WebSearchConfig>(defaultWebSearchConfig);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setConfig(normalizeConfig(await getMcpWebSearchConfig()));
    } catch {
      const errorMessage = t("settings.development.capabilities.config.loadFailed");
      setLoadError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    void reload().catch(() => undefined);
  }, [enabled, reload]);

  const save = useCallback(async () => {
    if (isLoading || isSaving || loadError) {
      return false;
    }

    setIsSaving(true);
    try {
      const saved = await saveMcpWebSearchConfig(config);
      setConfig(normalizeConfig(saved));
      message.success(t("settings.tools.messages.webSearchConfigSaved"));
      return true;
    } catch {
      message.error(t("settings.tools.messages.webSearchConfigSaveFailed"));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [config, isLoading, isSaving, loadError, t]);

  return {
    config,
    isLoading,
    isSaving,
    loadError,
    reload,
    save,
    setConfig,
  };
}
