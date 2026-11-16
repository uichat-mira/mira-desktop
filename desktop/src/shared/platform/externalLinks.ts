import {
  getDesktopRuntime,
  isDesktopShell,
  openExternalUrl,
} from "./desktopRuntime";

const handlers = new WeakMap<Document, EventListener>();

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

/**
 * Route target=_blank links through the shared desktop runtime bridge.
 *
 * Electron otherwise creates a child BrowserWindow. Route external links
 * through native IPC so they open in the user's system browser.
 */
export function installDesktopExternalLinkHandler(
  targetDocument: Document = document,
): () => void {
  if (!isDesktopShell(getDesktopRuntime()) || handlers.has(targetDocument)) {
    return () => undefined;
  }

  const handleClick: EventListener = (event) => {
    if (!(event instanceof MouseEvent) || event.defaultPrevented) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target.toLowerCase() !== "_blank") {
      return;
    }

    const url = anchor.href.trim();
    if (!isHttpUrl(url)) {
      return;
    }

    event.preventDefault();
    void openExternalUrl(url).catch((error) => {
      console.error("Failed to open external URL", { url, error });
    });
  };

  targetDocument.addEventListener("click", handleClick, true);
  handlers.set(targetDocument, handleClick);

  return () => {
    const installedHandler = handlers.get(targetDocument);
    if (!installedHandler) {
      return;
    }
    targetDocument.removeEventListener("click", installedHandler, true);
    handlers.delete(targetDocument);
  };
}
