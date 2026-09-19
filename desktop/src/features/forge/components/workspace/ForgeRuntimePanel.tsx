import { Square } from "lucide-react";
import { Badge, Button, Drawer } from "@/shared/ui";
import type {
  ForgeEvent,
  ForgeInspectorView,
  ForgeRuntimeRecord,
} from "../../types";
import {
  builderLabel,
  dispatchLabel,
  dispatchVariant,
} from "./presentation";

export function ForgeRuntimePanel({
  mode,
  runtimes,
  events,
  inspector,
  busy,
  onCancel,
  onClose,
}: {
  mode: "summary" | "inspector" | "events";
  runtimes: ForgeRuntimeRecord[];
  events: ForgeEvent[];
  inspector: ForgeInspectorView | null;
  busy: boolean;
  onCancel: (runtime: ForgeRuntimeRecord) => void;
  onClose: () => void;
}) {
  const title =
    mode === "summary"
      ? "Runtime Summary"
      : mode === "inspector"
        ? "Runtime Inspector"
        : "Event Log";

  return (
    <Drawer
      open
      onClose={onClose}
      width={420}
      header={<div className="text-sm font-semibold">{title}</div>}
    >
      {mode === "events" ? (
        <div className="space-y-1 font-mono text-xs">
          {events.length ? (
            events.map((event) => (
              <div
                key={event.id}
                className="grid grid-cols-[72px_100px_1fr] gap-2 border-b border-border/70 py-2 text-text-secondary"
              >
                <span className="text-text-tertiary">{event.timestamp}</span>
                <span className="truncate text-primary">{event.kind}</span>
                <span className="break-words">{event.message}</span>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-text-tertiary">No events</div>
          )}
        </div>
      ) : mode === "inspector" ? (
        <div className="space-y-4">
          {inspector ? (
            <>
              <div className="space-y-2 rounded-ui-panel border border-border bg-surface-secondary p-4 font-mono text-xs text-text-secondary">
                {inspector.detailLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              {inspector.currentSha || inspector.reviewedSha ? (
                <div className="rounded-ui-panel border border-border bg-surface-primary p-4 text-xs">
                  <div className="text-caption text-text-tertiary">SHA BINDING</div>
                  <div className="mt-2 space-y-1 font-mono text-text-secondary">
                    <div>current · {inspector.currentSha ?? "—"}</div>
                    <div>reviewed · {inspector.reviewedSha ?? "—"}</div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="py-8 text-center text-text-tertiary">
              Select a Task to inspect runtime state.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {runtimes.length ? (
            runtimes.map((runtime) => {
              const cancellable =
                runtime.state === "starting" || runtime.state === "running";
              return (
                <div key={runtime.id} className="border-b border-border/70 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm">{runtime.taskId}</div>
                      <div className="mt-1 text-xs text-text-tertiary">
                        {builderLabel(runtime.builder)}
                        {runtime.externalSessionId
                          ? " · " + runtime.externalSessionId
                          : ""}
                      </div>
                    </div>
                    <Badge variant={dispatchVariant(runtime.state)}>
                      {dispatchLabel[runtime.state]}
                    </Badge>
                  </div>
                  {runtime.summary ? (
                    <div className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-text-secondary">
                      {runtime.summary}
                    </div>
                  ) : null}
                  {cancellable ? (
                    <Button
                      className="mt-2"
                      size="xs"
                      variant="danger-ghost"
                      disabled={busy}
                      onClick={() => onCancel(runtime)}
                    >
                      <Square className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="py-8 text-center text-text-tertiary">
              No runtime records
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
