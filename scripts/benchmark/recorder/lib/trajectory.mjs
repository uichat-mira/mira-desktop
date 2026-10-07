// #223 Recorder — stage 2: trajectory normalization.
//
// This does NOT rewrite raw events. It produces an ordered, indexable projection
// that:
//   - preserves event order exactly as persisted by Mira/#221;
//   - preserves original timestamps verbatim;
//   - keeps the full raw event under `event`;
//   - adds a stable `seq` + `ref` so a Judge can cite evidence deterministically.
//
// A summary is added for readability ONLY. Raw events are the fact source; the
// summary must never replace them.

import { trajectoryRef } from "./evidence-refs.mjs";

const summarize = (event) => {
  const details = event?.details ?? {};
  const parts = [];
  if (event?.nodeId) parts.push(event.nodeId);
  if (event?.phase) parts.push(event.phase);
  if (event?.summary) parts.push(event.summary);
  else if (details.toolId) parts.push(`tool:${details.toolId}`);
  return parts.join(" | ");
};

/**
 * @param {object[]} executionEvents raw persisted events (authoritative order)
 * @returns {object[]} normalized trajectory records
 */
export const normalizeTrajectory = (executionEvents) =>
  (executionEvents ?? []).map((event, seq) => ({
    seq,
    ref: trajectoryRef(seq),
    nodeId: event?.nodeId ?? null,
    nodeType: event?.nodeType ?? null,
    phase: event?.phase ?? null,
    emittedAt: event?.emittedAt ?? null,
    summary: event?.summary ?? null,
    annotation: summarize(event),
    event,
  }));

/**
 * The authoritative raw-trajectory decision, recorded explicitly in artifacts so
 * a Judge/auditor can see which source is trusted and why. Multiple sources are
 * never silently merged into a single synthesized "truth".
 */
export const TRAJECTORY_SOURCES = {
  authoritative: {
    source: "execution-events.ndjson",
    refScheme: "trajectory:<index>[:<nodeId>]",
    precedence: 1,
    role: "raw persisted execution-node / Agent trace; ordered, full history incl. resumed segments",
  },
  secondary: [
    {
      source: "stream-frames.ndjson",
      refScheme: "stream:<index>",
      precedence: 2,
      role: "live SSE transport observation; may be truncated by executor abort/cancel; never used to override the persisted trajectory",
    },
  ],
  terminalState: {
    source: "agent-run.json",
    refScheme: "artifact:terminal-run",
    role: "authoritative terminal run-state document (status / terminalReason)",
  },
};
