export type PlaywrightLocatorLike = {
  click(options?: { timeout?: number }): Promise<unknown>;
  fill(value: string, options?: { timeout?: number }): Promise<unknown>;
  type(text: string, options?: { timeout?: number }): Promise<unknown>;
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
  press(key: string, options?: { timeout?: number }): Promise<unknown>;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  inputValue(): Promise<string>;
};

export type PlaywrightPageLike = {
  goto(url: string, options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number }): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<unknown>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<unknown>;
  type(
    selector: string,
    value: string,
    options?: { delay?: number; timeout?: number },
  ): Promise<unknown>;
  waitForSelector(
    selector: string,
    options?: { state?: "attached" | "visible" | "hidden"; timeout?: number },
  ): Promise<unknown>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle"): Promise<unknown>;
  evaluate<R, TArg = unknown>(
    pageFunction: (arg: TArg) => R,
    arg?: TArg,
  ): Promise<R>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  ariaSnapshot(options?: { mode?: "ai" | "default"; timeout?: number }): Promise<string>;
  getByRef(ref: string): PlaywrightLocatorLike;
  url(): string;
};

export type PlaywrightContextLike = {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<unknown>;
};

export type PlaywrightBrowserLike = {
  newContext(): Promise<PlaywrightContextLike>;
  close(): Promise<unknown>;
};

export type PlaywrightChromiumLauncherLike = {
  launch(options: {
    executablePath?: string;
    headless?: boolean;
  }): Promise<PlaywrightBrowserLike>;
};
