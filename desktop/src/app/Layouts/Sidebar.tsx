import logoIcon from "@/assets/branding/uichat-logo-icon.png";
import { appPackageMeta } from "@/shared/appMeta";

function Sidebar({ children, showHeader = true }: {
  children: React.ReactNode;
  showHeader?: boolean;
}) {
  return (
    <aside
      className="flex h-[100dvh] min-h-0 w-64 shrink-0 flex-col overflow-hidden bg-surface-tertiary"
    >
      {showHeader ? (
        <div className="flex items-center bg-surface-tertiary px-4 py-4 text-base font-semibold">
          <img src={logoIcon} alt="Logo" className="mr-2.5 inline-block h-8" />
          <span className="font-serif font-semibold text-text-primary">
            {appPackageMeta.displayName}
          </span>
        </div>
      ) : null}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-tertiary py-2.5 pl-1 pr-0`}
      >
        {children}
      </div>
    </aside>
  );
}

export default Sidebar;
