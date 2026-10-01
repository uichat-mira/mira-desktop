import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  BrowserRuntimeDownloadRequest,
  BrowserRuntimeManagerOptions,
  BrowserRuntimeRecord,
  BrowserRuntimeStatus,
  ManagedChromiumConfig,
} from "./types.js";
import { resolveManagedChromiumConfig } from "./types.js";

const METADATA_FILE = "managed-chromium.json";

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

const resolveInsideRoot = (rootPath: string, entryPath: string) => {
  const targetPath = path.resolve(rootPath, entryPath);
  const normalizedRoot = path.resolve(rootPath);
  if (
    targetPath !== normalizedRoot &&
    !targetPath.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error("Browser runtime archive contains an entry outside the managed runtime directory.");
  }
  return targetPath;
};

const sha256File = (filePath: string) => {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
};

const isWithin = (rootPath: string, targetPath: string) => {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
};

const isRegularFile = (filePath: string) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const isSafeRelativePath = (relativePath: string) => {
  if (!relativePath || path.isAbsolute(relativePath)) {
    return false;
  }
  return !relativePath.split(/[\\/]+/).some((segment) => segment === "..");
};

const createWindowsSystemBrowserPaths = () => {
  const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
  const programFilesX86 =
    process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const localAppData =
    process.env.LOCALAPPDATA ??
    path.join(process.env.USERPROFILE ?? "C:\\Users\\Default", "AppData", "Local");

  return [
    {
      channel: "chrome" as const,
      executablePath: path.join(
        programFiles,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      version: "system-detected",
    },
    {
      channel: "chrome" as const,
      executablePath: path.join(
        programFilesX86,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      version: "system-detected",
    },
    {
      channel: "chrome" as const,
      executablePath: path.join(
        localAppData,
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
      version: "system-detected",
    },
    {
      channel: "edge" as const,
      executablePath: path.join(
        programFiles,
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
      version: "system-detected",
    },
    {
      channel: "edge" as const,
      executablePath: path.join(
        programFilesX86,
        "Microsoft",
        "Edge",
        "Application",
        "msedge.exe",
      ),
      version: "system-detected",
    },
  ];
};

export const createDefaultSystemBrowserPaths = (
  platform: NodeJS.Platform = process.platform,
): NonNullable<BrowserRuntimeManagerOptions["systemBrowserPaths"]> => {
  if (platform === "darwin") {
    return [
      {
        channel: "chrome" as const,
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        version: "system-detected",
      },
      {
        channel: "edge" as const,
        executablePath:
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        version: "system-detected",
      },
    ];
  }
  if (platform === "win32") {
    return createWindowsSystemBrowserPaths();
  }
  return [];
};

// zip external attributes 的高 16 位是 unix mode+type；DOS 打包的 zip 高位为 0。
const unixModeFromZipAttr = (attr: number | undefined) => {
  if (typeof attr !== "number" || !Number.isFinite(attr)) return 0;
  return (attr >>> 16) & 0o777;
};

export class ComputerUseRuntimeManager {
  private readonly storageRoot: string;
  private readonly managedRoot: string;
  private readonly downloadsRoot: string;
  private readonly metadataPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly managedRuntimeConfig: ManagedChromiumConfig | undefined;
  private readonly systemBrowserPaths: BrowserRuntimeManagerOptions["systemBrowserPaths"];
  private readonly archiveEntriesReader: NonNullable<
    BrowserRuntimeManagerOptions["archiveEntriesReader"]
  >;

  constructor(options: BrowserRuntimeManagerOptions) {
    this.storageRoot = ensureDir(options.storageRoot);
    this.managedRoot = ensureDir(path.join(this.storageRoot, "managed"));
    this.downloadsRoot = ensureDir(path.join(this.storageRoot, "downloads"));
    this.metadataPath = path.join(this.managedRoot, METADATA_FILE);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.managedRuntimeConfig =
      options.managedRuntimeConfig ??
      resolveManagedChromiumConfig({
        platform: this.platform,
        arch: this.arch,
      });
    this.systemBrowserPaths =
      options.systemBrowserPaths ?? createDefaultSystemBrowserPaths(this.platform);
    this.archiveEntriesReader =
      options.archiveEntriesReader ??
      ((archiveFilePath) => new AdmZip(archiveFilePath).getEntries());
  }

  inspectManagedRuntime(): BrowserRuntimeRecord | null {
    const config = this.managedRuntimeConfig;
    if (!config) {
      return null;
    }

    if (!fs.existsSync(this.metadataPath)) {
      return null;
    }

    let parsed: BrowserRuntimeRecord;
    try {
      parsed = JSON.parse(fs.readFileSync(this.metadataPath, "utf8")) as BrowserRuntimeRecord;
    } catch {
      return null;
    }

    // 记录的可执行文件必须与当前平台的托管包布局完全一致；
    // 跨平台错误安装的记录（例如 macOS 上的 win64 记录）必须判无效，不得伪装 ready。
    const expectedExecutablePath = path.join(
      this.managedRoot,
      `chromium-${config.version}`,
      config.executableRelativePath,
    );
    if (
      parsed.source !== "managed" ||
      parsed.channel !== "chromium" ||
      parsed.version !== config.version ||
      parsed.archiveSha256?.toLowerCase() !==
        config.archiveSha256.toLowerCase() ||
      !parsed.executablePath ||
      path.resolve(parsed.executablePath) !== path.resolve(expectedExecutablePath) ||
      !isRegularFile(parsed.executablePath)
    ) {
      return null;
    }

    return { ...parsed, source: "managed", channel: "chromium" };
  }

  inspectSystemBrowsers(): BrowserRuntimeRecord[] {
    return (this.systemBrowserPaths ?? [])
      .filter((candidate) => fs.existsSync(candidate.executablePath))
      .map((candidate) => ({
        source: "system" as const,
        channel: candidate.channel,
        executablePath: candidate.executablePath,
        version: candidate.version ?? "system-detected",
        installedAt: this.now().toISOString(),
      }));
  }

  resolveRuntime(): BrowserRuntimeStatus {
    const managed = this.inspectManagedRuntime();
    const system = this.inspectSystemBrowsers();
    const inspectedCandidates = [
      ...(managed ? [managed] : []),
      ...system,
    ];

    if (managed) {
      return {
        status: "ready",
        runtime: managed,
        strategy: "managed",
        inspectedCandidates,
      };
    }

    if (system.length > 0) {
      return {
        status: "ready",
        runtime: system[0]!,
        strategy: "system",
        inspectedCandidates,
      };
    }

    return {
      status: "not_installed",
      strategy: "download",
      inspectedCandidates,
      reason: this.managedRuntimeConfig
        ? "No managed Chromium or supported system browser was found. Install managed Chromium before execution."
        : `Managed Chromium is not configured for this platform (${this.platform}/${this.arch}). Install a supported system browser (Chrome or Edge) to enable browser sessions.`,
    };
  }

  async installManagedRuntime(
    request?: BrowserRuntimeDownloadRequest,
    options?: { force?: boolean },
  ): Promise<BrowserRuntimeRecord> {
    const config = this.managedRuntimeConfig;
    if (!config) {
      throw new Error(
        `Managed Chromium is not configured for this platform (${this.platform}/${this.arch}). Cannot install a managed browser runtime.`,
      );
    }
    if (
      request &&
      (request.version !== config.version ||
        request.archiveUrl !== config.archiveUrl ||
        request.executableRelativePath !== config.executableRelativePath ||
        (request.expectedSha256 ?? config.archiveSha256).toLowerCase() !==
          config.archiveSha256.toLowerCase())
    ) {
      throw new Error(
        "Browser runtime install request does not match the fixed managed Chromium configuration.",
      );
    }
    const archiveUrl = new URL(config.archiveUrl);
    if (archiveUrl.protocol !== "https:") {
      throw new Error("Browser runtime download only supports HTTPS URLs.");
    }

    if (!isSafeRelativePath(config.executableRelativePath)) {
      throw new Error("Browser runtime executableRelativePath must stay inside the managed runtime directory.");
    }

    const existing = this.inspectManagedRuntime();
    if (existing && !options?.force) {
      return existing;
    }

    const archiveFilePath = path.join(
      this.downloadsRoot,
      `chromium-${config.version}-${crypto.randomUUID()}.zip`,
    );

    const installRoot = path.join(this.managedRoot, `chromium-${config.version}`);
    const partialRoot = `${installRoot}.partial-${crypto.randomUUID()}`;
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(config.archiveUrl);
      } catch (error) {
        throw new Error(
          `Browser runtime download failed: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
      if (!response.ok) {
        throw new Error(`Browser runtime download failed with status ${response.status}.`);
      }

      fs.writeFileSync(archiveFilePath, Buffer.from(await response.arrayBuffer()));
      const actualSha256 = sha256File(archiveFilePath);
      if (actualSha256.toLowerCase() !== config.archiveSha256.toLowerCase()) {
        throw new Error(
          `Browser runtime archive SHA-256 mismatch: expected ${config.archiveSha256}, got ${actualSha256}.`,
        );
      }

      ensureDir(partialRoot);
      const applyUnixMode = (targetPath: string, mode: number) => {
        // 仅非 Windows 平台应用 zip 内 unix 权限；Windows 下 chmod 无对应语义。
        if (this.platform === "win32" || mode === 0) return;
        fs.chmodSync(targetPath, mode);
      };
      for (const entry of this.archiveEntriesReader(archiveFilePath)) {
        const normalizedEntryName = entry.entryName.replace(/\\/g, "/");
        if (
          normalizedEntryName.startsWith("/") ||
          /^[a-zA-Z]:\//.test(normalizedEntryName)
        ) {
          throw new Error("Browser runtime archive contains an absolute entry path.");
        }

        const targetPath = resolveInsideRoot(partialRoot, normalizedEntryName);
        const unixMode = unixModeFromZipAttr(entry.attr);
        if (entry.isDirectory) {
          ensureDir(targetPath);
          applyUnixMode(targetPath, unixMode);
          continue;
        }
        ensureDir(path.dirname(targetPath));
        fs.writeFileSync(targetPath, entry.getData());
        applyUnixMode(targetPath, unixMode);
      }

      const executablePath = path.join(partialRoot, config.executableRelativePath);
      if (!isWithin(partialRoot, executablePath) || !isRegularFile(executablePath)) {
        throw new Error("Browser runtime executable was not found after extraction.");
      }
      // 非 Windows 平台兜底确保主程序可执行，否则后续 launch 会以 EACCES 失败。
      if (this.platform !== "win32") {
        fs.chmodSync(executablePath, 0o755);
      }

      fs.rmSync(installRoot, { recursive: true, force: true });
      fs.renameSync(partialRoot, installRoot);
      const record: BrowserRuntimeRecord = {
        source: "managed",
        channel: "chromium",
        executablePath: path.join(installRoot, config.executableRelativePath),
        version: config.version,
        installedAt: this.now().toISOString(),
        archiveSha256: actualSha256,
      };
      const metadataTempPath = `${this.metadataPath}.tmp-${crypto.randomUUID()}`;
      fs.writeFileSync(metadataTempPath, JSON.stringify(record, null, 2));
      fs.renameSync(metadataTempPath, this.metadataPath);
      return record;
    } catch (error) {
      fs.rmSync(partialRoot, { recursive: true, force: true });
      throw error;
    } finally {
      fs.rmSync(archiveFilePath, { force: true });
    }
  }
}
