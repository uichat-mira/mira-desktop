import { Outlet } from "react-router-dom";

export default function StandaloneWorkspace() {
  return (
    <main className="min-h-0 flex-1 overflow-auto bg-surface-primary">
      <Outlet />
    </main>
  );
}
