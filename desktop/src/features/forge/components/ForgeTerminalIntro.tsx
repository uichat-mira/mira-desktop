import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./ForgeTerminalIntro.css";

export const FORGE_TERMINAL_INTRO_DURATION_MS = 2600;
export const FORGE_TERMINAL_INTRO_REDUCED_DURATION_MS = 700;

const EXIT_DURATION_MS = 220;
const TIMER_GRACE_MS = 80;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const GLYPHS: Record<string, string[]> = {
  M: [
    "10001",
    "11011",
    "10101",
    "10101",
    "10001",
    "10001",
    "10001",
  ],
  I: [
    "11111",
    "00100",
    "00100",
    "00100",
    "00100",
    "00100",
    "11111",
  ],
  R: [
    "11110",
    "10001",
    "10001",
    "11110",
    "10100",
    "10010",
    "10001",
  ],
  A: [
    "01110",
    "10001",
    "10001",
    "11111",
    "10001",
    "10001",
    "10001",
  ],
  F: [
    "11111",
    "10000",
    "10000",
    "11110",
    "10000",
    "10000",
    "10000",
  ],
  O: [
    "01110",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
    "01110",
  ],
  G: [
    "01110",
    "10001",
    "10000",
    "10111",
    "10001",
    "10001",
    "01110",
  ],
  E: [
    "11111",
    "10000",
    "10000",
    "11110",
    "10000",
    "10000",
    "11111",
  ],
};

const WORDMARK = "MIRA FORGE";
const FLOW = [
  "PROJECT",
  "MAIN THREAD",
  "REPOSITORY TASK",
  "DISPATCH",
  "BUILDER",
  "REVIEW",
];

export type ForgeTerminalIntroWorkspaceState =
  | "pending"
  | "ready"
  | "error";

export interface ForgeTerminalIntroProps {
  workspaceState: ForgeTerminalIntroWorkspaceState;
  onComplete: () => void;
}

const getMotionQuery = () =>
  typeof window === "undefined" || !window.matchMedia
    ? null
    : window.matchMedia(REDUCED_MOTION_QUERY);

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => getMotionQuery()?.matches ?? false,
  );

  useEffect(() => {
    const query = getMotionQuery();
    if (!query) return;

    const onChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };

    setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function ForgePixelWordmark() {
  return (
    <div
      className="forge-terminal-intro__wordmark"
      aria-label="Mira Forge"
    >
      {Array.from(WORDMARK).map((character, letterIndex) => {
        if (character === " ") {
          return (
            <span
              key={`gap-${letterIndex}`}
              className="forge-terminal-intro__word-gap"
              aria-hidden="true"
            />
          );
        }

        return (
          <span
            key={`${character}-${letterIndex}`}
            className="forge-terminal-intro__glyph"
            aria-hidden="true"
          >
            {GLYPHS[character].flatMap((row, rowIndex) =>
              Array.from(row).map((cell, columnIndex) => {
                const delay =
                  letterIndex * 28 + rowIndex * 14 + columnIndex * 6;
                const style = {
                  "--forge-cell-delay": `${delay}ms`,
                } as CSSProperties;

                return (
                  <span
                    key={`${rowIndex}-${columnIndex}`}
                    className="forge-terminal-intro__cell"
                    data-filled={cell === "1" ? "true" : "false"}
                    style={style}
                  />
                );
              }),
            )}
          </span>
        );
      })}
    </div>
  );
}

export function ForgeTerminalIntro({
  workspaceState,
  onComplete,
}: ForgeTerminalIntroProps) {
  const reducedMotion = useReducedMotion();
  const [timelineComplete, setTimelineComplete] = useState(false);
  const [exiting, setExiting] = useState(false);
  const completedRef = useRef(false);
  const duration = reducedMotion
    ? FORGE_TERMINAL_INTRO_REDUCED_DURATION_MS
    : FORGE_TERMINAL_INTRO_DURATION_MS;
  const rootStyle = {
    "--forge-intro-duration": `${duration}ms`,
    "--forge-intro-exit-duration": `${EXIT_DURATION_MS}ms`,
  } as CSSProperties;

  const finishTimeline = useCallback(() => {
    setTimelineComplete(true);
  }, []);

  const finishIntro = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    const timer = window.setTimeout(
      finishTimeline,
      duration + TIMER_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [duration, finishTimeline]);

  useEffect(() => {
    if (!timelineComplete || workspaceState === "pending") return;
    setExiting(true);
  }, [timelineComplete, workspaceState]);

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(
      finishIntro,
      EXIT_DURATION_MS + TIMER_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [exiting, finishIntro]);

  return (
    <div
      className="forge-terminal-intro"
      data-testid="forge-terminal-intro"
      data-motion={reducedMotion ? "reduced" : "full"}
      data-state={exiting ? "exiting" : "active"}
      style={rootStyle}
      role="status"
      aria-label="Mira Forge terminal initialization"
      aria-busy={workspaceState === "pending"}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && exiting) {
          finishIntro();
        }
      }}
    >
      <span
        className="forge-terminal-intro__timeline"
        data-testid="forge-terminal-intro-timeline"
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) finishTimeline();
        }}
        aria-hidden="true"
      />

      <div className="forge-terminal-intro__stage" aria-hidden="true">
        <div className="forge-terminal-intro__command">
          <span className="forge-terminal-intro__command-prompt">›</span>
          <span className="forge-terminal-intro__command-mira">mira</span>
          <span className="forge-terminal-intro__command-forge">forge</span>
          <span className="forge-terminal-intro__cursor" />
        </div>

        <ForgePixelWordmark />

        <div className="forge-terminal-intro__flow">
          {FLOW.map((item, index) => (
            <span
              key={item}
              className="forge-terminal-intro__flow-step"
              style={
                {
                  "--forge-flow-delay": `${1050 + index * 100}ms`,
                } as CSSProperties
              }
            >
              {index > 0 ? (
                <span className="forge-terminal-intro__flow-arrow">
                  &gt;
                </span>
              ) : null}
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="forge-terminal-intro__frame" aria-hidden="true">
        <span className="forge-terminal-intro__line forge-terminal-intro__line--header" />
        <span className="forge-terminal-intro__line forge-terminal-intro__line--rail" />
        <span className="forge-terminal-intro__line forge-terminal-intro__line--thread" />
        <span className="forge-terminal-intro__line forge-terminal-intro__line--status" />
        <span className="forge-terminal-intro__line forge-terminal-intro__line--runtime" />
        <span className="forge-terminal-intro__line forge-terminal-intro__line--footer" />

        <div className="forge-terminal-intro__header-mark">
          <span className="forge-terminal-intro__header-dot" />
          <strong>MIRA / FORGE</strong>
          <span>/ terminal workspace</span>
        </div>
        <div className="forge-terminal-intro__local">● LOCAL</div>
        <div className="forge-terminal-intro__rail-label">
          WORKSPACES
        </div>
        <div className="forge-terminal-intro__thread-label">
          MAIN THREAD
        </div>
      </div>

      <div
        className="forge-terminal-intro__workspace-state"
        aria-live="polite"
      >
        {timelineComplete && workspaceState === "pending" ? (
          <>
            <span>WAITING FOR WORKSPACE</span>
            <span className="forge-terminal-intro__waiting-cursor" />
          </>
        ) : null}
        {timelineComplete && workspaceState === "error" ? (
          <span>WORKSPACE RESPONSE RECEIVED</span>
        ) : null}
      </div>
    </div>
  );
}

export default ForgeTerminalIntro;
