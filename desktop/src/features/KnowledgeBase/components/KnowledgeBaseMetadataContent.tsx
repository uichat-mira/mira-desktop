import { useTranslation } from "react-i18next";
import Card from "@/shared/ui/Card";

interface KnowledgeBaseMetadataContentProps {
  metadata: {
    persona: string | null;
    scenario: string | null;
    tags: string[];
  } | null;
  documentCount: number;
  enabledDocumentCount: number;
  totalChunks: number;
}

export default function KnowledgeBaseMetadataContent({
  metadata,
  documentCount,
  enabledDocumentCount,
  totalChunks,
}: KnowledgeBaseMetadataContentProps) {
  const { t } = useTranslation();

  const metadataItems = [
    {
      label: t("settings.knowledgeBase.metadata.persona"),
      value: metadata?.persona || t("settings.knowledgeBase.metadata.notSet"),
    },
    {
      label: t("settings.knowledgeBase.metadata.scenario"),
      value: metadata?.scenario || t("settings.knowledgeBase.metadata.notSet"),
    },
    {
      label: t("settings.knowledgeBase.metadata.tags"),
      value: metadata?.tags.length
        ? metadata.tags.join(" / ")
        : t("settings.knowledgeBase.metadata.notSet"),
    },
  ];

  const summaryItems = [
    {
      label: t("settings.knowledgeBase.metadata.totalDocuments"),
      value: `${documentCount}`,
      description: t("settings.knowledgeBase.metadata.totalDocumentsDesc"),
    },
    {
      label: t("settings.knowledgeBase.metadata.enabledDocuments"),
      value: `${enabledDocumentCount}`,
      description: t("settings.knowledgeBase.metadata.enabledDocumentsDesc"),
    },
    {
      label: t("settings.knowledgeBase.metadata.totalChunks"),
      value: `${totalChunks}`,
      description: t("settings.knowledgeBase.metadata.totalChunksDesc"),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {metadataItems.map((item) => (
          <Card key={item.label} padding="sm" className="px-3 py-2.5">
            <div className="text-[11px] font-medium text-text-tertiary">
              {item.label}
            </div>
            <div className="mt-1 truncate text-sm text-text-primary">
              {item.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {summaryItems.map((item) => (
          <Card key={item.label} variant="subtle" className="px-4 py-4">
            <div className="text-caption text-text-tertiary">{item.label}</div>
            <div className="mt-2 text-heading-1 text-text-primary">
              {item.value}
            </div>
            <div className="mt-2 text-body-small text-text-secondary">
              {item.description}
            </div>
          </Card>
        ))}
      </div>

      <Card
        variant="subtle"
        className="px-4 py-4 text-sm leading-6 text-text-secondary"
      >
        {t("settings.knowledgeBase.metadata.footer")}
      </Card>
    </div>
  );
}
