// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SettingsNavigation } from "./layoutShared";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/app/routes/settingsRoutes", () => ({
  useSettingsNavigationItems: () => [
    { label: "settings.navigation.general", icon: () => null, to: "/settings/general", group: "general", order: 10, match: "exact", preserveSearch: false },
    { label: "settings.navigation.model", icon: () => null, to: "/settings/model-setting", group: "basic", order: 10, match: "exact", preserveSearch: false },
    { label: "settings.navigation.tools", icon: () => null, to: "/settings/tools", group: "basic", order: 20, match: "exact", preserveSearch: false },
    { label: "settings.navigation.enterpriseIntegrations", icon: () => null, to: "/settings/integrations", group: "app", order: 20, match: "exact", preserveSearch: false },
    { label: "settings.navigation.knowledgeBase", icon: () => null, to: "/settings/knowledge-base", group: "knowledge", order: 10, match: "prefix", preserveSearch: true },
    { label: "settings.navigation.evaluationCenter", icon: () => null, to: "/settings/evaluation/center", group: "knowledge", order: 20, match: "prefix", preserveSearch: false },
    { label: "settings.navigation.roles", icon: () => null, to: "/settings/roles", group: "app", order: 10, match: "exact", preserveSearch: false },
    { label: "settings.navigation.development", icon: () => null, to: "/settings/development", group: "other", order: 10, match: "prefix", preserveSearch: false },
    { label: "settings.navigation.about", icon: () => null, to: "/settings/about", group: "other", order: 20, match: "exact", preserveSearch: false },
  ],
}));

describe("SettingsNavigation", () => {
  it("renders the requested section headings", () => {
    render(
      <MemoryRouter>
        <SettingsNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByText("settings.navigation.basicConfig")).toBeInTheDocument();
    expect(screen.getByText("settings.navigation.knowledgeGroup")).toBeInTheDocument();
    expect(screen.getByText("settings.navigation.appGroup")).toBeInTheDocument();
    expect(screen.getByText("settings.navigation.otherGroup")).toBeInTheDocument();
    expect(
      screen.queryByText("settings.navigation.developmentLogs"),
    ).not.toBeInTheDocument();
  });

  it("keeps the parent item active on a deep knowledge base route", () => {
    render(
      <MemoryRouter initialEntries={["/settings/knowledge-base/detail"]}>
        <SettingsNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "settings.navigation.knowledgeBase" })).toHaveClass("bg-surface-soft");
    expect(screen.getByRole("link", { name: "settings.navigation.evaluationCenter" })).not.toHaveClass("bg-surface-soft");
  });

  it("preserves the active knowledge base query when linking inside the knowledge base section", () => {
    render(
      <MemoryRouter initialEntries={["/settings/knowledge-base?knowledgeBaseId=kb1"]}>
        <SettingsNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "settings.navigation.knowledgeBase" })).toHaveAttribute(
      "href",
      "/settings/knowledge-base?knowledgeBaseId=kb1",
    );
  });
});
