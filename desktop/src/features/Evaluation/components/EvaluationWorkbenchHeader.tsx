import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, PackagePlus, Play } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import Divider from "@/shared/ui/Divider";

interface EvaluationWorkbenchHeaderProps {
  canRun: boolean;
  onOpenPackageGenerator: () => void;
  onStartEvaluation: () => void;
}

export default function EvaluationWorkbenchHeader({
  canRun,
  onOpenPackageGenerator,
  onStartEvaluation,
}: EvaluationWorkbenchHeaderProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const routeBase = "/evaluation";

  return (
    <div className="shrink-0 px-2 pt-6">
      <div className="mx-auto flex w-full max-w-none flex-col gap-2">
        <div>
          <Button
            variant="link"
            size="sm"
            className="justify-start gap-1 self-start text-caption text-text-secondary hover:no-underline"
            onClick={() => navigate(`${routeBase}/center`)}
          >
            <ArrowLeft className="h-4 w-4" />
            {t("settings.evaluation.workbench.back")}
          </Button>
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3">
          <div className="text-[18px] font-semibold leading-[1.4] text-text-primary">
            {t("settings.evaluation.workbench.page.title")}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={onOpenPackageGenerator}>
              <PackagePlus className="h-4 w-4" />
              {t("settings.evaluation.workbench.actions.generatePackage")}
            </Button>
            <Button
              variant="success-ghost"
              size="sm"
              disabled={!canRun}
              onClick={() => void onStartEvaluation()}
            >
              <Play className="h-4 w-4" />
              {t("settings.evaluation.workbench.actions.startEvaluation")}
            </Button>
          </div>
        </div>
        <Divider />
      </div>
    </div>
  );
}
