import { Play } from "lucide-react";
import { Button, Modal, Select } from "@/shared/ui";
import type { ForgeTask } from "../../types";
import { ForgeStatePair } from "./ForgeTaskContext";
import { builderLabel } from "./presentation";

export type ForgeBuilderChoice = "opencode" | "piagent" | "codex";

export function ForgeDispatchModal({
  open,
  busy,
  task,
  builderChoice,
  builderChoices,
  onBuilderChange,
  onClose,
  onDispatch,
}: {
  open: boolean;
  busy: boolean;
  task: ForgeTask | null;
  builderChoice: ForgeBuilderChoice;
  builderChoices: ForgeBuilderChoice[];
  onBuilderChange: (value: ForgeBuilderChoice) => void;
  onClose: () => void;
  onDispatch: (task: ForgeTask, builder: ForgeBuilderChoice) => Promise<void>;
}) {
  const dispatchable =
    task?.readiness === "ready" &&
    (task.runtimeState === "waiting" || task.runtimeState === "fixing");

  return (
    <Modal
      open={open}
      title="Dispatch Builder"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !task || !dispatchable}
            onClick={() => {
              if (!task) return;
              void onDispatch(task, builderChoice)
                .then(onClose)
                .catch(() => undefined);
            }}
          >
            <Play className="h-4 w-4" />
            Dispatch Builder
          </Button>
        </>
      }
    >
      {task ? (
        <div className="space-y-4">
          <ForgeStatePair task={task} />
          <Select
            label="Builder"
            value={builderChoice}
            onChange={(value) =>
              onBuilderChange(value as ForgeBuilderChoice)
            }
            options={builderChoices.map((builder) => ({
              value: builder,
              label: builderLabel(builder),
            }))}
          />
          <div className="rounded-ui-panel border border-border bg-surface-secondary p-3 text-xs leading-5 text-text-secondary">
            Dispatch 是显式动作。淬行不会自动 fallback 到另一个 Builder，也不会自动 push / merge / deploy。
          </div>
          {!dispatchable ? (
            <p className="text-sm text-danger-text">
              Dispatch is unavailable until backend readiness passes.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-tertiary">No task selected.</p>
      )}
    </Modal>
  );
}
