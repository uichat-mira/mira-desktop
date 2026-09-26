import { useTranslation } from "react-i18next";
import Card from "@/shared/ui/Card";
import Drawer from "@/shared/ui/Drawer";
import type { ParsedDataset } from "../utils/types";

interface DatasetPreviewDrawerProps {
  open: boolean;
  dataset: ParsedDataset | null;
  onClose: () => void;
}

export function DatasetPreviewDrawer({
  open,
  dataset,
  onClose,
}: DatasetPreviewDrawerProps) {
  const { t } = useTranslation();
  if (!dataset) {
    return null;
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      closeLabel={t("settings.evaluation.workbench.preview.closeDrawer")}
      closeMaskLabel={t("settings.evaluation.workbench.preview.closeMask")}
      bodyClassName="space-y-4"
      header={
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {t("settings.evaluation.workbench.preview.title")}
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            {dataset.datasetName} ·{" "}
            {t("settings.evaluation.shared.sampleCount", {
              count: dataset.summary.sampleCount,
            })}{" "}
            ·{" "}
            {t("settings.evaluation.shared.documentCount", {
              count: dataset.summary.documentCount,
            })}
          </div>
        </div>
      }
    >
      <section className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">
          {t("settings.evaluation.workbench.preview.samplePreview")}
        </div>
        <div className="space-y-2">
          {dataset.previewSamples.map((sample) => (
            <Card key={sample.id} variant="subtle" className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-surface-primary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                  {sample.id}
                </span>
                <div className="text-xs text-text-secondary">
                  {sample.tags.join(" · ")}
                </div>
              </div>
              <div className="mt-2 text-sm font-medium text-text-primary">
                {sample.question}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-secondary">
                {t("settings.evaluation.workbench.preview.goldSources")}：
                {sample.goldSources.join("、")}
              </div>
              <div className="mt-1 text-xs leading-5 text-text-secondary">
                {t("settings.evaluation.workbench.preview.reference")}：
                {sample.expectedAnswer}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-sm font-semibold text-text-primary">
          {t("settings.evaluation.workbench.preview.documentPreview")}
        </div>
        <div className="space-y-2">
          {dataset.documents.map((document) => (
            <Card
              key={document.id}
              variant="subtle"
              className="flex items-center justify-between px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-primary">
                  {document.name}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  {document.sizeLabel}
                </div>
              </div>
              <span className="ml-3 rounded-full bg-surface-primary px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                {document.type}
              </span>
            </Card>
          ))}
        </div>
      </section>
    </Drawer>
  );
}

export default DatasetPreviewDrawer;
