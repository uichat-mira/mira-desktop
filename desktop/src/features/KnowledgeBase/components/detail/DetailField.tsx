import Card from "@/shared/ui/Card";

interface DetailFieldProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}

export default function DetailField({
  icon: Icon,
  label,
  value,
}: DetailFieldProps) {
  return (
    <Card variant="subtle" className="bg-surface-secondary/70 p-3.5">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="break-words text-sm font-medium text-text-primary">
        {value}
      </div>
    </Card>
  );
}
