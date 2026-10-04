import { spawnSync } from "node:child_process";
import path from "node:path";
import type { ToolExecutionEnvironment } from "../mcp/core/definitions.js";
import { getWorkspaceSelection } from "../mcp/workspace.js";
import { probeRipgrepProvider } from "../mcp/read/ripgrep-provider.js";

export interface HarnessToolConfig {
  web_search?: {
    apiKey?: string;
    baseUrl?: string;
  };
}

let cachedRipgrepAvailability: boolean | null = null;
let cachedWindowsShellPath: string | null = null;

const detectRipgrepAvailability = () => {
  if (cachedRipgrepAvailability !== null) {
    return cachedRipgrepAvailability;
  }

  cachedRipgrepAvailability = probeRipgrepProvider().available;
  return cachedRipgrepAvailability;
};

const resolveWindowsShellExecutable = () => {
  if (cachedWindowsShellPath !== null) {
    return cachedWindowsShellPath;
  }

  const systemRoot = process.env.SystemRoot?.trim();
  if (systemRoot) {
    const candidate = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const result = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf-8",
      windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      cachedWindowsShellPath = candidate;
      return cachedWindowsShellPath;
    }
  }

  cachedWindowsShellPath = "powershell.exe";
  return cachedWindowsShellPath;
};

const defaultReadCapabilities: ToolExecutionEnvironment["read"]["capabilities"] = [
  {
    id: "node-fs-directory",
    kind: "directory",
    provider: "node-fs",
    available: true,
    priority: 100,
  },
  {
    id: "fast-glob-locate",
    kind: "locate",
    provider: "fast-glob",
    available: true,
    priority: 100,
  },
  {
    id: "ripgrep-locate",
    kind: "locate",
    provider: "ripgrep",
    available: detectRipgrepAvailability(),
    priority: 95,
  },
  {
    id: "node-content-scan-locate",
    kind: "locate",
    provider: "node-fs",
    available: true,
    priority: 40,
  },
  {
    id: "pdf-cli-extract",
    kind: "extract",
    provider: "pdftotext",
    available: true,
    priority: 100,
    extensions: [".pdf"],
  },
  {
    id: "docx-cli-extract",
    kind: "extract",
    provider: "python-docx",
    available: true,
    priority: 90,
    extensions: [".docx"],
  },
  {
    id: "pptx-cli-extract",
    kind: "extract",
    provider: "python-pptx",
    available: true,
    priority: 90,
    extensions: [".pptx"],
  },
  {
    id: "xlsx-cli-extract",
    kind: "extract",
    provider: "python-openpyxl",
    available: true,
    priority: 90,
    extensions: [".xlsx"],
  },
  {
    id: "text-slice",
    kind: "slice",
    provider: "node-fs",
    available: true,
    priority: 100,
  },
  {
    id: "text-known-extension",
    kind: "text",
    provider: "node-fs",
    available: true,
    priority: 80,
  },
  {
    id: "text-content-probe",
    kind: "text",
    provider: "node-fs",
    available: true,
    priority: 40,
  },
  {
    id: "binary-summary",
    kind: "fallback",
    provider: "node-fs",
    available: true,
    priority: 10,
  },
];

const defaultEditCapabilities: ToolExecutionEnvironment["edit"]["capabilities"] = [
  {
    id: "node-fs-write-file",
    kind: "write",
    provider: "node-fs",
    available: true,
    priority: 100,
  },
  {
    id: "node-fs-replace-block",
    kind: "replace",
    provider: "node-fs",
    available: true,
    priority: 100,
  },
];

const defaultWebSearchCapabilities: ToolExecutionEnvironment["web_search"]["capabilities"] = [
  {
    id: "tavily-search",
    kind: "fallback",
    provider: "tavily",
    available: true,
    priority: 100,
  },
  {
    id: "searxng-search",
    kind: "fallback",
    provider: "searxng",
    available: true,
    priority: 90,
  },
];

const defaultTerminalCapabilities: ToolExecutionEnvironment["terminal"]["capabilities"] = [
  {
    id: "child-process-shell-command",
    kind: "write",
    provider: "node-child_process",
    available: true,
    priority: 110,
  },
  {
    id: "pty-shell-session",
    kind: "write",
    provider: "node-pty",
    available: true,
    priority: 100,
  },
];

// Resolved per snapshot instead of once at module load so the platform is read
// at call time. Import-time evaluation froze the first host's shell profile for
// the whole process, which made platform-dependent behavior untestable.
const createDefaultTerminalShellProfile = (): ToolExecutionEnvironment["terminal"]["shellProfile"] =>
  process.platform === "win32"
    ? {
        shell: resolveWindowsShellExecutable(),
        shellFamily: "powershell",
        argsMode: "powershell",
        stdoutEncoding: "utf16le",
        stderrEncoding: "utf16le",
      }
    : {
        shell: process.env.SHELL || "bash",
        shellFamily: "posix",
        argsMode: "posix",
        stdoutEncoding: "utf8",
        stderrEncoding: "utf8",
      };

export const createHarnessEnvironmentSnapshot = (
  overrides: Partial<ToolExecutionEnvironment> & {
    toolConfig?: HarnessToolConfig;
  } = {},
): ToolExecutionEnvironment => {
  const workspace = getWorkspaceSelection();

  return {
    source: "harness",
    workspace: overrides.workspace ?? workspace,
    approvals: {
      outsideWorkspace: "prompt",
      persistence: "thread",
      ...overrides.approvals,
    },
    trace: {
      streamEvents: true,
      ...overrides.trace,
    },
    read: {
      capabilities:
        overrides.read?.capabilities?.map((capability) => ({ ...capability })) ??
        defaultReadCapabilities.map((capability) => ({ ...capability })),
    },
    edit: {
      capabilities:
        overrides.edit?.capabilities?.map((capability) => ({ ...capability })) ??
        defaultEditCapabilities.map((capability) => ({ ...capability })),
    },
    web_search: {
      capabilities:
        overrides.web_search?.capabilities?.map((capability) => ({ ...capability })) ??
        defaultWebSearchCapabilities.map((capability) => ({ ...capability })),
    },
    terminal: {
      capabilities:
        overrides.terminal?.capabilities?.map((capability) => ({ ...capability })) ??
        defaultTerminalCapabilities.map((capability) => ({ ...capability })),
      shellProfile: overrides.terminal?.shellProfile ?? createDefaultTerminalShellProfile(),
    },
    ...(overrides.toolConfig ? { toolConfig: overrides.toolConfig } : {}),
  };
};

export const getHarnessEnvironmentSnapshot = () => createHarnessEnvironmentSnapshot();
