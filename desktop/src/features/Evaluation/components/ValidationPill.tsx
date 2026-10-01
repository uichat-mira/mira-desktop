import { useTranslation } from "react-i18next";

export function ValidationPill({
  status,
}: {
  status: "pass" | "warning" | "error";
}) {
  const { t } = useTranslation();
  const statusMap = {
    pass: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-danger/10 text-danger",
  } as const;

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMap[status]}`}
    >
      {status === "pass"
        ? t("settings.evaluation.shared.statusPass")
        : status === "warning"
          ? t("settings.evaluation.shared.statusWarning")
          : t("settings.evaluation.shared.statusError")}
    </span>
  );
}

export default ValidationPill;
