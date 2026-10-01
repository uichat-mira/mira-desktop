// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { settingsRoutes, useSettingsNavigationItems } from "./settingsRoutes";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("@/features/Settings/pages/General/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/Personalization/index", () => ({
  default: () => <div data-testid="personalization-page">personalization-page</div>,
}));
vi.mock("@/features/Settings/pages/Account/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/ModelSetting", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/Tools/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/Mcp", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/Personas/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/MicroApps/index", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/MicroApps/Detail", () => ({
  default: () => null,
}));
vi.mock("@/features/Settings/pages/MicroApps/Notion", () => ({
  default: () => <div data-testid="notion-micro-app-page">notion-micro-app-page</div>,
}));
vi.mock("@/features/Settings/pages/MicroApps/NewsHub", () => ({
  default: () => <div data-testid="news-hub-page">news-hub-page</div>,
}));
vi.mock("@/features/Settings/pages/MicroApps/ImageGeneration", () => ({
  default: () => <div data-testid="image-generation-studio-page">image-generation-studio-page</div>,
}));
vi.mock("@/features/Settings/pages/MicroApps/ComputerUse", () => ({
  default: () => <div data-testid="computer-use-debugger-page">computer-use-debugger-page</div>,
}));
vi.mock("@/features/Settings/pages/MicroApps/MailCenter", () => ({
  default: () => <div data-testid="mail-center-page">mail-center-page</div>,
}));
vi.mock("@/features/Settings/pages/MicroApps/Tts", () => ({
  default: () => <div data-testid="tts-studio-page">tts-studio-page</div>,
}));

function NavigationProbe() {
  const items = useSettingsNavigationItems();

  return (
    <ul>
      {items.map((item) => (
        <li key={item.to}>
          {item.label}:{item.to}:{item.group}:{item.order}:{item.match}:{String(item.preserveSearch)}
        </li>
      ))}
    </ul>
  );
}

describe("settings routes", () => {
  it("includes mcp route in route objects", () => {
    expect(settingsRoutes.some((route) => route.path === "mcp")).toBe(true);
  });

  it("includes the enterprise integrations route", () => {
    expect(settingsRoutes.some((route) => route.path === "integrations")).toBe(true);
  });

  it("includes mcp route in navigation items", () => {
    render(
      <MemoryRouter>
        <NavigationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("settings.navigation.mcp:/settings/mcp:basic:30:exact:false"),
    ).toBeInTheDocument();
  });

  it("includes personalization below general and mounts its page", () => {
    render(
      <MemoryRouter>
        <NavigationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "settings.navigation.personalization:/settings/personalization:general:20:exact:false",
      ),
    ).toBeInTheDocument();

    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      { initialEntries: ["/settings/personalization"] },
    );

    render(<RouterProvider router={router} />);
    expect(screen.getByTestId("personalization-page")).toBeInTheDocument();
  });


  it("includes micro apps route in navigation items", () => {
    render(
      <MemoryRouter>
        <NavigationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("settings.navigation.microApps:/settings/micro-apps:app:15:prefix:false"),
    ).toBeInTheDocument();
  });

  it("marks micro apps navigation as prefix-matched for detail pages", () => {
    render(
      <MemoryRouter>
        <NavigationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("settings.navigation.microApps:/settings/micro-apps:app:15:prefix:false"),
    ).toBeInTheDocument();
  });

  it("includes the news hub route under the micro apps path", () => {
    const microAppsRoute = settingsRoutes.find((route) => route.path === "micro-apps");
    expect(
      microAppsRoute?.children?.some(
        (route) => route.path === "news-hub",
      ),
    ).toBe(true);
  });

  it("mounts the news hub page at /settings/micro-apps/news-hub", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      {
        initialEntries: ["/settings/micro-apps/news-hub"],
      },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("news-hub-page")).toBeInTheDocument();
  });


  it("mounts the Notion micro app at /settings/micro-apps/notion", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      {
        initialEntries: ["/settings/micro-apps/notion"],
      },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("notion-micro-app-page")).toBeInTheDocument();
  });

  it("includes the image generation studio route under the micro apps path", () => {
    const microAppsRoute = settingsRoutes.find((route) => route.path === "micro-apps");
    expect(
      microAppsRoute?.children?.some(
        (route) => route.path === "image-generation-studio",
      ),
    ).toBe(true);
  });

  it("mounts the image generation studio page at /settings/micro-apps/image-generation-studio", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      {
        initialEntries: ["/settings/micro-apps/image-generation-studio"],
      },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("image-generation-studio-page")).toBeInTheDocument();
  });

  it("includes the computer use route under the micro apps path", () => {
    const microAppsRoute = settingsRoutes.find((route) => route.path === "micro-apps");
    expect(
      microAppsRoute?.children?.some(
        (route) => route.path === "computer-use-studio",
      ),
    ).toBe(true);
  });

  it("mounts the debugger page at /settings/micro-apps/computer-use-studio", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      {
        initialEntries: ["/settings/micro-apps/computer-use-studio"],
      },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("computer-use-debugger-page")).toBeInTheDocument();
  });

  it("includes the mail center route under the micro apps path", () => {
    const microAppsRoute = settingsRoutes.find((route) => route.path === "micro-apps");
    expect(
      microAppsRoute?.children?.some(
        (route) => route.path === "mail-center",
      ),
    ).toBe(true);
  });

  it("mounts the mail center page at /settings/micro-apps/mail-center", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      {
        initialEntries: ["/settings/micro-apps/mail-center"],
      },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("mail-center-page")).toBeInTheDocument();
  });

  it("includes the tts studio route under the micro apps path", () => {
    const microAppsRoute = settingsRoutes.find((route) => route.path === "micro-apps");
    expect(
      microAppsRoute?.children?.some(
        (route) => route.path === "tts-studio",
      ),
    ).toBe(true);
  });

  it("mounts the tts studio page at /settings/micro-apps/tts-studio", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          children: settingsRoutes,
        },
      ],
      {
        initialEntries: ["/settings/micro-apps/tts-studio"],
      },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByTestId("tts-studio-page")).toBeInTheDocument();
  });
});
