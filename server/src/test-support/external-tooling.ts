import { spawnSync } from "node:child_process";

/**
 * Probes whether an external document toolchain is usable on the current host.
 *
 * Several structured document readers shell out to pdftotext, python and the
 * Python docx / pptx / openpyxl packages. Those are host prerequisites, not
 * product behavior, so tests that build real office fixtures must be skipped
 * when the toolchain is absent instead of failing.
 *
 * This never weakens a product assertion; it only decides whether a test that
 * cannot construct its fixture is runnable at all.
 */
const probeCache = new Map<string, boolean>();

const pythonExecutable = (): string =>
  process.platform === "win32" ? "python" : "python3";

const canRunPythonModule = (moduleName: string): boolean => {
  const result = spawnSync(pythonExecutable(), ["-c", "import " + moduleName], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
};

const canRunCommand = (command: string): boolean => {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
};

export const hasExternalDocumentTooling = (): boolean => {
  const cached = probeCache.get("document");
  if (cached !== undefined) return cached;

  const available =
    canRunCommand("pdftotext") &&
    canRunPythonModule("docx") &&
    canRunPythonModule("pptx") &&
    canRunPythonModule("openpyxl");

  probeCache.set("document", available);
  return available;
};

/**
 * read_discover locate mode dispatches to ripgrep. Without a resolvable rg
 * binary the candidate set silently shrinks, so locate assertions are only
 * meaningful where ripgrep is actually available.
 */
export const hasRipgrep = (): boolean => {
  const cached = probeCache.get("ripgrep");
  if (cached !== undefined) return cached;

  const available = canRunCommand("rg");
  probeCache.set("ripgrep", available);
  return available;
};
