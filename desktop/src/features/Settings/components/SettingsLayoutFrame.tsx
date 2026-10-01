import Header from "./Header";
import { PAGE_GUTTER_CLASS } from "@/app/Layouts/AppPageLayout";

export interface SettingsLayoutFrameProps {
  miniTitle: string;
  title: string;
  titleMeta?: React.ReactNode;
  description?: string;
  slot?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  contentClassName?: string;
  containerClassName?: string;
  scrollBody?: boolean;
  contentMode?: "fill" | "flow";
}

export default function SettingsLayoutFrame({
  miniTitle,
  title,
  titleMeta,
  description,
  slot,
  children,
  className = "",
  bodyClassName = "",
  contentClassName = "",
  containerClassName = "",
  scrollBody = true,
  contentMode = "fill",
}: SettingsLayoutFrameProps) {
  const containerClasses = ["mx-auto w-full max-w-[1180px]", containerClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`mx-auto flex h-full min-h-0 w-full flex-col overflow-hidden ${className}`}
    >
      <div className={`shrink-0 ${PAGE_GUTTER_CLASS} ${containerClasses}`}>
        <Header
          miniTitle={miniTitle}
          title={title}
          titleMeta={titleMeta}
          description={description}
          slot={slot}
        />
      </div>

      <div
        className={[
          "min-h-0 flex-1",
          scrollBody ? "stable-scrollbar overflow-y-auto" : "",
          bodyClassName,
        ].join(" ")}
      >
        <div
          className={`flex flex-col ${PAGE_GUTTER_CLASS} pb-6 ${
            contentMode === "flow" ? "min-h-full" : "h-full min-h-0"
          } ${containerClasses} ${contentClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
