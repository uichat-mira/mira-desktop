import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  GitCommit,
  History,
  LoaderCircle,
  Mail,
  MessageSquarePlus,
  RefreshCw,
  Scale,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppMetaData } from "@/shared/api/system";
import { openExternalUrl } from "@/shared/platform/desktopRuntime";
import { Button } from "@/shared/ui/Button";
import Badge from "@/shared/ui/Badge";
import { message } from "@/shared/ui/Message";
import { Modal } from "@/shared/ui/Modal";
import MarkdownText from "@/shared/ui/MarkdownText";
import SectionCard, { SectionCardRow } from "@/shared/ui/SectionCard";
import { appPackageMeta } from "@/shared/appMeta";
import { checkGithubTagUpdate, type GithubTagUpdateResult } from "./githubUpdate";
import licenseText from "../../../../../../LICENSE?raw";
import changelogText from "../../../../../../CHANGELOG.md?raw";

const MAX_VISIBLE_GIT_VERSIONS = 5;
const FEEDBACK_ISSUE_URL =
  "https://github.com/uichat-mira/mira-desktop/issues/new";
const FEEDBACK_EMAIL_URL =
  "mailto:dangjingtao@gmail.com?subject=UIChat%20Mira%20反馈";

function formatCommitDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString();
  } catch {
    return isoDate;
  }
}

export default function BaseInformationPanel({
  appMeta,
}: {
  appMeta: AppMetaData;
}) {
  const { t } = useTranslation();
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);

  const handleExternalLinkClick = useCallback(
    async (href: string) => {
      const isExternalUrl = /^https?:\/\//i.test(href);
      try {
        if (isExternalUrl) {
          await openExternalUrl(href);
          return;
        }

        await navigator.clipboard.writeText(href);
        message.success(t("settings.about.linkCopied"));
      } catch {
        message.error(
          t(
            isExternalUrl
              ? "settings.about.linkOpenFailed"
              : "settings.about.linkCopyFailed",
          ),
        );
      }
    },
    [t],
  );

  const openLicenseModal = useCallback(() => {
    Modal.show({
      title: `${appPackageMeta.license || "MIT"} License`,
      width: 720,
      maxHeight: 640,
      footer: null,
      content: (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-text-secondary">
          {licenseText}
        </pre>
      ),
    });
  }, []);

  const openChangelogModal = useCallback(() => {
    Modal.show({
      title: "更新日志",
      width: 760,
      maxHeight: 720,
      footer: null,
      content: (
        <MarkdownText
          features="basic"
          className="[&_h1]:mt-0 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_li]:my-1"
        >
          {changelogText}
        </MarkdownText>
      ),
    });
  }, []);

  const openFeedbackModal = useCallback(() => {
    let modalKey = "";

    const openFeedbackTarget = async (url: string) => {
      try {
        await openExternalUrl(url);
        Modal.close(modalKey);
      } catch {
        message.error(t("settings.about.linkOpenFailed"));
      }
    };

    modalKey = Modal.show({
      title: "应用反馈",
      width: 520,
      footer: null,
      content: (
        <div className="overflow-hidden rounded-ui-panel border border-border/70 bg-surface-secondary/60">
          <button
            type="button"
            onClick={() => void openFeedbackTarget(FEEDBACK_ISSUE_URL)}
            className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-secondary"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0 text-icon-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text-primary">
                提交 GitHub Issue
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-text-secondary">
                功能建议与可公开的缺陷
              </span>
            </span>
            <ExternalLink className="h-4 w-4 shrink-0 text-icon-secondary" />
          </button>
          <button
            type="button"
            onClick={() => void openFeedbackTarget(FEEDBACK_EMAIL_URL)}
            className="flex w-full items-center gap-3 border-t border-border/70 px-3.5 py-3 text-left transition-colors hover:bg-surface-secondary"
          >
            <Mail className="h-4 w-4 shrink-0 text-icon-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text-primary">
                发送邮件
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-text-secondary">
                隐私、日志或其他敏感问题
              </span>
            </span>
            <ExternalLink className="h-4 w-4 shrink-0 text-icon-secondary" />
          </button>
        </div>
      ),
    });
  }, [t]);

  const openUpdateResultModal = useCallback(
    (result: GithubTagUpdateResult) => {
      let modalKey = "";

      const openTag = async () => {
        try {
          await openExternalUrl(result.tagUrl);
          Modal.close(modalKey);
        } catch {
          message.error(t("settings.about.linkOpenFailed"));
        }
      };

      modalKey = Modal.show({
        title: t(
          result.updateAvailable
            ? "settings.about.updateCheck.availableTitle"
            : "settings.about.updateCheck.currentTitle",
        ),
        width: 520,
        content: (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              {result.updateAvailable ? (
                <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              ) : (
                <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              )}
              <p className="text-sm leading-6 text-text-secondary">
                {t(
                  result.updateAvailable
                    ? "settings.about.updateCheck.availableDescription"
                    : "settings.about.updateCheck.currentDescription",
                )}
              </p>
            </div>
            <dl className="divide-y divide-border border-y border-border text-sm">
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">
                  {t("settings.about.updateCheck.currentVersion")}
                </dt>
                <dd className="font-medium text-text-primary">v{result.currentVersion}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-3">
                <dt className="text-text-secondary">
                  {t("settings.about.updateCheck.latestVersion")}
                </dt>
                <dd className="font-medium text-text-primary">{result.latestTag}</dd>
              </div>
            </dl>
          </div>
        ),
        footer: result.updateAvailable ? (
          <>
            <Button variant="secondary" onClick={() => Modal.close(modalKey)}>
              {t("settings.about.updateCheck.close")}
            </Button>
            <Button variant="primary" onClick={() => void openTag()}>
              <ExternalLink className="h-4 w-4" />
              {t("settings.about.updateCheck.viewTag")}
            </Button>
          </>
        ) : undefined,
      });
    },
    [t],
  );

  const handleCheckForUpdates = useCallback(async () => {
    setCheckingForUpdates(true);
    try {
      const result = await checkGithubTagUpdate(
        appMeta.repositoryUrl || appPackageMeta.repositoryUrl,
        appMeta.version,
      );
      openUpdateResultModal(result);
    } catch (error) {
      Modal.show({
        title: t("settings.about.updateCheck.failureTitle"),
        width: 520,
        content: (
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <p className="text-sm leading-6 text-text-secondary">
              {error instanceof Error
                ? error.message
                : t("settings.about.updateCheck.failureDescription")}
            </p>
          </div>
        ),
      });
    } finally {
      setCheckingForUpdates(false);
    }
  }, [appMeta.repositoryUrl, appMeta.version, openUpdateResultModal, t]);

  const links = appMeta.links ?? [];
  const gitInfo = appMeta.git;

  return (
    <div className="space-y-4">
      <SectionCard
        data-testid="base-information-links"
        title={t("settings.about.projectSupport")}
        divided
      >
        {links.map((item) => (
          <SectionCardRow
            as="button"
            key={`${item.label}:${item.value}`}
            type="button"
            onClick={() => {
              if (item.href) {
                handleExternalLinkClick(item.href);
              }
            }}
            className={item.href ? "hover:bg-surface-secondary" : ""}
          >
            <div className="min-w-0">
              <div className="text-xs text-text-tertiary">{item.label}</div>
              <div className="truncate text-sm font-medium text-text-primary">
                {item.value}
              </div>
            </div>
            {item.href ? (
              <ExternalLink className="h-4 w-4 shrink-0 text-icon-secondary" />
            ) : null}
          </SectionCardRow>
        ))}
        <SectionCardRow
          as="button"
          type="button"
          onClick={openChangelogModal}
          className="hover:bg-surface-secondary"
        >
          <div className="min-w-0">
            <div className="text-xs text-text-tertiary">更新日志</div>
            <div className="text-sm font-medium text-text-primary">
              CHANGELOG.md
            </div>
          </div>
          <History className="h-4 w-4 shrink-0 text-icon-secondary" />
        </SectionCardRow>
        <SectionCardRow
          as="button"
          type="button"
          onClick={openLicenseModal}
          className="hover:bg-surface-secondary"
        >
          <div className="min-w-0">
            <div className="text-xs text-text-tertiary">许可证</div>
            <div className="text-sm font-medium text-text-primary">
              {appPackageMeta.license || "MIT"} License
            </div>
          </div>
          <Scale className="h-4 w-4 shrink-0 text-icon-secondary" />
        </SectionCardRow>
        <SectionCardRow
          as="button"
          type="button"
          onClick={openFeedbackModal}
          className="hover:bg-surface-secondary"
        >
          <div className="min-w-0">
            <div className="text-xs text-text-tertiary">应用反馈</div>
            <div className="text-sm font-medium text-text-primary">
              GitHub Issue 或邮件
            </div>
          </div>
          <MessageSquarePlus className="h-4 w-4 shrink-0 text-icon-secondary" />
        </SectionCardRow>
      </SectionCard>

      <SectionCard
        data-testid="git-version-list"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span>{t("settings.about.gitInfo")}</span>
            {gitInfo?.branch ? (
              <span data-testid="git-current-branch" className="min-w-0">
                <Badge
                  variant="primary"
                  outline
                  className="max-w-48 overflow-hidden"
                >
                  <span className="truncate">{gitInfo.branch}</span>
                </Badge>
              </span>
            ) : null}
          </span>
        }
        action={
          <Button
            size="xs"
            variant="ghost"
            disabled={checkingForUpdates}
            onClick={() => void handleCheckForUpdates()}
          >
            {checkingForUpdates ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t(
              checkingForUpdates
                ? "settings.about.updateCheck.checking"
                : "settings.about.updateCheck.action",
            )}
          </Button>
        }
        divided
      >
        {gitInfo?.versions?.length ? (
          <>
            {gitInfo.versions
              .slice(0, MAX_VISIBLE_GIT_VERSIONS)
              .map((item) => (
                <SectionCardRow
                  key={item.version}
                  data-testid={`git-version-${item.version}`}
                >
                  <div
                    data-testid={`git-version-main-${item.version}`}
                    className="flex min-w-0 items-center gap-3"
                  >
                    <GitCommit className="h-3.5 w-3.5 shrink-0 text-icon-secondary" />
                    <span className="shrink-0 text-sm font-semibold text-text-primary">
                      {item.version}
                    </span>
                    <span
                      className="truncate text-sm text-text-secondary"
                      title={item.commit.message}
                    >
                      {item.commit.message}
                    </span>
                  </div>
                  <div
                    data-testid={`git-version-meta-${item.version}`}
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-text-tertiary"
                  >
                    <span
                      className="max-w-40 truncate"
                      title={item.commit.author}
                    >
                      {item.commit.author}
                    </span>
                    <span>·</span>
                    <time dateTime={item.commit.date}>
                      {formatCommitDate(item.commit.date)}
                    </time>
                  </div>
                </SectionCardRow>
              ))}
          </>
        ) : null}
      </SectionCard>

    </div>
  );
}
