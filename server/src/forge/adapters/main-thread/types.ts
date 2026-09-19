import type {
  MainThreadAdapterId,
  MainThreadEventInput,
} from "../../main-thread/domain.js";

export interface MainThreadAdapterTurnInput {
  projectRoot: string;
  message: string;
  externalThreadId: string | null;
  model: string | null;
  onEvent?: (event: MainThreadEventInput) => void | Promise<void>;
}

export interface MainThreadAdapterTurnResult {
  externalThreadId: string;
  responseText: string;
  events: MainThreadEventInput[];
  providerEventType: string;
}

export interface MainThreadAdapter {
  id: MainThreadAdapterId;
  runTurn(
    input: MainThreadAdapterTurnInput,
  ): Promise<MainThreadAdapterTurnResult>;
  dispose?(): void | Promise<void>;
}
