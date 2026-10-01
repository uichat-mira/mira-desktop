// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DevelopmentClientTests from "../pages/ClientTests/index";

vi.mock("@/shared/platform/desktopRuntime", () => ({
  getDesktopRuntime: () => ({ backendUrl: "http://127.0.0.1:8787" }),
  getApiBaseUrl: () => "http://127.0.0.1:8787",
  isDesktopShell: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("DevelopmentClientTests", () => {
  it("requests the client official reports from the backend", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Not Found", { status: 404 }),
    );

    render(<DevelopmentClientTests />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8787/client-coverage/coverage-report.json",
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8787/client-coverage/test-report.json",
      );
    });
  });
});
