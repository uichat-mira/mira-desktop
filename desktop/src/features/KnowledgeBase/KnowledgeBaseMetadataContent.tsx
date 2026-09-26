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
  const metadataItems = [
    { label: "人格", value: metadata?.persona || "未设置" },
    { label: "场景", value: metadata?.scenario || "未设置" },
    {
      label: "标签",
      value: metadata?.tags.length ? metadata.tags.join(" / ") : "未设置",
    },
  ];

  const summaryItems = [
    {
      label: "总文档数",
      value: `${documentCount}`,
      description: "知识库当前包含的文档总量。",
    },
    {
      label: "可用文档数",
      value: `${enabledDocumentCount}`,
      description: "当前允许参与检索的文档数量。",
    },
    {
      label: "总分块数",
      value: `${totalChunks}`,
      description: "知识库内所有文档累计分块数。",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {metadataItems.map((item) => (
          <Card
            key={item.label}
            padding="sm"
            className="px-3 py-2.5"
          >
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
          <Card
            key={item.label}
            variant="subtle"
            className="px-4 py-4"
          >
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

      <Card variant="subtle" className="px-4 py-4 text-sm leading-6 text-text-secondary">
        知识库元数据用于描述适用场景、角色设定和标签检索，不会影响文档原文内容。
      </Card>
    </div>
  );
}
