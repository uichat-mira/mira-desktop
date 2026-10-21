import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu } from "@/shared/ui";
import type { MarketplaceFilter } from "../catalog";

const categories = [
  ["all", "all"], ["developer-tools", "developerTools"], ["data", "data"],
  ["search-knowledge", "searchKnowledge"], ["browser-automation", "browserAutomation"],
  ["files-office", "filesOffice"], ["cloud-devops", "cloudDevops"],
  ["communication", "communication"], ["other", "other"],
] as const;

export default function ConnectorFilters({ category, filter, onCategoryChange, onFilterChange }: {
  category: string;
  filter: MarketplaceFilter;
  onCategoryChange: (value: string) => void;
  onFilterChange: (value: MarketplaceFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu align="end" trigger={
      <button type="button" aria-label={t("app.connectors.filterMenu")} title={t("app.connectors.filterMenu")} className={`flex h-8 w-8 items-center justify-center rounded-ui-control transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${category !== "all" || filter !== "all" ? "bg-primary/10 text-primary" : "text-text-secondary"}`}>
        <SlidersHorizontal size={17} />
      </button>
    } items={[
      { id: "category", label: t("settings.mcp.marketplace.categoryLabel"), children: categories.map(([id, key]) => ({ id: `category:${id}`, label: t(`settings.mcp.marketplace.categories.${key}`), checked: category === id })) },
      { id: "transport", label: t("settings.mcp.marketplace.filterLabel"), children: (["all", "installable", "remote", "local"] as const).map((id) => ({ id: `transport:${id}`, label: t(`settings.mcp.marketplace.filters.${id}`), checked: filter === id })) },
      { id: "reset", label: t("app.connectors.resetFilters") },
    ]} onSelect={(item) => {
      if (item.id.startsWith("category:")) onCategoryChange(item.id.slice(9));
      else if (item.id.startsWith("transport:")) onFilterChange(item.id.slice(10) as MarketplaceFilter);
      else if (item.id === "reset") { onCategoryChange("all"); onFilterChange("all"); }
    }} />
  );
}
