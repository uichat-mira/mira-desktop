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

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setConfig(normalizeConfig(await getMcpWebSearchConfig()));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    void reload().catch(() => {
      setConfig(defaultWebSearchConfig);
    });
  }, [enabled, reload]);

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const saved = await saveMcpWebSearchConfig(config);
      setConfig(normalizeConfig(saved));
      message.success(t("settings.tools.messages.webSearchConfigSaved"));
    } finally {
      setIsSaving(false);
    }
  }, [config, t]);

  return {
    config,
    isLoading,
    isSaving,
    reload,
    save,
    setConfig,
  };
}
