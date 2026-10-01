import { useTranslation } from "react-i18next";
import Card from "@/shared/ui/Card";
import Badge from "@/shared/ui/Badge";
import type { RoleModelConfig } from "@/shared/api/modelSettings";
import type { BuiltInLocalModel } from "@/shared/business/localModels";
import { hasConfiguredProviderBinding } from "@/shared/business/modelAccess";

interface ModelStatusCardProps {
  title: string;
  description: string;
  config: RoleModelConfig | null;
  builtInModel?: BuiltInLocalModel | null;
  required?: boolean;
  icon: React.ReactNode;
}

export default function ModelStatusCard({
  title,
  description,
  config,
  builtInModel,
  required = false,
  icon,
}: ModelStatusCardProps) {
  const { t } = useTranslation();
  const configured = hasConfiguredProviderBinding(config);
  const modelSummary = configured
    ? `${config?.providerCode ?? config?.providerConnectionId} · ${
        config?.name ?? config?.remoteModelId
      }`
    : null;
  const builtInSummary = builtInModel
    ? `${t("settings.knowledgeBase.add.builtInLocal")} · ${
        builtInModel.displayName
      }`
    : null;
  const effectiveStatus = configured || Boolean(builtInModel);

  return (
    <Card className="bg-gradient-to-br from-surface-primary to-surface-secondary p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-text-primary">
                {title}
              </div>
              {modelSummary ? (
                <Badge variant="neutral" size="sm">
                  {modelSummary}
                </Badge>
              ) : null}
              {!modelSummary && builtInSummary ? (
                <Badge variant="primary" size="sm">
                  {builtInSummary}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-sm leading-6 text-text-secondary">
              {description}
            </div>
            {!configured && builtInModel ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
                <span>{builtInModel.runtime}</span>
                {builtInModel.dimensions ? (
                  <span>
                    {t("settings.knowledgeBase.add.dimensions", {
                      count: builtInModel.dimensions,
                    })}
                  </span>
                ) : null}
                {builtInModel.optional ? (
                  <span>{t("settings.knowledgeBase.add.optionalBuiltIn")}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <Badge variant={effectiveStatus ? "success" : "danger"} size="md">
          {configured
            ? t("settings.knowledgeBase.add.configured")
            : builtInModel
              ? builtInModel.optional
                ? t("settings.knowledgeBase.add.optionalBuiltIn")
                : t("settings.knowledgeBase.add.builtInReady")
            : required
              ? t("settings.knowledgeBase.add.requiredConfig")
              : t("settings.knowledgeBase.add.notConfigured")}
        </Badge>
      </div>
    </Card>
  );
}
