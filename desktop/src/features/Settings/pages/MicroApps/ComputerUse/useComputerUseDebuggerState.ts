import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  approveComputerUseSession, assertComputerUseSession, createComputerUseSession, executeComputerUseAction, getComputerUseDebuggerStatus, installComputerUseRuntime, observeComputerUseSession, rejectComputerUseSession, stopComputerUseSession,
  type ComputerUseActionInput, type ComputerUseDebuggerStatus, type ComputerUseSession, type ComputerUseSessionConfig, type ComputerUseAssertionInput,
} from "@/shared/api/computerUse";

const initialConfig: ComputerUseSessionConfig = { runtime: "managed", url: "https://example.com", allowedDomains: ["example.com"], limits: { timeoutMs: 30000, maxSnapshotChars: 12000 }, approvalPolicy: "write_actions" };
const unavailableStatus: ComputerUseDebuggerStatus = { runtime: { status: "not_installed", message: "Browser runtime status is not available.", checkedAt: new Date(0).toISOString() } };
const defaultApi: ComputerUseDebuggerApi = {};

export type ComputerUseDebuggerApi = Partial<Pick<typeof import("@/shared/api/computerUse"), "getComputerUseDebuggerStatus" | "installComputerUseRuntime" | "createComputerUseSession" | "observeComputerUseSession" | "executeComputerUseAction" | "assertComputerUseSession" | "approveComputerUseSession" | "rejectComputerUseSession" | "stopComputerUseSession">>;
export function useComputerUseDebuggerState(api: ComputerUseDebuggerApi = defaultApi) {
  const { t } = useTranslation();
  const [config, setConfigState] = useState(initialConfig); const [status, setStatus] = useState(unavailableStatus); const [session, setSession] = useState<ComputerUseSession>(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const call = useCallback(async <T,>(fn: () => Promise<T>, next: (value: T) => void) => { setBusy(true); setError(undefined); try { next(await fn()); } catch (err) { setError(err instanceof Error ? err.message : t("settings.microApps.computerUseDebugger.errors.requestFailed")); } finally { setBusy(false); } }, [t]);
  const refreshStatus = useCallback(async () => { try { setStatus(await (api.getComputerUseDebuggerStatus ?? getComputerUseDebuggerStatus)()); } catch { setStatus(unavailableStatus); } }, [api]);
  const installRuntime = (force = false) => call(async () => { await (api.installComputerUseRuntime ?? installComputerUseRuntime)(force); return (api.getComputerUseDebuggerStatus ?? getComputerUseDebuggerStatus)(); }, setStatus);
  const setConfig = (patch: Partial<ComputerUseSessionConfig>) => setConfigState((value) => ({ ...value, ...patch }));
  const newSession = () => call(() => (api.createComputerUseSession ?? createComputerUseSession)(config), setSession);
  const observe = () => session && call(() => (api.observeComputerUseSession ?? observeComputerUseSession)(session.sessionId), setSession);
  const executeAction = (input: ComputerUseActionInput) => session && call(() => (api.executeComputerUseAction ?? executeComputerUseAction)(session.sessionId, input), setSession);
  const assertState = (input: ComputerUseAssertionInput) => session && call(() => (api.assertComputerUseSession ?? assertComputerUseSession)(session.sessionId, input), setSession);
  const approve = () => session?.approval?.invocationId && call(() => (api.approveComputerUseSession ?? approveComputerUseSession)(session.sessionId, session.approval!.invocationId!), setSession);
  const reject = () => session?.approval?.invocationId && call(() => (api.rejectComputerUseSession ?? rejectComputerUseSession)(session.sessionId, session.approval!.invocationId!), setSession);
  const stop = () => session && call(() => (api.stopComputerUseSession ?? stopComputerUseSession)(session.sessionId), setSession);
  return { config, setConfig, status, runtime: status.runtime, session, busy, error, refreshStatus, installRuntime, newSession, observe, executeAction, assertState, approve, reject, stop, reset: () => { setSession(undefined); setError(undefined); setConfigState(initialConfig); } };
}
