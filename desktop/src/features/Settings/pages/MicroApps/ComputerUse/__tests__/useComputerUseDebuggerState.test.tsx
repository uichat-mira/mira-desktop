// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComputerUseRuntimeState } from "../useComputerUseDebuggerState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("useComputerUseRuntimeState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes only runtime state and refreshes from the runtime endpoint", async () => {
    const getComputerUseRuntimeStatus = vi.fn(async () => ({
      status: "ready" as const,
      checkedAt: "2026-10-19T07:00:00.000Z",
    }));

    const { result } = renderHook(() =>
      useComputerUseRuntimeState({ getComputerUseRuntimeStatus }),
    );

    expect(result.current.runtime.status).toBe("not_installed");
    expect("session" in result.current).toBe(false);
    expect("model" in result.current).toBe(false);

    await act(async () => {
      await result.current.refreshStatus();
    });

    expect(getComputerUseRuntimeStatus).toHaveBeenCalledOnce();
    expect(result.current.status).toEqual({
      status: "ready",
      checkedAt: "2026-10-19T07:00:00.000Z",
    });
  });
});
