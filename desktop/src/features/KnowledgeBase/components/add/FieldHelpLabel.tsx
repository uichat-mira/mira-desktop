import Tooltip from "@/shared/ui/Tooltip";
import { CircleHelp } from "lucide-react";

interface FieldHelpLabelProps {
  label: string;
  hint: string;
}

export default function FieldHelpLabel({ label, hint }: FieldHelpLabelProps) {
  return (
    <div className="mb-1 flex h-5 items-center gap-1.5 text-xs font-medium text-text-secondary">
      <span>{label}</span>
      <Tooltip text={hint} placement="top">
        <span className="text-icon-secondary">
          <CircleHelp className="h-3.5 w-3.5" />
        </span>
      </Tooltip>
    </div>
  );
}
