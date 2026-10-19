import { BookOpen, CircleAlert, ExternalLink, PlugZap, Search, Settings2, Sparkles } from "lucide-react";
import Drawer from "@/shared/ui/Drawer";

type McpGuideDrawerProps = {
  open: boolean;
  onClose: () => void;
  labels: {
    title: string;
    intro: string;
    searchTitle: string;
    searchBody: string;
    installTitle: string;
    installBody: string;
    configTitle: string;
    configBody: string;
    connectTitle: string;
    connectBody: string;
    discoverTitle: string;
    discoverBody: string;
    inspectTitle: string;
    inspectBody: string;
    boundaryTitle: string;
    boundaryBody: string;
    officialSourceTitle: string;
    officialSourceBody: string;
    close: string;
    searchHint: string;
  };
};

const sectionClassName = "rounded-ui-control border border-border bg-surface-secondary px-4 py-3";

function Section({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <section className={sectionClassName}>
      <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
        {icon}
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{body}</p>
    </section>
  );
}

export default function McpGuideDrawer({ open, onClose, labels }: McpGuideDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={460}
      closeLabel={labels.close}
      closeMaskLabel={labels.close}
      header={
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-text-tertiary">MCP</div>
          <div className="text-base font-semibold text-text-primary">{labels.title}</div>
          <div className="text-sm leading-6 text-text-secondary">{labels.intro}</div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-ui-control border border-dashed border-border px-4 py-3 text-xs leading-6 text-text-tertiary">
          {labels.searchHint}
        </div>

        <Section
          icon={<Search className="h-4 w-4 text-icon-secondary" />}
          title={labels.searchTitle}
          body={labels.searchBody}
        />
        <Section
          icon={<Sparkles className="h-4 w-4 text-icon-secondary" />}
          title={labels.installTitle}
          body={labels.installBody}
        />
        <Section
          icon={<Settings2 className="h-4 w-4 text-icon-secondary" />}
          title={labels.configTitle}
          body={labels.configBody}
        />
        <Section
          icon={<PlugZap className="h-4 w-4 text-icon-secondary" />}
          title={labels.connectTitle}
          body={labels.connectBody}
        />
        <Section
          icon={<ExternalLink className="h-4 w-4 text-icon-secondary" />}
          title={labels.discoverTitle}
          body={labels.discoverBody}
        />
        <Section
          icon={<BookOpen className="h-4 w-4 text-icon-secondary" />}
          title={labels.inspectTitle}
          body={labels.inspectBody}
        />
        <Section
          icon={<CircleAlert className="h-4 w-4 text-icon-secondary" />}
          title={labels.boundaryTitle}
          body={labels.boundaryBody}
        />
        <Section
          icon={<CircleAlert className="h-4 w-4 text-icon-secondary" />}
          title={labels.officialSourceTitle}
          body={labels.officialSourceBody}
        />
      </div>
    </Drawer>
  );
}
