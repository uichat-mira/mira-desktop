export interface Agt012FinalBrowserStateInput {
  actualUrl: string | undefined;
  expectedUrl: string;
  visibleText: string | undefined;
}

/**
 * The live-model smoke must judge the browser itself, not the model's summary
 * of what it believes happened. Require the exact final URL and rendered text.
 */
export const isExpectedAgt012FinalBrowserState = ({
  actualUrl,
  expectedUrl,
  visibleText,
}: Agt012FinalBrowserStateInput): boolean => {
  if (actualUrl !== expectedUrl || typeof visibleText !== "string") return false;
  return visibleText.includes("Welcome Mira") && visibleText.includes("authenticated");
};

const AUTO_APPROVABLE_BROWSER_TOOL_IDS = new Set([
  "browser_assert",
  "browser_navigate",
  "browser_wait_for",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_fill",
  "browser_press_key",
  "browser_select_option",
  "browser_scroll",
]);

/** The real-model smoke may resume approval only for this bounded Browser Tool set. */
export const isAgt012SmokeAutoApprovableTool = (toolId: string): boolean =>
  AUTO_APPROVABLE_BROWSER_TOOL_IDS.has(toolId);
