// #223 Recorder — stable evidence references.
//
// A Judge must be able to locate every deterministic claim back to raw
// evidence without natural-language fuzzing. Every reference here is
// deterministic and machine-resolvable:
//
//   trajectory:<index>            -> executionEvents[index] (ordered, inclusive)
//   trajectory:<index>:<nodeId>   -> executionEvents[index].nodeId (verified)
//   artifact:<name>               -> a named field inside a saved artifact
//   stream:<index>                -> streamFrames[index]
//
// Indices are the record positions inside the frozen raw arrays. They are
// stable as long as the raw array is not reordered, which the Recorder never
// does.

export const trajectoryRef = (index) => `trajectory:${index}`;

export const trajectoryNodeRef = (index, nodeId) => `trajectory:${index}:${nodeId}`;

export const artifactRef = (name) => `artifact:${name}`;

export const streamRef = (index) => `stream:${index}`;

/**
 * Resolve a reference against a raw bundle.
 * Returns `{ ok, kind, index, value, reason }`; never throws so a bad reference
 * becomes a structured failure instead of a silent pass.
 */
export const resolveRef = (ref, bundle) => {
  if (typeof ref !== "string") {
    return { ok: false, kind: "unknown", reason: "reference is not a string" };
  }
  const eventMatch = /^trajectory:(\d+)(?::(.+))?$/.exec(ref);
  if (eventMatch) {
    const index = Number(eventMatch[1]);
    const value = bundle.executionEvents?.[index];
    if (value === undefined) {
      return { ok: false, kind: "trajectory", index, reason: `no execution event at index ${index}` };
    }
    const expectedNodeId = eventMatch[2];
    if (expectedNodeId && value.nodeId !== expectedNodeId) {
      return {
        ok: false,
        kind: "trajectory",
        index,
        reason: `nodeId mismatch: expected ${expectedNodeId}, found ${value.nodeId}`,
      };
    }
    return { ok: true, kind: "trajectory", index, value };
  }
  const streamMatch = /^stream:(\d+)$/.exec(ref);
  if (streamMatch) {
    const index = Number(streamMatch[1]);
    const value = bundle.streamFrames?.[index];
    if (value === undefined) {
      return { ok: false, kind: "stream", index, reason: `no stream frame at index ${index}` };
    }
    return { ok: true, kind: "stream", index, value };
  }
  const artifactMatch = /^artifact:(.+)$/.exec(ref);
  if (artifactMatch) {
    return { ok: true, kind: "artifact", name: artifactMatch[1] };
  }
  return { ok: false, kind: "unknown", reason: `unrecognized reference: ${ref}` };
};
