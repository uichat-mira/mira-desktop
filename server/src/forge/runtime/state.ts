import type {
  ForgeAdapter,
  ForgeBatch,
  ForgeCoreState,
  ForgeDispatch,
  ForgeProject,
  ForgeReview,
  ForgeRuntimeEvent,
  ForgeSession,
} from "../types.js";

export const FORGE_RUNTIME_SCHEMA_VERSION = 1 as const;

export interface ForgeRuntimeThreadRecord {
  id: string;
  projectId: string;
  adapter: string;
  status: string;
  lastError: string | null;
  updatedAt: string;
  [key: string]: unknown;
}

export interface ForgeRuntimeThreadEventRecord {
  id: string;
  threadId: string;
  projectId: string;
  type: string;
  role: string | null;
  text: string | null;
  tool: Record<string, unknown> | null;
  artifact: Record<string, unknown> | null;
  handoff: Record<string, unknown> | null;
  provider: Record<string, unknown> | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface ForgeRuntimeState extends ForgeCoreState {
  schemaVersion: typeof FORGE_RUNTIME_SCHEMA_VERSION;
  projects: ForgeProject[];
  batches: ForgeBatch[];
  adapters: ForgeAdapter[];
  sessions: ForgeSession[];
  reviews: ForgeReview[];
  dispatches: ForgeDispatch[];
  events: ForgeRuntimeEvent[];
  threads: ForgeRuntimeThreadRecord[];
  threadEvents: ForgeRuntimeThreadEventRecord[];
}

export function createEmptyForgeRuntimeState(): ForgeRuntimeState {
  return {
    schemaVersion: FORGE_RUNTIME_SCHEMA_VERSION,
    projects: [],
    batches: [],
    adapters: [],
    sessions: [],
    reviews: [],
    dispatches: [],
    events: [],
    threads: [],
    threadEvents: [],
  };
}
