import { describe, expect, it } from "vitest";
import { isExpectedAgt012FinalBrowserState } from "../agt012-smoke-evidence.js";

const expectedUrl = "http://127.0.0.1:43123/success?name=Mira";

describe("AGT-012 real-model smoke browser-state evidence", () => {
  it("accepts the expected Chromium URL and rendered page text", () => {
    expect(
      isExpectedAgt012FinalBrowserState({
        actualUrl: expectedUrl,
        expectedUrl,
        visibleText: "Welcome Mira authenticated",
      }),
    ).toBe(true);
  });

  it("rejects a different authenticated user even if the page shape is otherwise valid", () => {
    expect(
      isExpectedAgt012FinalBrowserState({
        actualUrl: "http://127.0.0.1:43123/success?name=WrongUser",
        expectedUrl,
        visibleText: "Welcome WrongUser authenticated",
      }),
    ).toBe(false);
  });

  it("rejects expected-looking text when Chromium reports a different final URL", () => {
    expect(
      isExpectedAgt012FinalBrowserState({
        actualUrl: "http://127.0.0.1:43123/success?name=WrongUser",
        expectedUrl,
        visibleText: "Welcome Mira authenticated",
      }),
    ).toBe(false);
  });

  it("rejects the expected URL when the rendered page identifies the wrong user", () => {
    expect(
      isExpectedAgt012FinalBrowserState({
        actualUrl: expectedUrl,
        expectedUrl,
        visibleText: "Welcome WrongUser authenticated",
      }),
    ).toBe(false);
  });

  it("fails closed when direct browser evidence is missing", () => {
    expect(
      isExpectedAgt012FinalBrowserState({
        actualUrl: undefined,
        expectedUrl,
        visibleText: undefined,
      }),
    ).toBe(false);
  });
});
