// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComputerUseDebuggerState } from "../useComputerUseDebuggerState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useComputerUseDebuggerState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the retired model surface out of debugger state and refreshes runtime status", async () => {
    const getComputerUseDebuggerStatus = vi.fn(async () => ({
      runtime: {
        status: "ready" as const,
        checkedAt: "2026-10-19T07:00:00.000Z",
      },
    }));

    const { result } = renderHook(() =>
      useComputerUseDebuggerState({ getComputerUseDebuggerStatus }),
    );

    expect(result.current.runtime.status).toBe("not_installed");
    expect("model" in result.current).toBe(false);
    expect("runModel" in result.current).toBe(false);
    expect("modelRun" in result.current).toBe(false);

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(getComputerUseDebuggerStatus).toHaveBeenCalledOnce();
    expect(result.current.status).toEqual({
      runtime: {
        status: "ready",
        checkedAt: "2026-10-19T07:00:00.000Z",
      },
    });
  });
});
