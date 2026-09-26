import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Clock3, Hash, Tags, UserRound } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Card from "@/shared/ui/Card";
import { message } from "@/shared/ui/Message";
import Skeleton from "@/shared/ui/Skeleton";
import {
  getKnowledgeBaseDocument,
  type KnowledgeBaseDocumentDetail,
} from "@/shared/api/knowledgeBase";
import { StatusIndicator } from "@/shared/ui/StatusIndicator";
import { formatCompactNumber, getTypeBadge } from "../../utils/mockData";
import { samplePreviewChunks } from "../../utils/documentPreview";
import DetailField from "../../components/detail/DetailField";

export default function KnowledgeBaseDetail() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/knowledge-base";
  const [searchParams] = useSearchParams();
  const documentId = searchParams.get("id");
  const knowledgeBaseId = searchParams.get("knowledgeBaseId");
  const [document, setDocument] = useState<KnowledgeBaseDocumentDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        setLoading(true);
        const data = await getKnowledgeBaseDocument(
          knowledgeBaseId || documentId,
          knowledgeBaseId ? documentId : undefined,
        );
        setDocument(data);
        setNotFound(false);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [documentId]);

  const previewChunks = useMemo(
    () => samplePreviewChunks(document?.chunks ?? []),
    [document],
  );

  const backToKnowledgeBase = () => {
    if (knowledgeBaseId) {
      navigate(
        `${routeBase}?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}`,
      );
      return;
    }

    navigate(routeBase);
  };

  if (loading) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-3 overflow-hidden px-4 py-4">
        <section className="shrink-0 space-y-2.5">
          <Skeleton height={32} width={112} />

          <div className="space-y-3">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Skeleton height={22} width={72} className="rounded-full" />
                <Skeleton height={22} width={96} className="rounded-full" />
              </div>
              <Skeleton height={30} width="56%" />
              <div className="flex gap-2">
                <Skeleton height={32} width={98} />
                <Skeleton height={32} width={98} />
              </div>
            </div>
          </div>
        </section>

        <section className="min-h-0 flex-1">
          <div className="grid gap-3 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(300px,0.94fr)_minmax(0,1.36fr)]">
            <div className="xl:h-full xl:min-h-0 xl:overflow-y-auto">
              <Skeleton height={20} width={92} />
              <div className="mt-4 grid gap-2.5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="border-b border-border/70 py-3.5 last:border-b-0"
                  >
                    <Skeleton height={12} width={88} />
                    <Skeleton
                      height={16}
                      width={`${56 + index * 8}%`}
                      className="mt-3"
                    />
                  </div>
                ))}
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="border-b border-border/70 py-3.5 last:border-b-0"
                    >
                      <Skeleton height={16} width="42%" />
                      <Skeleton.Text lines={2} className="mt-3" lastLineWidth="68%" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="xl:h-full xl:min-h-0 xl:overflow-y-auto">
              <Skeleton height={20} width={120} />
              <Skeleton.Text lines={2} className="mt-3" lastLineWidth="72%" />
              <div className="mt-4 space-y-2.5">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="border-b border-border/70 py-3.5 last:border-b-0"
                  >
                    <Skeleton height={16} width="42%" />
                    <Skeleton.Text lines={3} className="mt-3" lastLineWidth="68%" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (notFound || !document) {
    return (
      <div className="stable-scrollbar mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-3 overflow-y-auto px-4 py-4">
        <div className="shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={backToKnowledgeBase}
          >
            <ArrowLeft className="h-4 w-4" />
            {t("settings.knowledgeBase.actions.backToKnowledgeBase")}
          </Button>
        </div>

        <Card className="p-5">
          <div className="space-y-1.5">
            <div className="text-base font-semibold text-text-primary">
              {t("settings.knowledgeBase.detail.notFoundTitle")}
            </div>
            <p className="text-sm leading-6 text-text-secondary">
              {t("settings.knowledgeBase.detail.notFoundDescription")}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const badge = getTypeBadge(document.fileExt);
  const status =
    document.indexStatus === "processing"
      ? {
          indicator: "unknown" as const,
          label: t("settings.knowledgeBase.status.processing"),
        }
      : document.enabled
        ? {
            indicator: "running" as const,
            label: t("settings.knowledgeBase.status.enabled"),
          }
        : {
            indicator: "stopped" as const,
            label: t("settings.knowledgeBase.status.disabled"),
          };

  const tags = [
    document.fileExt.toUpperCase(),
    document.sourceType,
    document.indexStatus,
  ];

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-3 overflow-hidden px-4 py-4">
      <section className="shrink-0 space-y-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={backToKnowledgeBase}
        >
          <ArrowLeft className="h-4 w-4" />
          {t("settings.knowledgeBase.actions.backToKnowledgeBase")}
        </Button>

        <Card className="p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
          <div className="flex flex-col gap-3">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                  <StatusIndicator status={status.indicator} size="sm" />
                  {status.label}
                </span>
              </div>

              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <h1 className="break-all text-[22px] font-semibold leading-[1.25] text-text-primary">
                  {document.name}
                </h1>

                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      message.info(
                        t("settings.knowledgeBase.messages.rebuildPending", {
                          name: document.name,
                        }),
                      )
                    }
                  >
                    {t("settings.knowledgeBase.actions.rebuildIndex")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      message.success(
                        t("settings.knowledgeBase.messages.retrievalStarted", {
                          name: document.name,
                        }),
                      )
                    }
                  >
                    {t("settings.knowledgeBase.actions.testRetrieval")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>

      <section className="stable-scrollbar min-h-0 flex-1 overflow-y-auto xl:overflow-hidden">
        <div className="grid gap-3 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(300px,0.94fr)_minmax(0,1.36fr)]">
          <Card className="p-3.5 xl:h-full xl:min-h-0 xl:overflow-y-auto">
            <div className="mb-2.5">
              <h2 className="text-[15px] font-semibold text-text-primary">
                {t("settings.knowledgeBase.detail.basicInfo")}
              </h2>
            </div>

            <div className="grid gap-2.5">
              <DetailField
                icon={Hash}
                label={t("settings.knowledgeBase.detail.documentId")}
                value={document.id}
              />
              <DetailField
                icon={UserRound}
                label={t("settings.knowledgeBase.detail.sourceType")}
                value={`${document.sourceLabel || document.sourceType} · ${document.fileExt.toUpperCase()}`}
              />
              <DetailField
                icon={Clock3}
                label={t("settings.knowledgeBase.detail.createdUpdated")}
                value={`${document.createdAt.replace("T", " ").slice(0, 16)} · ${document.updatedAt.replace("T", " ").slice(0, 16)}`}
              />
              <DetailField
                icon={Tags}
                label={t("settings.knowledgeBase.detail.tags")}
                value={
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border bg-surface-primary px-2.5 py-1 text-xs font-medium text-text-secondary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                }
              />
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Card
                  label={t("settings.knowledgeBase.detail.charCount")}
                  value={formatCompactNumber(document.charCount)}
                  description={t(
                    "settings.knowledgeBase.detail.charCountDescription",
                  )}
                />
                <Card
                  label={t("settings.knowledgeBase.detail.chunkCount")}
                  value={`${document.chunkCount}`}
                  description={t(
                    "settings.knowledgeBase.detail.chunkCountDescription",
                  )}
                />
                <Card
                  label={t("settings.knowledgeBase.detail.fileSize")}
                  value={
                    document.fileSize
                      ? formatCompactNumber(document.fileSize)
                      : "--"
                  }
                  description={t(
                    "settings.knowledgeBase.detail.fileSizeDescription",
                  )}
                />
                <Card
                  label={t("settings.knowledgeBase.detail.statusLabel")}
                  value={status.label}
                  description={t(
                    "settings.knowledgeBase.detail.statusDescription",
                  )}
                />
              </div>
            </div>
          </Card>

          <Card className="p-3.5 xl:h-full xl:min-h-0 xl:overflow-y-auto">
            <div className="mb-2.5">
              <h2 className="text-[15px] font-semibold text-text-primary">
                {t("settings.knowledgeBase.detail.previewTitle")}
              </h2>
              <p className="text-sm text-text-secondary">
                {t("settings.knowledgeBase.detail.previewDescription")}
              </p>
            </div>

            <div className="space-y-2.5">
              {previewChunks.length === 0 ? (
                <Card variant="dashed" className="text-sm text-text-secondary">
                  {t("settings.knowledgeBase.detail.noChunks")}
                </Card>
              ) : (
                previewChunks.map((chunk) => (
                  <Card key={chunk.id} variant="subtle" className="p-3.5">
                    <div className="mb-1.5 text-sm font-medium text-text-primary">
                      {t("settings.knowledgeBase.detail.chunkLabel", {
                        index: chunk.chunkIndex,
                      })}
                    </div>
                    <p className="text-sm leading-6 text-text-secondary">
                      {chunk.content}
                    </p>
                  </Card>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
