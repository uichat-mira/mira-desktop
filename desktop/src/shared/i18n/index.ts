import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import zhCN from "./zh-CN";
import enUS from "./en-US";

/* ── Feature-level i18n shards ─────────────────────────────── */
import dashboardZh from "@/features/dashboard/i18n/zh-CN";
import dashboardEn from "@/features/dashboard/i18n/en-US";
import chatPendingZh from "@/features/chat/i18n/zh-CN";
import chatPendingEn from "@/features/chat/i18n/en-US";
import settingsPendingZh from "@/features/Settings/i18n/zh-CN";
import settingsPendingEn from "@/features/Settings/i18n/en-US";
import remoteAccessZh from "@/features/RemoteAccess/i18n/zh-CN";
import remoteAccessEn from "@/features/RemoteAccess/i18n/en-US";
import skillsZh from "@/features/Settings/pages/Skills/i18n/zh-CN";
import skillsEn from "@/features/Settings/pages/Skills/i18n/en-US";
import codeGraphZh from "@/features/Settings/pages/MicroApps/CodeGraph/i18n/zh-CN";
import codeGraphEn from "@/features/Settings/pages/MicroApps/CodeGraph/i18n/en-US";
import jianXingZh from "@/features/Settings/pages/MicroApps/JianXing/i18n/zh-CN";
import jianXingEn from "@/features/Settings/pages/MicroApps/JianXing/i18n/en-US";
import integrationsZh from "@/features/Settings/pages/Integrations/i18n/zh-CN";
import integrationsEn from "@/features/Settings/pages/Integrations/i18n/en-US";

/* ── App & shared UI i18n shards ──────────────────────────── */
import appZh from "@/app/i18n/zh-CN";
import appEn from "@/app/i18n/en-US";
import uiZh from "@/shared/ui/i18n/zh-CN";
import uiEn from "@/shared/ui/i18n/en-US";

export const APP_LANGUAGE_STORAGE_KEY = "uichat-language";
export const appLanguages = ["zh-CN", "en-US"] as const;
export type AppLanguage = (typeof appLanguages)[number];

/* ── Deep merge util for combining translation objects ─────── */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

/* ── Build resources ───────────────────────────────────────── */
const baseResources = {
  "zh-CN": { translation: zhCN },
  "en-US": { translation: enUS },
} as const;

const shards = {
  "zh-CN": [
    dashboardZh,
    chatPendingZh,
    settingsPendingZh,
    remoteAccessZh,
    skillsZh,
    codeGraphZh,
    jianXingZh,
    integrationsZh,
    appZh,
    uiZh,
  ],
  "en-US": [
    dashboardEn,
    chatPendingEn,
    settingsPendingEn,
    remoteAccessEn,
    skillsEn,
    codeGraphEn,
    jianXingEn,
    integrationsEn,
    appEn,
    uiEn,
  ],
} as const;

const resources = {
  "zh-CN": {
    translation: shards["zh-CN"].reduce(
      (acc, shard) => deepMerge(acc, shard as Record<string, unknown>),
      baseResources["zh-CN"].translation as unknown as Record<string, unknown>,
    ) as unknown as typeof zhCN,
  },
  "en-US": {
    translation: shards["en-US"].reduce(
      (acc, shard) => deepMerge(acc, shard as Record<string, unknown>),
      baseResources["en-US"].translation as unknown as Record<string, unknown>,
    ) as unknown as typeof enUS,
  },
};

export const resolveAppLanguage = (value?: string | null): AppLanguage => {
  if (value === "en" || value === "en-US") {
    return "en-US";
  }

  if (value === "zh" || value === "zh-CN") {
    return "zh-CN";
  }

  return "zh-CN";
};

export const getAppLanguage = (): AppLanguage =>
  resolveAppLanguage(i18n.resolvedLanguage ?? i18n.language);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "zh-CN",
    supportedLngs: [...appLanguages],
    lng: resolveAppLanguage(
      globalThis.localStorage?.getItem(APP_LANGUAGE_STORAGE_KEY) ??
        globalThis.navigator?.language,
    ),
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: APP_LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

const syncDocumentLanguage = (language: string) => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = resolveAppLanguage(language);
};

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
