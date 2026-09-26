"use client";

import { Outlet } from "react-router-dom";
import { SettingsNavigation, WorkspaceShell } from "./layoutShared";

function SettingsContent() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-secondary">
      <Outlet />
    </div>
  );
}

/**
 * Settings workspace is intentionally runtime-free. It only renders settings
 * routes and lets the chat workspace stay mounted elsewhere.
 */
export function SettingsWorkspace({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1">
      <WorkspaceShell
        showBackToChatLink={false}
        sidebarContent={<SettingsNavigation showBackToChatLink={false} />}
        mainContent={<SettingsContent />}
        shellClassName="rounded-l-[28px] border border-border/70 bg-surface-secondary shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        contentClassName="px-3 sm:px-4 lg:px-5 xl:px-6"
      />
    </div>
  );
}
