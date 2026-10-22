import { get, post } from "@/shared/lib/request";

const BASE = "/microapps/computer-use";

export type ComputerUseRuntimeStatus = "ready" | "not_installed" | "downloading" | "broken";

export interface ComputerUseRuntimeState {
  status: ComputerUseRuntimeStatus;
  browserEngine?: "chromium" | "chrome" | "edge";
  version?: string;
  message?: string;
  checkedAt: string;
  details?: {
    strategy?: "managed" | "system" | "download";
    source?: "managed" | "system";
    executablePath?: string;
    inspectedCandidates?: Array<{
      source: "managed" | "system";
      channel: "chromium" | "chrome" | "edge";
      executablePath: string;
      version: string;
      installedAt: string;
    }>;
  };
}

export async function getComputerUseRuntimeStatus(): Promise<ComputerUseRuntimeState> {
  return get<ComputerUseRuntimeState>(`${BASE}/runtime`);
}

export async function installComputerUseRuntime(force = false): Promise<void> {
  await post(`${BASE}/runtime/install`, { force });
}
