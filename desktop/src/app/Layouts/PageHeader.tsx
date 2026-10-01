import Divider from "@/shared/ui/Divider";

export default function PageHeader({
  miniTitle,
  title,
  titleMeta,
  description,
  slot,
}: {
  miniTitle: string;
  title: string;
  titleMeta?: React.ReactNode;
  description?: string;
  slot?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 space-y-2 bg-transparent pt-6">
      <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
        {miniTitle}
      </div>
      <div className="flex w-full items-start gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="font-serif text-xl font-bold text-text-primary">
              {title}
            </h3>
            {titleMeta ? <div className="shrink-0">{titleMeta}</div> : null}
          </div>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-text-secondary">
              {description}
            </p>
          ) : null}
        </div>
        {slot ? <div className="shrink-0 self-end sm:ml-auto">{slot}</div> : null}
      </div>
      <Divider />
    </div>
  );
}
