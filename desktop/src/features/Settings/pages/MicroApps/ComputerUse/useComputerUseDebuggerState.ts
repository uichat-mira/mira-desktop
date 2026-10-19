import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getComputerUseRuntimeStatus,
  installComputerUseRuntime,
  type ComputerUseRuntimeState,
} from "@/shared/api/computerUse";

const unavailableStatus: ComputerUseRuntimeState = {
  status: "not_installed",
  message: "Browser runtime status is not available.",
  checkedAt: new Date(0).toISOString(),
};
const defaultApi: ComputerUseRuntimeApi = {};

export type ComputerUseRuntimeApi = Partial<
  Pick<
    typeof import("@/shared/api/computerUse"),
    "getComputerUseRuntimeStatus" | "installComputerUseRuntime"
  >
>;

export function useComputerUseRuntimeState(api: ComputerUseRuntimeApi = defaultApi) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(unavailableStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await (api.getComputerUseRuntimeStatus ?? getComputerUseRuntimeStatus)());
    } catch {
      setStatus(unavailableStatus);
    }
  }, [api]);

  const installRuntime = useCallback(
    async (force = false) => {
      setBusy(true);
      setError(undefined);
      try {
        await (api.installComputerUseRuntime ?? installComputerUseRuntime)(force);
        setStatus(await (api.getComputerUseRuntimeStatus ?? getComputerUseRuntimeStatus)());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t("settings.microApps.computerUseRuntime.errors.requestFailed"),
        );
      } finally {
        setBusy(false);
      }
    },
    [api, t],
  );

  return { status, runtime: status, busy, error, refreshStatus, installRuntime };
}
