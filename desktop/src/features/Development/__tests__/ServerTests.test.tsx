// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DevelopmentServerTests from "../pages/ServerTests/index";

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getDesktopRuntime: () => ({ backendUrl: "http://127.0.0.1:8787" }),
  getApiBaseUrl: () => "http://127.0.0.1:8787",
  isDesktopShell: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("DevelopmentServerTests", () => {
  it("requests the server official reports from the backend", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Not Found", { status: 404 }),
    );

    render(<DevelopmentServerTests />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8787/server-coverage/coverage-report.json",
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8787/server-coverage/test-report.json",
      );
    });
  });
});
