type ActiveAgentRunControl = {
  controller: AbortController;
  leaseId: string;
};

const activeRunControllers = new Map<string, ActiveAgentRunControl>();
let nextLeaseId = 0;

const supersededController = new AbortController();
supersededController.abort();
const SUPERSEDED_SIGNAL = supersededController.signal;

export interface AgentRunControlLease {
  leaseId: string;
  signal: AbortSignal;
}

export const startAgentRunControlLease = (
  runId: string,
): AgentRunControlLease => {
  const previous = activeRunControllers.get(runId);
  previous?.controller.abort();

  const controller = new AbortController();
  const leaseId = `${runId}:${++nextLeaseId}`;
  activeRunControllers.set(runId, { controller, leaseId });
  return { leaseId, signal: controller.signal };
};

export const startAgentRunControl = (runId: string): AbortSignal =>
  startAgentRunControlLease(runId).signal;

export const getAgentRunSignal = (
  runId: string,
  leaseId?: string,
): AbortSignal | undefined => {
  const active = activeRunControllers.get(runId);
  if (!active) return leaseId ? SUPERSEDED_SIGNAL : undefined;
  if (leaseId && active.leaseId !== leaseId) return SUPERSEDED_SIGNAL;
  return active.controller.signal;
};

export const isAgentRunCancellationRequested = (
  runId: string,
  leaseId?: string,
): boolean => {
  const active = activeRunControllers.get(runId);
  if (leaseId && active?.leaseId !== leaseId) return true;
  return active?.controller.signal.aborted ?? false;
};

export const cancelAgentRunExecution = (runId: string): boolean => {
  const active = activeRunControllers.get(runId);
  if (!active) return false;
  active.controller.abort();
  return true;
};

export const finishAgentRunControl = (
  runId: string,
  leaseId?: string,
): void => {
  const active = activeRunControllers.get(runId);
  if (!active) return;
  if (leaseId && active.leaseId !== leaseId) return;
  activeRunControllers.delete(runId);
};

export const clearAgentRunControls = (): void => {
  for (const active of activeRunControllers.values()) {
    active.controller.abort();
  }
  activeRunControllers.clear();
};
