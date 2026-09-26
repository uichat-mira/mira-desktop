import Card from "@/shared/ui/Card";
import Switch from "@/shared/ui/Switch";
import FieldHelpLabel from "./FieldHelpLabel";

interface SwitchFieldProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}

export default function SwitchField({
  label,
  hint,
  checked,
  onChange,
}: SwitchFieldProps) {
  return (
    <div className="min-w-0">
      <FieldHelpLabel label={label} hint={hint} />
      <Card className="flex h-8 items-center justify-between gap-3 px-2.5 py-0 text-sm text-text-primary">
        <span className="min-w-0 truncate">{label}</span>
        <Switch
          checked={checked}
          onChange={onChange}
          ariaLabel={label}
          size="sm"
        />
      </Card>
    </div>
  );
}
