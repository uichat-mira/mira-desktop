import { TerminalKey } from "./presentation";

export function ForgeTerminalCommandPalette({
  open,
  hasTask,
  hasActiveRuntime,
  onClose,
  onRegisterProject,
  onDispatch,
  onCancel,
  onRefresh,
}: {
  open: boolean;
  hasTask: boolean;
  hasActiveRuntime: boolean;
  onClose: () => void;
  onRegisterProject: () => void;
  onDispatch: () => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  if (!open) return null;

  const items = [
    {
      key: "n",
      label: "register project",
      disabled: false,
      action: onRegisterProject,
    },
    {
      key: "d",
      label: "dispatch selected task",
      disabled: !hasTask,
      action: onDispatch,
    },
    {
      key: "x",
      label: "cancel active Builder",
      disabled: !hasActiveRuntime,
      action: onCancel,
    },
    {
      key: "r",
      label: "refresh state",
      disabled: false,
      action: onRefresh,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/80 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Terminal command palette"
    >
      <div className="w-full max-w-md border border-text-inverted/25 bg-ink p-2 shadow-shadow-lg">
        <div className="flex items-center justify-between border-b border-text-inverted/15 px-2 py-2 text-[9px] tracking-[0.12em] text-text-inverted/45">
          <span>COMMANDS</span>
          <button
            type="button"
            className="text-text-inverted/45 hover:text-text-inverted"
            onClick={onClose}
          >
            <TerminalKey>q</TerminalKey> /{" "}
            <TerminalKey>esc</TerminalKey>
          </button>
        </div>
        <div className="py-1 text-[10px]">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.action();
              }}
              className="flex w-full items-center gap-3 px-2 py-2 text-left text-text-inverted/65 hover:bg-surface-primary/5 hover:text-text-inverted disabled:opacity-30"
            >
              <TerminalKey>{item.key}</TerminalKey>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
