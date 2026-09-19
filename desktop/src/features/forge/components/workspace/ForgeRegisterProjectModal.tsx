import { useState } from "react";
import { Button, Modal, TextInput } from "@/shared/ui";
import type { ForgeRegisterProjectValues } from "../../types";

export function ForgeRegisterProjectModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: ForgeRegisterProjectValues) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [taskLedger, setTaskLedger] = useState("");
  const [taskDir, setTaskDir] = useState("");

  const submit = async () => {
    await onSubmit({
      name: name.trim(),
      repositoryPath: repositoryPath.trim(),
      branch: branch.trim(),
      ...(taskLedger.trim() ? { taskLedger: taskLedger.trim() } : {}),
      ...(taskDir.trim() ? { taskDir: taskDir.trim() } : {}),
    });
    setName("");
    setRepositoryPath("");
    setBranch("main");
    setTaskLedger("");
    setTaskDir("");
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Register project"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              busy ||
              !name.trim() ||
              !repositoryPath.trim() ||
              !branch.trim()
            }
            onClick={() => {
              void submit().catch(() => undefined);
            }}
          >
            Register project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextInput label="Project name" value={name} onChange={setName} />
        <TextInput
          label="Local repository"
          value={repositoryPath}
          onChange={setRepositoryPath}
          placeholder="C:/work/project"
        />
        <TextInput
          label="Integration branch"
          value={branch}
          onChange={setBranch}
        />
        <div className="rounded-ui-panel border border-border bg-surface-secondary p-3">
          <div className="text-xs font-medium text-text-secondary">
            Repository Task Source
          </div>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">
            Ledger 与 Task Directory 必须同时填写；留空时仅注册项目，不猜默认路径。
          </p>
          <div className="mt-3 space-y-3">
            <TextInput
              label="Task Ledger"
              value={taskLedger}
              onChange={setTaskLedger}
              placeholder="docs/project-control/project-control-ledger.md"
            />
            <TextInput
              label="Task Directory"
              value={taskDir}
              onChange={setTaskDir}
              placeholder="docs/project-control/tasks"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
