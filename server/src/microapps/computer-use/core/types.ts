export type ComputerUseRuntimeStatus =
  | "ready"
  | "not_installed"
  | "downloading"
  | "broken";

export type ComputerUseRuntimeState = {
  status: ComputerUseRuntimeStatus;
  browserEngine?: string;
  version?: string;
  message?: string;
  checkedAt: string;
  details?: Record<string, unknown>;
};
