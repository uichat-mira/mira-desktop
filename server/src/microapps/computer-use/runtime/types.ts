export type BrowserRuntimeSource = "managed" | "system";

export type BrowserRuntimeRecord = {
  source: BrowserRuntimeSource;
  channel: "chromium" | "chrome" | "edge";
  executablePath: string;
  version: string;
  installedAt: string;
  archiveSha256?: string;
};

export type BrowserRuntimeStatus =
  | {
      status: "ready";
      runtime: BrowserRuntimeRecord;
      strategy: "managed" | "system";
      inspectedCandidates: BrowserRuntimeRecord[];
    }
  | {
      status: "not_installed";
      strategy: "download";
      inspectedCandidates: BrowserRuntimeRecord[];
      reason: string;
    };

export type ManagedChromiumPlatform = "win64" | "mac-arm64";

export type ManagedChromiumConfig = {
  product: "chrome-for-testing";
  platform: ManagedChromiumPlatform;
  version: string;
  archiveUrl: string;
  executableRelativePath: string;
  archiveSha256: string;
};

const MANAGED_CHROMIUM_VERSION = "152.0.7948.0";

export const MANAGED_CHROMIUM_CONFIGS: Readonly<
  Record<ManagedChromiumPlatform, ManagedChromiumConfig>
> = Object.freeze({
  win64: Object.freeze({
    product: "chrome-for-testing",
    platform: "win64",
    version: MANAGED_CHROMIUM_VERSION,
    archiveUrl:
      "https://storage.googleapis.com/chrome-for-testing-public/152.0.7948.0/win64/chrome-win64.zip",
    executableRelativePath: "chrome-win64/chrome.exe",
    archiveSha256:
      "b9a7af5e9f1055561e4aac6322bd11bf6c22feac9c565ab5112ffea005a390f9",
  }),
  "mac-arm64": Object.freeze({
    product: "chrome-for-testing",
    platform: "mac-arm64",
    version: MANAGED_CHROMIUM_VERSION,
    archiveUrl:
      "https://storage.googleapis.com/chrome-for-testing-public/152.0.7948.0/mac-arm64/chrome-mac-arm64.zip",
    executableRelativePath:
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    archiveSha256:
      "0bb76b67c7d68e6717969d99ff561d28b62ca8bf781d4925fc9d8aa62e1d49d8",
  }),
});

export type ManagedChromiumConfigResolutionInput = {
  platform?: NodeJS.Platform;
  arch?: string;
};

// 平台没有固定托管包配置时返回 undefined，调用方必须显式处理，不得静默兜底。
export const resolveManagedChromiumConfig = (
  input: ManagedChromiumConfigResolutionInput = {},
): ManagedChromiumConfig | undefined => {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  if (platform === "win32") {
    return MANAGED_CHROMIUM_CONFIGS.win64;
  }
  if (platform === "darwin" && arch === "arm64") {
    return MANAGED_CHROMIUM_CONFIGS["mac-arm64"];
  }
  return undefined;
};

export type BrowserRuntimeDownloadRequest = {
  version: string;
  archiveUrl: string;
  executableRelativePath: string;
  expectedSha256?: string;
};

export type BrowserRuntimeManagerOptions = {
  storageRoot: string;
  platform?: NodeJS.Platform;
  arch?: string;
  managedRuntimeConfig?: ManagedChromiumConfig;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  systemBrowserPaths?: Array<{
    channel: "chrome" | "edge";
    executablePath: string;
    version?: string;
  }>;
  archiveEntriesReader?: (
    archiveFilePath: string,
  ) => Array<{
    entryName: string;
    isDirectory: boolean;
    attr?: number;
    getData(): Buffer;
  }>;
};
