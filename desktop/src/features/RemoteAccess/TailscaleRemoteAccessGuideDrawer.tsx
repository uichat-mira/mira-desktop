import { useTranslation } from "react-i18next";
import Drawer from "@/shared/ui/Drawer";
import { getTailscaleRemoteAccessCopy } from "./copy";

export default function TailscaleRemoteAccessGuideDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { i18n } = useTranslation();
  const copy = getTailscaleRemoteAccessCopy(i18n.resolvedLanguage);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      closeLabel={copy.guide.close}
      closeMaskLabel={copy.guide.close}
      header={
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Tailscale
          </div>
          <div className="text-base font-semibold text-text-primary">
            {copy.guide.title}
          </div>
          <div className="text-sm leading-6 text-text-secondary">
            {copy.guide.intro}
          </div>
        </div>
      }
    >
      <ol className="space-y-3">
        {copy.guide.steps.map(([title, description], index) => (
          <li
            key={title}
            className="rounded-ui-control border border-border bg-surface-secondary px-4 py-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {index + 1}
              </span>
              <span>{title}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {description}
            </p>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}
