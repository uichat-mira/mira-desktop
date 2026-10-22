import { ChevronRight, PlugZap, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, IconButton, Result } from "@/shared/ui";
import type { CustomMcpDraft } from "../customDrafts";

const cardClass = "flex h-full w-full flex-col gap-4 rounded-ui-panel p-4 pr-12 text-left transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

export default function CustomDraftCatalog({
  drafts,
  query,
  onEdit,
  onRemove,
}: {
  drafts: CustomMcpDraft[];
  query: string;
  onEdit: (draft: CustomMcpDraft) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const keyword = query.trim().toLowerCase();
  const visibleDrafts = drafts.filter((draft) => `${draft.name} ${draft.mode}`.toLowerCase().includes(keyword));

  if (visibleDrafts.length === 0) {
    return <Result size="sm" title={t("app.connectors.noMatches")} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {visibleDrafts.map((draft) => (
        <Card key={draft.id} padding="none" className="relative">
          <button type="button" aria-label={draft.name} onClick={() => onEdit(draft)} className={cardClass}>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ui-control bg-surface-secondary text-icon-primary"><PlugZap className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h4 className="break-words text-sm font-semibold text-text-primary">{draft.name}</h4>
                <div className="mt-1 text-xs text-text-tertiary">{t(`app.connectors.custom.modes.${draft.mode}`)} · MCP</div>
                <div className="mt-1 text-xs text-warning-text">{t("app.connectors.custom.draftStatus")}</div>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" />
            </div>
            <p className="line-clamp-2 text-xs leading-5 text-text-secondary">{t("app.connectors.custom.draftDescription")}</p>
          </button>
          <IconButton
            ariaLabel={t("app.connectors.custom.removeDraft", { name: draft.name })}
            size="sm"
            className="absolute right-2 top-2"
            onClick={() => onRemove(draft.id)}
          >
            <Trash2 size={15} />
          </IconButton>
        </Card>
      ))}
    </div>
  );
}
