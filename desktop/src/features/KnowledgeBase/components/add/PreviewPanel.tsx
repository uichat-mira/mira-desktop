import { useTranslation } from "react-i18next";
import Badge from "@/shared/ui/Badge";
import Card from "@/shared/ui/Card";
import type { ChunkPreviewResult } from "@/shared/api/knowledgeBase";

interface PreviewPanelProps {
  fileName: string | undefined;
  previewChunks: ChunkPreviewResult["sampleChunks"];
  previewStats: ChunkPreviewResult["stats"] | null;
}

export default function PreviewPanel({
  fileName,
  previewChunks,
  previewStats,
}: PreviewPanelProps) {
  const { t } = useTranslation();

  return (
    <Card className="flex min-h-[260px] flex-col p-0 2xl:h-full 2xl:min-h-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">
            {t("settings.knowledgeBase.add.previewTitle")}
          </div>
          <div className="mt-1 truncate text-sm text-text-secondary">
            {fileName ?? t("settings.knowledgeBase.add.noFileSelected")}
          </div>
        </div>
        <Badge variant="neutral" size="md" className="ml-3 shrink-0">
          {previewStats
            ? t("settings.knowledgeBase.add.sampleCount", {
                current: previewChunks.length,
                total: previewStats.totalChunks,
              })
            : t("settings.knowledgeBase.add.previewCount", {
                count: previewChunks.length,
              })}
        </Badge>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {previewChunks.length === 0 ? (
          <Card
            variant="dashed"
            className="px-4 py-10 text-sm leading-6 text-text-secondary"
          >
            {t("settings.knowledgeBase.add.previewPlaceholder")}
          </Card>
        ) : (
          <div className="space-y-3">
            {previewStats ? (
              <Card
                variant="subtle"
                className="grid gap-2 p-3.5 text-xs text-text-secondary md:grid-cols-2"
              >
                <div>
                  {t("settings.knowledgeBase.add.totalChunks")}：
                  {previewStats.totalChunks}
                </div>
                <div>
                  {t("settings.knowledgeBase.add.avgLength")}：
                  {previewStats.averageChunkLength}
                </div>
                <div>
                  {t("settings.knowledgeBase.add.minLength")}：
                  {previewStats.minChunkLength}
                </div>
                <div>
                  {t("settings.knowledgeBase.add.maxLength")}：
                  {previewStats.maxChunkLength}
                </div>
              </Card>
            ) : null}
            {previewChunks.map((chunk) => (
              <Card key={chunk.id} variant="subtle" className="min-w-0 p-3.5">
                <div className="mb-2 text-sm font-medium text-primary">
                  Chunk-{chunk.index} · {chunk.charCount} characters
                </div>
                <div className="overflow-hidden break-words text-sm leading-6 text-text-primary">
                  {chunk.text}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
