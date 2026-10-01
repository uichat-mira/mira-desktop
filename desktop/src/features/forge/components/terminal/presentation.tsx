export const terminalTone = (state: string) => {
  if (
    [
      "completed",
      "review_passed",
      "waiting_integration",
      "integrated",
      "passed",
      "ready",
    ].includes(state)
  ) {
    return "text-success";
  }
  if (
    [
      "failed",
      "cancelled",
      "interrupted",
      "stale",
      "blocked",
      "error",
    ].includes(state)
  ) {
    return "text-danger";
  }
  if (
    [
      "starting",
      "running",
      "building",
      "fixing",
      "reviewing",
      "waiting",
    ].includes(state)
  ) {
    return "text-warning";
  }
  return "text-text-inverted/55";
};

export const terminalDot = (state: string) => {
  if (
    [
      "completed",
      "review_passed",
      "waiting_integration",
      "integrated",
      "passed",
    ].includes(state)
  ) {
    return "bg-success";
  }
  if (
    ["failed", "cancelled", "interrupted", "stale"].includes(state)
  ) {
    return "bg-danger";
  }
  if (
    ["starting", "running", "building", "fixing", "reviewing"].includes(
      state,
    )
  ) {
    return "bg-warning";
  }
  return "bg-text-inverted/30";
};

export function TerminalKey({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <kbd className="rounded-ui-control border border-text-inverted/20 px-1 py-0.5 text-[9px] text-text-inverted/70">
      {children}
    </kbd>
  );
}
