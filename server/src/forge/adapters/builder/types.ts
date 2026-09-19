export interface BuilderProviderEvent {
  externalSessionId?: unknown;
  sessionID?: unknown;
  thread_id?: unknown;
  threadId?: unknown;
  provider?: {
    adapter?: unknown;
    eventType?: unknown;
    itemType?: unknown;
    status?: unknown;
  } | null;
  tool?: {
    name?: unknown;
    status?: unknown;
  } | null;
  artifact?: {
    kind?: unknown;
    ref?: unknown;
  } | null;
}

export interface BuilderExitResult {
  code: number | null;
  signal: string | null;
  stderr: string;
  resultText: string | null;
  errorText: string | null;
}

export interface BuilderStartInput {
  projectRoot: string;
  prompt: string;
  model: string | null;
  agent: string | null;
  onStarted?: (info: { pid: number | null }) => void;
  onEvent?: (event: BuilderProviderEvent) => void;
  onExit?: (result: BuilderExitResult) => void;
  onError?: (error: unknown, details: { stderr: string }) => void;
}

export interface BuilderProcessHandle {
  readonly pid: number | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface BuilderRunner {
  start(input: BuilderStartInput): BuilderProcessHandle;
}
