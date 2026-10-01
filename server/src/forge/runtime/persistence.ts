import path from "node:path";

function resolveSqliteDatabasePath(databaseUrl: string): string {
  const value = databaseUrl.trim();
  if (!value) {
    throw new Error("DATABASE_URL is required before Forge runtime initialization");
  }

  const filePath = value.startsWith("file:") ? value.slice("file:".length) : value;
  if (
    !filePath ||
    filePath === ":memory:" ||
    (!filePath.endsWith(".db") && !filePath.endsWith(".sqlite"))
  ) {
    throw new Error(
      "Forge runtime requires Mira's durable SQLite DATABASE_URL to resolve backend data ownership",
    );
  }
  if (!path.isAbsolute(filePath)) {
    throw new Error(
      "Forge runtime requires an absolute Mira SQLite DATABASE_URL; relative paths cannot own durable Forge state",
    );
  }

  return path.normalize(filePath);
}

export function resolveForgeStateFileFromDatabaseUrl(databaseUrl: string): string {
  const databasePath = resolveSqliteDatabasePath(databaseUrl);
  return path.join(path.dirname(databasePath), "forge", "state.json");
}

export function resolveForgeStateFile(): string {
  return resolveForgeStateFileFromDatabaseUrl(process.env.DATABASE_URL ?? "");
}
