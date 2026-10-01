import { Hammer } from "lucide-react";
import { Badge } from "@/shared/ui";
import type { ForgeMessage } from "../../types";
import { builderLabel } from "./presentation";

export function ForgeBuilderResultCard({
  message,
}: {
  message: ForgeMessage;
}) {
  const handoff = message.handoff;
  if (message.kind !== "builder-result" || !handoff) return null;

  const failed =
    handoff.dispatchStatus === "failed" ||
    handoff.dispatchStatus === "interrupted";

  return (
    <article className="mb-6 rounded-ui-panel border border-border bg-surface-primary">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Hammer className="h-4 w-4 shrink-0 text-text-tertiary" />
          <span className="truncate text-sm font-medium">
            Builder Result Handoff
          </span>
          <span className="font-mono text-[11px] text-text-tertiary">
            {handoff.taskId}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={failed ? "danger" : "success"}>
            {handoff.dispatchStatus}
          </Badge>
          <Badge variant="muted">{handoff.taskStatus}</Badge>
        </div>
      </div>
      <div className="p-4">
        <div className="text-xs text-text-tertiary">
          {builderLabel(handoff.adapterId)}
          {handoff.sessionStatus ? " · " + handoff.sessionStatus : ""}
          {" · "}
          {message.createdAt}
        </div>
        <p
          className={
            "mt-3 whitespace-pre-wrap text-sm leading-6 " +
            (failed ? "text-danger-text" : "text-text-secondary")
          }
        >
          {message.body}
        </p>
      </div>
    </article>
  );
}
