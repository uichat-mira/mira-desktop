import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Circle, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/app/providers/AuthProvider";
import { useRuntimeHealth } from "../../system/hooks/useRuntimeHealth";
import { Button } from "@/shared/ui/Button";

function HomePage() {
  const { t } = useTranslation();
  const { session, logout } = useAuth();
  const { runtime, backendState, databaseState } = useRuntimeHealth();
  const navigate = useNavigate();

  const backendSummary = useMemo(() => {
    return runtime.backendUrl || backendState.detail;
  }, [backendState.detail, runtime.backendUrl]);

  const runtimeSummary = useMemo(() => {
    const hostLabel = runtime.hostKind === "electron" ? "Electron" : "Browser";
    const statusLabel =
      backendState.status === "running"
        ? "API 正常"
        : backendState.status === "stopped"
        ? "API 异常"
        : "API 检查中";

    return `${hostLabel} · ${statusLabel}`;
  }, [backendState.status, runtime.hostKind]);

  const statusItems = useMemo(
    () => [
      {
        key: "backend",
        label: t("dashboard.home.backendService"),
        status: backendState.status,
        value: backendSummary,
      },
      {
        key: "database",
        label: t("dashboard.home.databaseConnection"),
        status: databaseState.status,
        value: databaseState.detail,
      },
      {
        key: "runtime",
        label: t("dashboard.home.runtime"),
        status: backendState.status,
        value: runtimeSummary,
      },
    ],
    [
      t,
      backendState.status,
      backendSummary,
      databaseState.status,
      databaseState.detail,
      runtimeSummary,
    ],
  );

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-surface-secondary">
      <main className="mx-auto flex max-w-6xl flex-col px-5 py-8 sm:px-6 lg:px-8">
        <section className="rounded-ui-overlay border border-border bg-surface-primary shadow-shadow-sm">
          <div className="px-8 py-10 sm:px-10 sm:py-11">
            <div className="max-w-3xl">
              <div className="text-caption text-primary">
                {t("dashboard.home.previewLabel")}
              </div>

              <h1 className="mt-4 text-[34px] font-semibold leading-[1.18] text-text-primary sm:text-[38px]">
                {t("dashboard.home.welcomeBack", {
                  username: session.user.username,
                })}
              </h1>

              <p className="mt-4 max-w-2xl text-[15px] leading-7 text-text-secondary">
                {t("dashboard.home.subtitle")}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => navigate("/chat")}
                  className="min-w-[112px]"
                >
                  {t("dashboard.home.enterChat")}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => navigate("/settings/general")}
                  className="min-w-[112px]"
                >
                  <Settings className="h-4 w-4" />
                  {t("dashboard.home.checkSettings")}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => logout()}
                  className="min-w-[112px]"
                >
                  <ArrowRight className="h-4 w-4" />
                  {t("dashboard.home.logout")}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 overflow-hidden rounded-ui-overlay border border-border bg-surface-primary shadow-shadow-sm">
          <div className="grid md:grid-cols-3">
            {statusItems.map((item, index) => (
              <div
                key={item.key}
                className={`px-5 py-4 ${
                  index < statusItems.length - 1 ? "border-b border-border md:border-b-0 md:border-r" : ""
                }`}
              >
                <div className="flex items-center gap-2 text-sm text-text-primary">
                  <Circle
                    className={`h-2.5 w-2.5 fill-current ${
                      item.status === "running"
                        ? "text-success"
                        : item.status === "stopped"
                        ? "text-danger"
                        : "text-warning"
                    }`}
                  />
                  <span className="font-medium">{item.label}</span>
                </div>
                <div className="mt-2 font-mono text-[13px] text-text-secondary">
                  {item.value || "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default HomePage;
