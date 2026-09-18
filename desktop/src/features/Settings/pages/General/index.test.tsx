// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import General from "./index";

const preferences = vi.hoisted(() => ({
  setColorTheme: vi.fn(),
  setLanguage: vi.fn(),
  setThemeMode: vi.fn(),
}));
const api = vi.hoisted(() => ({
  changePassword: vi.fn(),
  cleanupThreads: vi.fn(),
  getGeneralSettings: vi.fn(),
  updateGeneralSettings: vi.fn(),
}));
const modal = vi.hoisted(() => ({ confirm: vi.fn(), show: vi.fn() }));
const messages = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));
const stableT = (key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
  }),
}));
vi.mock("@/app/providers/AuthProvider", () => ({
  useAuth: () => ({ session: { user: { username: "alice", role: "admin" } } }),
}));
vi.mock("@/app/providers/LanguageProvider", () => ({
  useLanguagePreferences: () => ({
    language: "zh-CN",
    setLanguage: preferences.setLanguage,
    supportedLanguages: ["zh-CN", "en-US"],
  }),
}));
vi.mock("@/app/providers/ThemeProvider", () => ({
  useThemePreferences: () => ({
    colorTheme: "warm-neutral",
    setColorTheme: preferences.setColorTheme,
    themeMode: "light",
    setThemeMode: preferences.setThemeMode,
    themePresets: [
      { id: "warm-neutral" },
      { id: "knowledge-blue" },
    ],
  }),
}));
vi.mock("@/shared/api", () => ({ changePassword: api.changePassword }));
vi.mock("@/shared/api/thread", () => ({ cleanupThreads: api.cleanupThreads }));
vi.mock("@/shared/api/generalSettings", () => ({
  getGeneralSettings: api.getGeneralSettings,
  updateGeneralSettings: api.updateGeneralSettings,
}));
vi.mock("@/shared/ui/Modal", () => ({ Modal: modal }));
vi.mock("@/shared/ui/Message", () => ({ message: messages }));
vi.mock("@/shared/ui/Select", () => ({
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../../components/SettingsPageLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const emptyProxy = {
  socks5Host: "",
  socks5Port: 0,
  socks5Username: "",
  socks5Password: "",
};

describe("General settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getGeneralSettings.mockResolvedValue(emptyProxy);
    api.updateGeneralSettings.mockImplementation(async (value) => value);
  });

  it("loads account preferences and forwards language, theme, and mode changes", async () => {
    const user = userEvent.setup();
    render(<General />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    await waitFor(() => expect(api.getGeneralSettings).toHaveBeenCalled());

    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "en-US");
    await user.selectOptions(selects[1], "knowledge-blue");
    await user.click(
      screen.getByRole("switch", {
        name: "settings.general.darkMode.ariaLabel",
      }),
    );

    expect(preferences.setLanguage).toHaveBeenCalledWith("en-US");
    expect(preferences.setColorTheme).toHaveBeenCalledWith("knowledge-blue");
    expect(preferences.setThemeMode).toHaveBeenCalledWith("dark");
  });

  it("validates and saves SOCKS5 proxy settings", async () => {
    const user = userEvent.setup();
    render(<General />);
    await waitFor(() => expect(api.getGeneralSettings).toHaveBeenCalled());

    await user.type(
      screen.getByLabelText("settings.general.proxy.host"),
      "127.0.0.1",
    );
    await user.type(screen.getByLabelText("settings.general.proxy.port"), "70000");
    expect(screen.getByText("settings.general.proxy.portInvalid")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "settings.general.proxy.save" }),
    ).toBeDisabled();

    await user.clear(screen.getByLabelText("settings.general.proxy.port"));
    await user.type(screen.getByLabelText("settings.general.proxy.port"), "1080");
    await user.type(
      screen.getByLabelText("settings.general.proxy.username"),
      " proxy-user ",
    );
    await user.click(
      screen.getByRole("button", { name: "settings.general.proxy.save" }),
    );

    await waitFor(() =>
      expect(api.updateGeneralSettings).toHaveBeenCalledWith({
        socks5Host: "127.0.0.1",
        socks5Port: 1080,
        socks5Username: "proxy-user",
        socks5Password: "",
      }),
    );
    expect(
      await screen.findByText("settings.general.proxy.saveSuccess"),
    ).toBeInTheDocument();
  });

  it("opens current password and cleanup dialogs and executes cleanup", async () => {
    const user = userEvent.setup();
    api.cleanupThreads.mockResolvedValue({
      deletedThreads: 2,
      deletedMessages: 4,
      failedThreads: 0,
      failedWorkdirs: 0,
      clearedLogBytes: 2048,
      media: { images: { files: 3 } },
    });
    render(<General />);
    await waitFor(() => expect(api.getGeneralSettings).toHaveBeenCalled());

    await user.click(
      screen.getByRole("button", {
        name: "settings.general.account.changePassword",
      }),
    );
    expect(modal.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "settings.general.password.modalTitle",
        width: 520,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "settings.general.cleanup.action" }),
    );
    const confirmation = modal.confirm.mock.calls[0]?.[0];
    expect(confirmation).toMatchObject({
      title: "settings.general.cleanup.title",
      tone: "danger",
    });
    await act(async () => confirmation.onConfirm());

    expect(api.cleanupThreads).toHaveBeenCalled();
    expect(messages.success).toHaveBeenCalledWith(
      expect.stringContaining("settings.general.cleanup.success"),
    );
  });

  it("uses a warning notification when cleanup is partial", async () => {
    const user = userEvent.setup();
    api.cleanupThreads.mockResolvedValue({
      deletedThreads: 1,
      deletedMessages: 2,
      failedThreads: 0,
      failedWorkdirs: 1,
      clearedLogBytes: 0,
      media: { images: { files: 0 } },
    });
    render(<General />);
    await waitFor(() => expect(api.getGeneralSettings).toHaveBeenCalled());

    await user.click(
      screen.getByRole("button", { name: "settings.general.cleanup.action" }),
    );
    const confirmation = modal.confirm.mock.calls[0]?.[0];
    await act(async () => confirmation.onConfirm());

    expect(messages.warning).toHaveBeenCalledWith(
      expect.stringContaining("settings.general.cleanup.partial"),
    );
    expect(messages.success).not.toHaveBeenCalled();
  });
});
