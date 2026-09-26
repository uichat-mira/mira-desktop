import { useTranslation } from "react-i18next";
import Badge from "@/shared/ui/Badge";

interface ModelAccessStatusPillProps {
  label: string;
  connected: boolean;
}

export default function ModelAccessStatusPill({
  label,
  connected,
}: ModelAccessStatusPillProps) {
  const { t } = useTranslation();
  return (
    <Badge variant={connected ? "success" : "danger"} size="md">
      {label}：
      {connected
        ? t("settings.knowledgeBase.add.connected")
        : t("settings.knowledgeBase.add.notConnected")}
    </Badge>
  );
}
