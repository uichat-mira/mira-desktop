import { spawnSync } from "node:child_process";

/**
 * Host prerequisites for structured-document integration tests.
 *
 * Keep fixture creation and runtime probes on the same Python executable so a
 * POSIX host with python3 but no python alias does not pass the probe and then
 * fail while constructing the fixture.
 */
export const resolveExternalToolingPython = (): string =>
  process.platform === "win32" ? "python" : "python3";

const canRunPythonModule = (moduleName: string): boolean => {
  const result = spawnSync(
    resolveExternalToolingPython(),
    ["-c", "import " + moduleName],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  return !result.error && result.status === 0;
};

const canRunCommand = (command: string): boolean => {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
};

export const hasPythonOfficeTooling = (): boolean =>
  canRunPythonModule("docx") &&
  canRunPythonModule("pptx") &&
  canRunPythonModule("openpyxl");

export const hasPdfTextTooling = (): boolean => canRunCommand("pdftotext");

export const hasExternalDocumentTooling = (): boolean =>
  hasPythonOfficeTooling() && hasPdfTextTooling();

/**
 * read_discover locate mode dispatches to ripgrep. Without a resolvable rg
 * binary the candidate set silently shrinks, so locate assertions are only
 * meaningful where ripgrep is actually available.
 */
export const hasRipgrep = (): boolean => canRunCommand("rg");
