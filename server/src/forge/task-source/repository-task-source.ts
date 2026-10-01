import {
  realpath,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { ForgeProject } from "../types.js";

export interface RepositoryTaskSummary {
  id: string;
  title: string;
  status: string;
  cardStatus: string;
  taskRef: string;
  warnings: string[];
}

export interface RepositoryTaskSourceInspection {
  kind: "repository-markdown";
  ledgerRef: string;
  taskDirRef: string;
  tasks: RepositoryTaskSummary[];
}

export interface CreateRepositoryTaskInput {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  body?: unknown;
  content?: unknown;
}

export interface UpdateRepositoryTaskInput {
  title?: unknown;
  status?: unknown;
  content?: unknown;
}

type AtomicWrite = (filePath: string, content: string) => Promise<void>;

const projectWriteQueues = new Map<string, Promise<void>>();

async function withProjectWriteLock<T>(
  project: ForgeProject,
  operation: () => Promise<T>,
): Promise<T> {
  const rootInput = requiredString(project?.rootPath, "project.rootPath");
  const root = await realpath(rootInput).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("project root is unavailable: " + message);
  });

  const previous = projectWriteQueues.get(root) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.then(() => gate);
  projectWriteQueues.set(root, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectWriteQueues.get(root) === tail) {
      projectWriteQueues.delete(root);
    }
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(name + " is required");
  }
  return value.trim();
}

function singleLine(value: unknown, name: string): string {
  const text = requiredString(value, name);
  if (/\r|\n|\|/.test(text)) {
    throw new Error(name + " must be a single Markdown-table-safe line");
  }
  return text;
}

function normalizeTaskId(value: unknown): string {
  const id = requiredString(value, "taskId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error("taskId contains unsupported characters");
  }
  return id;
}

function repositoryRef(value: unknown, name: string): string {
  const ref = requiredString(value, name);
  if (isAbsolute(ref)) {
    throw new Error(name + " must be repository-relative");
  }
  return ref;
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

function assertInside(root: string, candidate: string, name: string): void {
  if (!inside(root, candidate)) {
    throw new Error(name + " escapes project root");
  }
}

function toRepositoryRef(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join("/");
}

interface ConfiguredPaths {
  root: string;
  ledgerPath: string;
  taskDirPath: string;
  ledgerRef: string;
  taskDirRef: string;
}

async function configuredPaths(project: ForgeProject): Promise<ConfiguredPaths> {
  const rootInput = requiredString(project?.rootPath, "project.rootPath");
  const ledgerRef = repositoryRef(project?.taskLedger, "project.taskLedger");
  const taskDirRef = repositoryRef(project?.taskDir, "project.taskDir");

  const root = await realpath(rootInput).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("project root is unavailable: " + message);
  });

  const ledgerCandidate = resolve(root, ledgerRef);
  const taskDirCandidate = resolve(root, taskDirRef);
  assertInside(root, ledgerCandidate, "task ledger");
  assertInside(root, taskDirCandidate, "task directory");

  const ledgerPath = await realpath(ledgerCandidate).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("task ledger is unavailable: " + ledgerRef + ": " + message);
  });
  const taskDirPath = await realpath(taskDirCandidate).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("task directory is unavailable: " + taskDirRef + ": " + message);
  });

  assertInside(root, ledgerPath, "task ledger");
  assertInside(root, taskDirPath, "task directory");

  const [ledgerInfo, taskDirInfo] = await Promise.all([stat(ledgerPath), stat(taskDirPath)]);
  if (!ledgerInfo.isFile()) throw new Error("task ledger is not a file: " + ledgerRef);
  if (!taskDirInfo.isDirectory()) throw new Error("task directory is not a directory: " + taskDirRef);

  return {
    root,
    ledgerPath,
    taskDirPath,
    ledgerRef: toRepositoryRef(root, ledgerPath),
    taskDirRef: toRepositoryRef(root, taskDirPath),
  };
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const body = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += char === "|" ? "|" : "\\" + char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

interface LedgerRow {
  lineIndex: number;
  cells: string[];
}

interface ParsedLedger {
  lines: string[];
  headers: string[];
  rows: LedgerRow[];
  endIndex: number;
  idIndex: number;
  taskIndex: number;
  statusIndex: number;
}

function parseLedger(markdown: string): ParsedLedger {
  const lines = markdown.split(/\r?\n/);
  for (let headerIndex = 0; headerIndex < lines.length - 1; headerIndex += 1) {
    const headers = parseTableRow(lines[headerIndex] ?? "");
    const separator = parseTableRow(lines[headerIndex + 1] ?? "");
    if (!headers || !separator || headers.length !== separator.length || !isSeparatorRow(separator)) continue;

    const normalized = headers.map((header) => header.toLowerCase());
    const idIndex = normalized.indexOf("id");
    const taskIndex = normalized.indexOf("task");
    const statusIndex = normalized.indexOf("status");
    if (idIndex === -1 || taskIndex === -1 || statusIndex === -1) continue;

    const rows: LedgerRow[] = [];
    let endIndex = headerIndex + 2;
    for (; endIndex < lines.length; endIndex += 1) {
      const cells = parseTableRow(lines[endIndex] ?? "");
      if (!cells) break;
      if (cells.length !== headers.length) {
        throw new Error("malformed task ledger row at line " + (endIndex + 1));
      }
      rows.push({ lineIndex: endIndex, cells });
    }

    const seen = new Set<string>();
    for (const row of rows) {
      const id = normalizeTaskId(row.cells[idIndex]);
      if (seen.has(id)) throw new Error("task " + id + " appears more than once in repository ledger");
      seen.add(id);
      singleLine(row.cells[taskIndex], "ledger task title for " + id);
      singleLine(row.cells[statusIndex], "ledger task status for " + id);
    }

    return { lines, headers, rows, endIndex, idIndex, taskIndex, statusIndex };
  }
  throw new Error("task ledger must contain a Markdown table with ID, Task and Status columns");
}

function ledgerTask(table: ParsedLedger, id: string) {
  const row = table.rows.find((item) => item.cells[table.idIndex] === id);
  if (!row) throw new Error("task " + id + " is not present in repository ledger");
  return {
    row,
    title: requiredString(row.cells[table.taskIndex], "ledger task title for " + id),
    status: requiredString(row.cells[table.statusIndex], "ledger task status for " + id),
  };
}

function renderTableRow(cells: string[]): string {
  return "| " + cells.map((cell) => String(cell).trim().replace(/\|/g, "\\|")).join(" | ") + " |";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

async function cardPathForTask(
  paths: ConfiguredPaths,
  id: string,
  options: { required?: boolean } = {},
): Promise<string | null> {
  const required = options.required ?? true;
  const matcher = new RegExp("^" + escapeRegExp(id) + "(?:[._-].*)?\\.md$");
  const entries = await readdir(paths.taskDirPath, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && matcher.test(entry.name)).map((entry) => entry.name);

  if (names.length === 0) {
    if (required) throw new Error("task card not found for " + id + " under " + paths.taskDirRef);
    return null;
  }
  if (names.length > 1) throw new Error("multiple task cards match " + id + ": " + names.join(", "));

  const candidate = join(paths.taskDirPath, names[0]!);
  const actual = await realpath(candidate);
  assertInside(paths.root, actual, "task card");
  return actual;
}

function stripSimpleMarkdownEmphasis(value: string): string {
  const text = value.trim();
  const bold = text.match(/^\*\*(.+)\*\*$/);
  return (bold?.[1] ?? text).trim();
}

function parseTaskCard(content: string, expectedId: string) {
  const headingLine = content.match(/^#\s+(.+?)\s*$/m);
  if (!headingLine) throw new Error("task card " + expectedId + " must contain a level-1 heading with its task ID");

  const heading = headingLine[1]!.trim();
  const headingId = heading.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?=$|\s|[:：—–])/)?.[1];
  if (!headingId) throw new Error("task card " + expectedId + " must contain a level-1 heading with its task ID");
  if (headingId !== expectedId) throw new Error("task card heading ID " + headingId + " does not match " + expectedId);

  const titleTail = heading.slice(headingId.length).trim();
  const title = titleTail.replace(/^(?:[—–-]|[:：])\s*/, "").trim() || expectedId;
  const status = content.match(/^(?:Status\s*:|状态\s*[:：])\s*(.+?)\s*$/m);
  if (!status || !status[1]?.trim()) throw new Error("task card " + expectedId + " must contain a Status line");

  return { title, status: stripSimpleMarkdownEmphasis(status[1]) };
}

function replaceTaskCardFields(
  content: string,
  input: { id: string; title?: unknown; status?: unknown },
): string {
  let next = content;
  if (input.title !== undefined) {
    const safeTitle = singleLine(input.title, "title");
    next = next.replace(
      /^#\s+.+?\s*$/m,
      () => "# " + input.id + " — " + safeTitle,
    );
  }
  if (input.status !== undefined) {
    const safeStatus = singleLine(input.status, "status");
    next = next.replace(
      /^(?:Status\s*:|状态\s*[:：])\s*.+?\s*$/m,
      () => "Status: " + safeStatus,
    );
  }
  parseTaskCard(next, input.id);
  return next;
}

function normalizeExplicitContent(content: unknown, id: string) {
  const text = requiredString(content, "content").replace(/\r\n/g, "\n");
  const parsed = parseTaskCard(text, id);
  return {
    content: text.endsWith("\n") ? text : text + "\n",
    title: singleLine(parsed.title, "title"),
    status: singleLine(parsed.status, "status"),
  };
}

function makeTaskCard(input: { id: string; title: unknown; status?: unknown; body?: unknown }): string {
  const safeTitle = singleLine(input.title, "title");
  const safeStatus = singleLine(input.status ?? "TODO", "status");
  const suffix = typeof input.body === "string" && input.body.trim() ? "\n" + input.body.trim() + "\n" : "";
  return "# " + input.id + " — " + safeTitle + "\n\nStatus: " + safeStatus + "\n" + suffix;
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function defaultAtomicWrite(filePath: string, content: string): Promise<void> {
  const temp = join(dirname(filePath), "." + basename(filePath) + "." + process.pid + "." + Date.now() + ".tmp");
  await writeFile(temp, content, "utf8");
  await rename(temp, filePath);
}

async function readLedger(paths: ConfiguredPaths) {
  const markdown = await readFile(paths.ledgerPath, "utf8");
  return { markdown, table: parseLedger(markdown) };
}

function normalizedReference(
  paths: ConfiguredPaths,
  id: string,
  ledger: { title: string; status: string },
  cardPath: string,
  card: { title: string; status: string },
): RepositoryTaskSummary {
  const warnings: string[] = [];
  if (ledger.status !== card.status) warnings.push("ledger status " + ledger.status + " differs from task card status " + card.status);
  if (ledger.title !== card.title) warnings.push("ledger title differs from task card title");
  return {
    id,
    title: ledger.title,
    status: ledger.status,
    cardStatus: card.status,
    taskRef: toRepositoryRef(paths.root, cardPath),
    warnings,
  };
}

export class RepositoryTaskSource {
  constructor(private readonly atomicWrite: AtomicWrite = defaultAtomicWrite) {}

  async inspect(project: ForgeProject): Promise<RepositoryTaskSourceInspection> {
    const paths = await configuredPaths(project);
    const { table } = await readLedger(paths);
    const tasks: RepositoryTaskSummary[] = [];

    for (const row of table.rows) {
      const id = normalizeTaskId(row.cells[table.idIndex]);
      const ledger = ledgerTask(table, id);
      const cardPath = await cardPathForTask(paths, id);
      if (!cardPath) throw new Error("task card not found for " + id);
      const card = parseTaskCard(await readFile(cardPath, "utf8"), id);
      tasks.push(normalizedReference(paths, id, ledger, cardPath, card));
    }

    return { kind: "repository-markdown", ledgerRef: paths.ledgerRef, taskDirRef: paths.taskDirRef, tasks };
  }

  async resolve(project: ForgeProject, inputTaskId: unknown): Promise<RepositoryTaskSummary> {
    const id = normalizeTaskId(inputTaskId);
    const paths = await configuredPaths(project);
    const { table } = await readLedger(paths);
    const ledger = ledgerTask(table, id);
    const cardPath = await cardPathForTask(paths, id);
    if (!cardPath) throw new Error("task card not found for " + id);
    const card = parseTaskCard(await readFile(cardPath, "utf8"), id);
    return normalizedReference(paths, id, ledger, cardPath, card);
  }

  async create(project: ForgeProject, input: CreateRepositoryTaskInput): Promise<RepositoryTaskSummary> {
    return withProjectWriteLock(project, async () => {
    await this.inspect(project);
    const id = normalizeTaskId(input?.id);
    const paths = await configuredPaths(project);
    const { table } = await readLedger(paths);

    if (table.rows.some((row) => row.cells[table.idIndex] === id)) {
      throw new Error("task " + id + " already exists in repository ledger");
    }
    if (await cardPathForTask(paths, id, { required: false })) {
      throw new Error("task card already exists for " + id);
    }

    let cardContent: string;
    let title: string;
    let status: string;
    if (input?.content !== undefined) {
      if (input.title !== undefined || input.status !== undefined || input.body !== undefined) {
        throw new Error("content cannot be combined with title, status or body");
      }
      const explicit = normalizeExplicitContent(input.content, id);
      cardContent = explicit.content;
      title = explicit.title;
      status = explicit.status;
    } else {
      title = singleLine(input?.title, "title");
      status = singleLine(input?.status ?? "TODO", "status");
      cardContent = makeTaskCard({ id, title, status, body: input?.body });
    }

    const filenameSlug = slug(title);
    const filename = filenameSlug ? id + "-" + filenameSlug + ".md" : id + ".md";
    const cardPath = join(paths.taskDirPath, filename);
    assertInside(paths.root, cardPath, "task card");

    const cells = table.headers.map(() => "");
    cells[table.idIndex] = id;
    cells[table.taskIndex] = title;
    cells[table.statusIndex] = status;
    const nextLines = [...table.lines];
    nextLines.splice(table.endIndex, 0, renderTableRow(cells));
    const nextLedger = nextLines.join("\n");

    await this.atomicWrite(cardPath, cardContent);
    try {
      await this.atomicWrite(paths.ledgerPath, nextLedger);
    } catch (error) {
      try {
        await unlink(cardPath);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "ledger write failed and task card rollback failed for " + id,
        );
      }
      throw error;
    }
    return this.resolve(project, id);
    });
  }

  async update(
    project: ForgeProject,
    inputTaskId: unknown,
    patch: UpdateRepositoryTaskInput,
  ): Promise<RepositoryTaskSummary> {
    return withProjectWriteLock(project, async () => {
    await this.inspect(project);
    const id = normalizeTaskId(inputTaskId);
    const paths = await configuredPaths(project);
    const { table } = await readLedger(paths);
    const ledger = ledgerTask(table, id);
    const cardPath = await cardPathForTask(paths, id);
    if (!cardPath) throw new Error("task card not found for " + id);

    const currentCard = await readFile(cardPath, "utf8");
    parseTaskCard(currentCard, id);

    let nextCard: string;
    let nextTitle: string;
    let nextStatus: string;
    if (patch?.content !== undefined) {
      if (patch.title !== undefined || patch.status !== undefined) {
        throw new Error("content cannot be combined with title or status");
      }
      const explicit = normalizeExplicitContent(patch.content, id);
      nextCard = explicit.content;
      nextTitle = explicit.title;
      nextStatus = explicit.status;
    } else {
      if (patch?.title === undefined && patch?.status === undefined) {
        throw new Error("update requires content, title or status");
      }
      nextCard = replaceTaskCardFields(currentCard, { id, title: patch.title, status: patch.status });
      const parsed = parseTaskCard(nextCard, id);
      nextTitle = parsed.title;
      nextStatus = parsed.status;
    }

    const cells = [...ledger.row.cells];
    cells[table.taskIndex] =
      patch.content !== undefined || patch.title !== undefined
        ? nextTitle
        : ledger.title;
    cells[table.statusIndex] =
      patch.content !== undefined || patch.status !== undefined
        ? nextStatus
        : ledger.status;
    const nextLines = [...table.lines];
    nextLines[ledger.row.lineIndex] = renderTableRow(cells);
    const nextLedger = nextLines.join("\n");

    await this.atomicWrite(cardPath, nextCard);
    try {
      await this.atomicWrite(paths.ledgerPath, nextLedger);
    } catch (error) {
      try {
        await this.atomicWrite(cardPath, currentCard);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "ledger write failed and task card rollback failed for " + id,
        );
      }
      throw error;
    }
    return this.resolve(project, id);
    });
  }
}

const defaultRepositoryTaskSource = new RepositoryTaskSource();

export const inspectRepositoryTaskSource = (project: ForgeProject) =>
  defaultRepositoryTaskSource.inspect(project);

export const resolveRepositoryTask = (project: ForgeProject, taskId: unknown) =>
  defaultRepositoryTaskSource.resolve(project, taskId);

export const createRepositoryTask = (project: ForgeProject, input: CreateRepositoryTaskInput) =>
  defaultRepositoryTaskSource.create(project, input);

export const updateRepositoryTask = (
  project: ForgeProject,
  taskId: unknown,
  patch: UpdateRepositoryTaskInput,
) => defaultRepositoryTaskSource.update(project, taskId, patch);
