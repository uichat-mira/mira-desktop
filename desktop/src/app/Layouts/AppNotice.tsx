import React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import Card from "@/shared/ui/Card";

type NoticeTone = "danger" | "success" | "warning" | "info";

const toneClassNames: Record<NoticeTone, string> = {
  danger: "border-danger-border bg-danger-soft text-danger-text",
  success: "border-success-border bg-success-soft text-success-text",
  warning: "border-warning-border bg-warning-soft text-warning-text",
  info: "border-info-border bg-info-soft text-info-text",
};

const toneIcons: Record<NoticeTone, React.ComponentType<{ className?: string }>> = {
  danger: AlertCircle,
  success: CheckCircle2,
  warning: TriangleAlert,
  info: Info,
};

export default function AppNotice({
  children,
  tone = "info",
  icon,
  size = "md",
  className = "",
}: {
  children: React.ReactNode;
  tone?: NoticeTone;
  icon?: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const ToneIcon = toneIcons[tone];
  return (
    <Card className={`flex items-start gap-3 ${size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"} ${toneClassNames[tone]} ${className}`}>
      <div className="mt-0.5 shrink-0">{icon ?? <ToneIcon className="h-4 w-4" />}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </Card>
  );
}
