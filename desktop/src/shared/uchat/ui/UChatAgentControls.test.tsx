// @vitest-environment jsdom
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, test, vi } from "vitest";
import i18n from "@/shared/i18n";
import {
  resolveUChatAgentSubmission,
  UChatAgentModeControl,
} from "./UChatAgentControls";

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
});

test("UChatAgentModeControl toggles the UChat Agent mode", () => {
  const onToggle = vi.fn();
  render(
    <UChatAgentModeControl
      enabled={false}
      availability={{ enabled: true }}
      onToggle={onToggle}
    />,
  );

  const button = screen.getByRole("button", { name: "Return to Agent" });
  assert.equal(button.hasAttribute("disabled"), false);
  assert.ok(screen.getByText("Compatibility Chat"));
  fireEvent.click(button);
  assert.equal(onToggle.mock.calls.length, 1);
});

test("UChatAgentModeControl preserves the workspace availability reason", () => {
  const onToggle = vi.fn();
  render(
    <UChatAgentModeControl
      enabled={false}
      availability={{
        enabled: false,
        disabledReason: "Bind a workspace before using Agent.",
      }}
      onToggle={onToggle}
    />,
  );

  const button = screen.getByRole("button", { name: "Return to Agent" });
  assert.equal(button.hasAttribute("disabled"), true);
  assert.equal(button.title, "Bind a workspace before using Agent.");
  fireEvent.click(button);
  assert.equal(onToggle.mock.calls.length, 0);
});

test("resolveUChatAgentSubmission keeps Agent routing outside the composer", () => {
  const onSend = vi.fn();
  const onAgentSend = vi.fn();
  const submission = resolveUChatAgentSubmission({
    controller: {
      enabled: true,
      submissionAvailability: { enabled: true },
      onSubmit: onAgentSend,
    },
    isSendDisabled: false,
    onSend,
  });

  assert.equal(submission.mode, "agent");
  assert.equal(submission.disabled, false);
  submission.submit();
  assert.equal(onAgentSend.mock.calls.length, 1);
  assert.equal(onSend.mock.calls.length, 0);
});
