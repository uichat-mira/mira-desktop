"use client";

import { Outlet } from "react-router-dom";
import { useAuth } from "@/app/providers/AuthProvider";
import { AppChatRuntimeProvider } from "@/features/chat/core/runtime";
import { AppNavigationRail } from "@/app/Layouts/AppNavigationRail";

// ChatApplicationStateBoundary keeps one UChat runtime for the authenticated
// user while child workspace routes mount and unmount their visible surfaces.
export function ChatApplicationStateBoundary() {
  const { session } = useAuth();

  if (!session) {
    return <Outlet />;
  }

  return (
    <div className="flex h-[100dvh] min-h-0 w-full overflow-hidden bg-surface-secondary">
      <AppNavigationRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppChatRuntimeProvider sessionKey={session.user.id}>
          <Outlet />
        </AppChatRuntimeProvider>
      </div>
    </div>
  );
}
