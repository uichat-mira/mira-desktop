// Thin HTTP/SSE client for driving a running Mira backend.
//
// This intentionally reuses the existing product control surface:
//   POST /login                       -> JWT
//   POST /chat-workspaces             -> workspace bound to a fixture root
//   POST /threads                     -> agent-enabled thread
//   POST /proxy/chat/:provider        -> streaming agent turn (SSE)
//   GET  /agent/runs/:runId           -> run state polling
//   POST /agent/runs/:runId/approve   -> approval resume
//   POST /agent/runs/:runId/cancel    -> cancel
//   GET  /threads/:id/messages        -> persisted raw execution-node events
//
// It is a transport adapter only; it does not interpret or score agent behavior.

const DEFAULT_TIMEOUT_MS = 60000;

export class MiraHttpError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "MiraHttpError";
    this.status = status;
    this.body = body;
  }
}

export const createClient = ({ baseUrl, fetchImpl = fetch }) => {
  const root = baseUrl.replace(/\/+$/, "");
  let token = null;

  const withAuth = (headers = {}) =>
    token ? { ...headers, authorization: `Bearer ${token}` } : headers;

  const request = async (method, path, { body, headers, timeoutMs, signal } = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("request timeout")),
      timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const onOuterAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) onOuterAbort();
      else signal.addEventListener("abort", onOuterAbort, { once: true });
    }
    try {
      const response = await fetchImpl(`${root}${path}`, {
        method,
        headers: withAuth({
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      if (!response.ok) {
        throw new MiraHttpError(
          `${method} ${path} failed with HTTP ${response.status}`,
          { status: response.status, body: parsed ?? text },
        );
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onOuterAbort);
    }
  };

  return {
    baseUrl: root,

    async login({ username, password }) {
      const payload = await request("POST", "/login", {
        body: { username, password },
      });
      token = payload?.data?.token ?? null;
      if (!token) throw new MiraHttpError("login did not return a token");
      return payload.data.user;
    },

    async health() {
      return request("GET", "/health", { timeoutMs: 10000 });
    },

    async createWorkspace({ name, rootPath }) {
      const payload = await request("POST", "/chat-workspaces", {
        body: { name, rootPath },
      });
      return payload.data;
    },

    async deleteWorkspace(workspaceId) {
      return request("DELETE", `/chat-workspaces/${workspaceId}`);
    },

    async createThread({ title, workspaceId, agentEnabled = true }) {
      const payload = await request("POST", "/threads", {
        body: { title, workspaceId, agentEnabled },
      });
      return payload.data;
    },

    async archiveThread(threadId) {
      return request("POST", `/threads/${threadId}/archive`);
    },

    async getRun(runId) {
      const payload = await request("GET", `/agent/runs/${runId}`);
      return payload.data;
    },

    async approveRun(runId) {
      const payload = await request("POST", `/agent/runs/${runId}/approve`);
      return payload.data;
    },

    async cancelRun(runId) {
      const payload = await request("POST", `/agent/runs/${runId}/cancel`);
      return payload.data;
    },

    async getMessages(threadId) {
      const payload = await request("GET", `/threads/${threadId}/messages`);
      return payload.data;
    },

    /**
     * Submit one chat turn and stream the assistant SSE frames.
     *
     * `onEvent` receives every decoded frame `{ type, ... }` verbatim.
     * Returns `{ finishReason, runId, events }` where `runId` is taken from the
     * first execution-node frame that carries `details.runId` (server assigns it).
     */
    async streamChatTurn(
      { threadId, messages, provider, agentEnabled = true, signal, timeoutMs },
      { onEvent } = {},
    ) {
      if (typeof provider !== "string" || !provider.trim()) {
        throw new MiraHttpError("streamChatTurn requires an explicit provider");
      }
      const providerPath = encodeURIComponent(provider);
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("stream timeout")),
        timeoutMs ?? 30 * 60 * 1000,
      );
      const onOuterAbort = () => controller.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) onOuterAbort();
        else signal.addEventListener("abort", onOuterAbort, { once: true });
      }

      const events = [];
      let runId = null;
      let finishReason = null;

      try {
        const response = await fetchImpl(`${root}/proxy/chat/${providerPath}`, {
          method: "POST",
          headers: withAuth({ "content-type": "application/json" }),
          body: JSON.stringify({ id: threadId, agentEnabled, messages }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const text = await response.text().catch(() => "");
          throw new MiraHttpError(
            `POST /proxy/chat/${providerPath} failed with HTTP ${response.status}`,
            { status: response.status, body: text },
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawDone = false;

        while (!sawDone) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (line) {
              const payload = line.slice(6);
              if (payload === "[DONE]") {
                sawDone = true;
              } else {
                let event;
                try {
                  event = JSON.parse(payload);
                } catch {
                  event = { type: "unparsed", raw: payload };
                }
                events.push(event);
                if (
                  event.type === "data-execution-node" &&
                  !runId &&
                  typeof event.data?.details?.runId === "string"
                ) {
                  runId = event.data.details.runId;
                }
                if (event.type === "finish") finishReason = event.finishReason ?? null;
                onEvent?.(event);
              }
            }
            if (sawDone) break;
            boundary = buffer.indexOf("\n\n");
          }
        }

        return { runId, finishReason, events };
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", onOuterAbort);
      }
    },
  };
};
