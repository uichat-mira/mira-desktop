// #223 Recorder — stage 1: ingest the #221 raw execution bundle.
//
// The Recorder does NOT drive Mira. It consumes exactly what #221 already
// produced for one repetition and preserves it verbatim as the raw fact source.
// This module only reads files and parses them; it never normalizes, derives or
// scores. Those are separate stages so the raw facts stay traceable.
//
// Authoritative raw trajectory decision (see recorder/README.md):
//   - persisted `execution-events.ndjson` is the authoritative ordered raw
//     trajectory (full history incl. resumed segments);
//   - `stream-frames.ndjson` is a secondary live-transport observation;
//   - `agent-run.json` is the authoritative terminal run-state document.
// We keep all three distinct and never merge them into one synthesized truth.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class IngestError extends Error {
  constructor(message) {
    super(message);
    this.name = "IngestError";
  }
}

const RAW_FILES = {
  executionEvents: "execution-events.ndjson",
  streamFrames: "stream-frames.ndjson",
  agentRun: "agent-run.json",
  executorFacts: "executor-facts.json",
  workspaceBefore: "workspace-manifest.before.json",
  workspaceAfter: "workspace-manifest.after.json",
  workspaceDiff: "workspace-diff.json",
  assistantTranscript: "assistant-transcript.txt",
};

const readText = (file) => {
  if (!fs.existsSync(file)) {
    throw new IngestError(`missing required raw artifact: ${file}`);
  }
  return fs.readFileSync(file, "utf8");
};

const readJson = (file) => {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new IngestError(`invalid JSON in ${file}: ${error.message}`);
  }
};

const readJsonOptional = (file) => (fs.existsSync(file) ? readJson(file) : null);

const readNdjson = (file) => {
  const text = readText(file);
  const lines = text.split("\n");
  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new IngestError(`invalid NDJSON at ${file}:${i + 1}: ${error.message}`);
    }
  }
  return records;
};

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const fileDigest = (file) =>
  fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null;

const sha256Text = (text) => sha256(Buffer.from(text, "utf8"));

/**
 * Ingest a single #221 repetition bundle directory.
 *
 * @param {string} repDir directory produced by #221 for one repetition
 * @returns {object} raw, verbatim bundle plus per-file provenance digests
 */
export const ingestRepetition = (repDir) => {
  if (!fs.existsSync(repDir) || !fs.statSync(repDir).isDirectory()) {
    throw new IngestError(`repetition directory not found: ${repDir}`);
  }

  const file = (name) => path.join(repDir, name);

  const executorFacts = readJson(file(RAW_FILES.executorFacts));
  const executionEvents = readNdjson(file(RAW_FILES.executionEvents));
  const streamFrames = readNdjson(file(RAW_FILES.streamFrames));
  const agentRun = readJson(file(RAW_FILES.agentRun));
  const workspaceBefore = readJson(file(RAW_FILES.workspaceBefore));
  const workspaceAfter = readJson(file(RAW_FILES.workspaceAfter));
  const workspaceDiff = readJsonOptional(file(RAW_FILES.workspaceDiff));
  const assistantTranscript = fs.existsSync(file(RAW_FILES.assistantTranscript))
    ? readText(file(RAW_FILES.assistantTranscript))
    : null;

  const provenance = {};
  for (const [key, name] of Object.entries(RAW_FILES)) {
    provenance[key] = {
      file: name,
      present: fs.existsSync(file(name)),
      sha256: fileDigest(file(name)),
    };
  }

  return {
    repDir,
    executorFacts,
    executionEvents,
    streamFrames,
    agentRun,
    workspace: {
      before: workspaceBefore,
      after: workspaceAfter,
      diff: workspaceDiff,
    },
    assistantTranscript,
    provenance,
  };
};

/**
 * Deterministically serialize an ingested bundle so a saved artifact can be
 * re-ingested and re-derived offline without re-running Mira (#223 replay).
 * This is the "raw input snapshot" persisted next to the report.
 */
export const serializeRawSnapshot = (bundle) => ({
  schemaVersion: "mira-agent-core-benchmark-raw-snapshot/0.1",
  source: path.basename(bundle.repDir),
  provenance: bundle.provenance,
  executorFacts: bundle.executorFacts,
  executionEvents: bundle.executionEvents,
  streamFrames: bundle.streamFrames,
  agentRun: bundle.agentRun,
  workspace: bundle.workspace,
  assistantTranscript: bundle.assistantTranscript,
});

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Re-hydrate an ingested bundle from a persisted raw snapshot (replay path). */
export const bundleFromSnapshot = (snapshot) => {
  // Blocker 3: missing evidence must stay missing. A snapshot is a plain object;
  // an array (or primitive) is rejected rather than coerced.
  if (!isPlainObject(snapshot)) {
    throw new IngestError("raw snapshot must be a plain object (arrays are not accepted)");
  }
  if (!isPlainObject(snapshot.executorFacts)) {
    throw new IngestError("raw snapshot executorFacts must be a plain object");
  }
  if (!Array.isArray(snapshot.executionEvents)) {
    throw new IngestError("raw snapshot is missing executionEvents array");
  }

  // `missing evidence != observed empty workspace`. When the snapshot carries no
  // workspace evidence we keep it `null` (unavailable) so deterministic
  // derivation emits unknown/gap instead of an "observed empty" side effect.
  const hasWorkspace = isPlainObject(snapshot.workspace);

  return {
    repDir: `<snapshot:${snapshot.source ?? "unknown"}>`,
    executorFacts: snapshot.executorFacts,
    executionEvents: snapshot.executionEvents,
    streamFrames: Array.isArray(snapshot.streamFrames) ? snapshot.streamFrames : [],
    agentRun: isPlainObject(snapshot.agentRun) ? snapshot.agentRun : null,
    workspace: hasWorkspace
      ? {
          before: snapshot.workspace.before ?? null,
          after: snapshot.workspace.after ?? null,
          diff: snapshot.workspace.diff ?? null,
        }
      : null,
    assistantTranscript: typeof snapshot.assistantTranscript === "string" ? snapshot.assistantTranscript : null,
    provenance: isPlainObject(snapshot.provenance) ? snapshot.provenance : {},
  };
};

export { sha256Text };
