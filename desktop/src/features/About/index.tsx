import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import Badge from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { getAppMeta, type AppMetaData } from "@/shared/api/system";
import {
  getDesktopRuntime,
  isDesktopShell,
} from "@/shared/platform/desktopRuntime";
import { appPackageMeta } from "@/shared/appMeta";
import AppPageLayout from "@/app/Layouts/AppPageLayout";
import BaseInformationPanel from "./BaseInformationPanel";
import DevelopmentEnvironmentSuiteCard from "@/features/Development/components/DevelopmentEnvironmentSuiteCard";

const getFallbackAppMeta = (): AppMetaData => ({
  name: appPackageMeta.name,
  version: "0.0.0",
  displayName: appPackageMeta.displayName,
  author: appPackageMeta.author,
  description: appPackageMeta.description,
  repositoryUrl: appPackageMeta.repositoryUrl,
  homepageUrl: appPackageMeta.homepageUrl,
  links: [
    {
      label: "作者",
      value: "Tomz Dang <dangjingtao@gmail.com>",
      href: "https://github.com/dangjingtao",
    },
    {
      label: "项目仓库",
      value: appPackageMeta.repositoryUrl,
      href: appPackageMeta.repositoryUrl,
    },
    {
      label: "官方文档",
      value: appPackageMeta.homepageUrl,
      href: appPackageMeta.homepageUrl,
    },
    {
      label: "组件文档",
      value: "uchat / 内部 UI 组件",
      href: "./docs/uchat.md",
    },
  ],
});

const platformLabel = (platform: string) => {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
};

const hostLabel = (hostKind: "browser" | "electron" | "tauri") => {
  if (hostKind === "electron") return "Electron";
  if (hostKind === "tauri") return "Tauri";
  return "Browser Preview";
};

function About() {
  const { t } = useTranslation();
  const [runtime] = useState(() => getDesktopRuntime());
  const [appMeta, setAppMeta] = useState<AppMetaData>(() =>
    getFallbackAppMeta(),
  );

  useEffect(() => {
    if (!isDesktopShell(runtime)) {
      setAppMeta(getFallbackAppMeta());
      return;
    }

    let cancelled = false;

    void getAppMeta()
      .then((data) => {
        if (!cancelled) {
          setAppMeta(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppMeta(getFallbackAppMeta());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const brandStoryParagraphs = t("settings.about.brand.paragraphs", {
    appName: appPackageMeta.displayName,
    returnObjects: true,
  }) as string[];
  const runtimeMeta =
    runtime.hostKind === "browser"
      ? hostLabel(runtime.hostKind)
      : `${platformLabel(runtime.platform)} · ${hostLabel(runtime.hostKind)}`;

  const openBrandStory = () => {
    Modal.show({
      title: appMeta.displayName,
      width: 720,
      maxHeight: 720,
      footer: null,
      content: (
        <article className="space-y-4 text-sm leading-7 text-text-secondary">
          {brandStoryParagraphs.map((paragraph, index) => {
            const isFirst = index === 0;
            const isLast = index === brandStoryParagraphs.length - 1;

            return (
              <p
                key={`${index}:${paragraph.slice(0, 12)}`}
                className={
                  isLast
                    ? "pt-2 font-medium text-text-primary"
                    : isFirst
                      ? "text-text-primary"
                      : ""
                }
              >
                {paragraph}
              </p>
            );
          })}
        </article>
      ),
    });
  };

  return (
    <AppPageLayout
      miniTitle={t("settings.about.miniTitle")}
      title={appMeta.displayName}
      titleMeta={
        <Badge
          variant="neutral"
          size="sm"
          outline
          className="font-mono"
        >
          v{appMeta.version} · {runtimeMeta}
        </Badge>
      }
      slot={
        <Button variant="ghost" size="sm" onClick={openBrandStory}>
          <BookOpen className="h-4 w-4" />
          品牌故事
        </Button>
      }
      description={t("settings.about.brand.description")}
      contentClassName="pt-6"
      contentMode="flow"
    >
      <div className="space-y-4">
        <BaseInformationPanel appMeta={appMeta} />
        <DevelopmentEnvironmentSuiteCard />
      </div>
    </AppPageLayout>
  );
}

export default About;
