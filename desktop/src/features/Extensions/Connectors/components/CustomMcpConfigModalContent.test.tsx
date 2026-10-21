// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CustomMcpConfigModalContent from "./CustomMcpConfigModalContent";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("CustomMcpConfigModalContent", () => {
  it("keeps local and cloud JSON separately while switching modes", async () => {
    const user = userEvent.setup();
    render(<CustomMcpConfigModalContent onCancel={vi.fn()} onSubmit={vi.fn()} />);
    const editor = screen.getByRole("textbox", { name: "app.connectors.custom.jsonLabel" });
    await user.clear(editor);
    fireEvent.change(editor, { target: { value: '{"mcpServers":{"local":{"command":"node"}}}' } });
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.modes.cloud" }));
    const cloudEditor = screen.getByRole("textbox", { name: "app.connectors.custom.jsonLabel" });
    expect((cloudEditor as HTMLTextAreaElement).value).toContain('"url"');
    fireEvent.change(cloudEditor, { target: { value: '{"mcpServers":{"cloud":{"url":"https://example.test"}}}' } });
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.modes.local" }));
    expect(screen.getByRole("textbox", { name: "app.connectors.custom.jsonLabel" })).toHaveValue('{"mcpServers":{"local":{"command":"node"}}}');
  });

  it("shows validation beside the editor and keeps invalid input intact", async () => {
    const user = userEvent.setup();
    render(<CustomMcpConfigModalContent onCancel={vi.fn()} onSubmit={vi.fn()} />);
    const editor = screen.getByRole("textbox", { name: "app.connectors.custom.jsonLabel" });
    fireEvent.change(editor, { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.confirm" }));
    expect(screen.getByRole("alert")).toHaveTextContent("app.connectors.custom.errors.invalidJson");
    expect(editor).toHaveValue("{");
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.format" }));
    expect(screen.getByRole("alert")).toHaveTextContent("app.connectors.custom.errors.invalidJson");
    expect(editor).toHaveValue("{");
  });

  it("submits one draft per parsed service only after the current mode validates", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<CustomMcpConfigModalContent onCancel={vi.fn()} onSubmit={onSubmit} />);
    const editor = screen.getByRole("textbox", { name: "app.connectors.custom.jsonLabel" });
    fireEvent.change(editor, { target: { value: '{"mcpServers":{"one":{"command":"node"},"two":{"command":"npx","args":["-y"]}}}' } });
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.format" }));
    expect((editor as HTMLTextAreaElement).value).toContain("\n");
    await user.click(screen.getByRole("button", { name: "app.connectors.custom.confirm" }));
    expect(onSubmit).toHaveBeenCalledWith("local", [
      { name: "one", config: { command: "node" } },
      { name: "two", config: { command: "npx", args: ["-y"] } },
    ]);
  });
});
