import type { ForgeProject } from "../../types";
import { TerminalKey } from "./presentation";

export function ForgeTerminalProjectRail({
  projects,
  selectedProjectId,
  onSelectProject,
  onRegisterProject,
}: {
  projects: ForgeProject[];
  selectedProjectId?: string;
  onSelectProject?: (projectId: string) => void | Promise<void>;
  onRegisterProject: () => void;
}) {
  const runSelect = (projectId: string) => {
    void Promise.resolve(onSelectProject?.(projectId)).catch(
      () => undefined,
    );
  };

  return (
    <aside
      className="hidden w-56 shrink-0 flex-col border-r border-text-inverted/15 md:flex"
      aria-label="Terminal workspace navigator"
    >
      <div className="flex h-9 items-center justify-between px-3 text-[9px] tracking-[0.12em] text-text-inverted/45">
        <span>WORKSPACES</span>
        <span>{projects.length}</span>
      </div>
      <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5">
        {projects.map((project) => {
          const selected = project.id === selectedProjectId;
          return (
            <button
              key={project.id}
              type="button"
              aria-pressed={selected}
              onClick={() => runSelect(project.id)}
              className={
                "mb-1 flex w-full items-start gap-2 border-l-2 px-2 py-2 text-left text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary " +
                (selected
                  ? "border-primary bg-surface-primary/10 text-text-inverted"
                  : "border-transparent text-text-inverted/55 hover:bg-surface-primary/5 hover:text-text-inverted")
              }
            >
              <span className="w-2 text-primary">
                {selected ? "›" : " "}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block truncate font-medium">
                  {project.name}
                </strong>
                <small className="mt-1 block truncate text-[9px] text-text-inverted/35">
                  {project.branch +
                    " · " +
                    project.activeRuntimeCount +
                    " active"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="mx-3 mb-3 border-t border-text-inverted/15 pt-3 text-left text-[10px] text-text-inverted/55 hover:text-primary"
        onClick={onRegisterProject}
      >
        + new project <TerminalKey>n</TerminalKey>
      </button>
    </aside>
  );
}
