import { useState } from "react";
import { Send } from "lucide-react";
import type { ForgeWorkspaceSnapshot } from "../../types";
import { terminalTone } from "./presentation";

export function ForgeTerminalMainThread({
  snapshot,
  busy,
  onSendMessage,
}: {
  snapshot: ForgeWorkspaceSnapshot;
  busy: boolean;
  onSendMessage?: (value: string) => void | Promise<void>;
}) {
  const [messageText, setMessageText] = useState("");

  const submitMessage = async () => {
    const value = messageText.trim();
    if (!value || !onSendMessage) return;
    try {
      await onSendMessage(value);
      setMessageText("");
    } catch {
      // Forge orchestration owns user-visible errors.
    }
  };

  return (
    <aside
      className="flex h-[38vh] min-h-[240px] flex-col border-t border-text-inverted/15 xl:h-auto xl:min-h-0 xl:border-l xl:border-t-0"
      aria-label="Terminal Main Thread"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-text-inverted/15 px-3 text-[9px]">
        <strong className="tracking-[0.12em]">MAIN THREAD</strong>
        <span className="text-text-inverted/30">·</span>
        <span className="text-info">
          {snapshot.mainThread?.adapter ?? "not opened"}
        </span>
        <span className="text-text-inverted/30">·</span>
        <span
          className={terminalTone(
            snapshot.mainThread?.status ?? "idle",
          )}
        >
          {snapshot.mainThread?.status ?? "ready"}
        </span>
      </div>

      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {snapshot.messages.length ? (
          snapshot.messages.map((message) => (
            <div
              key={message.id}
              className="mb-3 border-l border-text-inverted/15 pl-2 text-[10px]"
            >
              <div className="flex items-center gap-2 text-[9px] text-text-inverted/35">
                <span
                  className={
                    message.author === "operator"
                      ? "text-primary"
                      : "text-info"
                  }
                >
                  {message.author === "operator"
                    ? "operator"
                    : message.kind === "builder-result"
                      ? "builder result"
                      : "mira"}
                </span>
                <time>{message.createdAt}</time>
              </div>
              {message.kind === "builder-result" &&
              message.handoff ? (
                <div className="mt-1 flex flex-wrap gap-x-2 text-[9px]">
                  <span className="text-text-inverted/40">
                    {message.handoff.adapterId}
                  </span>
                  <span
                    className={terminalTone(
                      message.handoff.dispatchStatus,
                    )}
                  >
                    dispatch {message.handoff.dispatchStatus}
                  </span>
                  <span
                    className={terminalTone(
                      message.handoff.taskStatus,
                    )}
                  >
                    task {message.handoff.taskStatus}
                  </span>
                </div>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-text-inverted/70">
                {message.body}
              </p>
            </div>
          ))
        ) : (
          <div className="border-l-2 border-primary pl-3 text-[10px] leading-5 text-text-inverted/40">
            <span className="text-primary">›</span> Open the durable Main
            Thread by sending the first message.
          </div>
        )}
      </div>

      <div className="border-t border-text-inverted/15 p-2">
        <textarea
          aria-label="Terminal Main Thread message"
          value={messageText}
          disabled={busy}
          onChange={(event) => setMessageText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.ctrlKey || event.metaKey)
            ) {
              event.preventDefault();
              void submitMessage();
            }
          }}
          rows={3}
          placeholder="Message the Main Thread… · Ctrl/⌘+Enter"
          className="w-full resize-none border border-text-inverted/15 bg-transparent px-2 py-2 text-[10px] leading-5 text-text-inverted outline-none placeholder:text-text-inverted/25 focus:border-primary disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] text-text-inverted/30">
            Main Thread ≠ Builder
          </span>
          <button
            type="button"
            disabled={busy || !messageText.trim()}
            onClick={() => void submitMessage()}
            className="flex items-center gap-1 border border-primary px-2 py-1 text-[9px] text-primary disabled:opacity-40"
          >
            <Send className="h-3 w-3" />
            send ^↵
          </button>
        </div>
      </div>
    </aside>
  );
}
