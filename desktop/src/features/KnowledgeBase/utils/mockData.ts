export type Availability = "enabled" | "disabled";
export type SyncState = "ready" | "indexing";
export type FilterKey = "all" | "enabled" | "disabled";
export type SortKey = "uploadedAt" | "charCount" | "hits";

export const filterOptions: FilterKey[] = ["all", "enabled", "disabled"];

export const sortOptions: SortKey[] = ["uploadedAt", "charCount", "hits"];

export function formatCompactNumber(value: number) {
  if (value >= 1000) {
    const number = value / 1000;
    return `${Number.isInteger(number) ? number : number.toFixed(1)}k`;
  }

  return `${value}`;
}

export function getTypeBadge(type: string) {
  const ext = type.toLowerCase();
  const config = {
    xlsx: {
      label: "XLSX",
      className:
        "border border-success-border bg-success-soft text-success-text",
    },
    xls: {
      label: "XLS",
      className:
        "border border-success-border bg-success-soft text-success-text",
    },
    pdf: {
      label: "PDF",
      className: "border border-danger-border bg-danger-soft text-danger-text",
    },
    docx: {
      label: "DOCX",
      className: "border border-info-border bg-info-soft text-info-text",
    },
    md: {
      label: "MD",
      className:
        "border border-border bg-surface-secondary text-text-secondary",
    },
    txt: {
      label: "TXT",
      className:
        "border border-border bg-surface-secondary text-text-secondary",
    },
  } as const;

  return (
    config[ext as keyof typeof config] ?? {
      label: ext.toUpperCase(),
      className:
        "border border-border bg-surface-secondary text-text-secondary",
    }
  );
}
