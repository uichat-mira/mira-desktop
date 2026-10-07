import path from "node:path";
import CONFIG from "@/config/index.js";

export const resolveAppDataStorageRoot = (
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) => {
  const configured = env.UI_CHAT_DATABASE_DIR?.trim();
  if (configured) {
    return path.resolve(cwd, configured);
  }

  const raw = env.DATABASE_URL?.trim() ?? "";
  if (raw.startsWith("file:")) {
    const filePath = raw.slice("file:".length).trim();
    if (filePath) {
      return path.dirname(path.resolve(cwd, filePath));
    }
  }

  if (raw.endsWith(".db") || raw.endsWith(".sqlite")) {
    return path.dirname(path.resolve(cwd, raw));
  }

  return path.resolve(cwd, CONFIG.DATABASE_DIR);
};
