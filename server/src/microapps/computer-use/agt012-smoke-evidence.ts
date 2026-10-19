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
