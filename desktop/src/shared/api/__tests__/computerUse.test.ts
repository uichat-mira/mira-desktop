import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/shared/lib/request", () => ({ get: vi.fn(), post: vi.fn() }));
import { get, post } from "@/shared/lib/request";
import { getComputerUseRuntimeStatus, installComputerUseRuntime } from "../computerUse";

describe("computer use runtime api", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reads managed browser runtime state", async () => {
    await getComputerUseRuntimeStatus();
    expect(get).toHaveBeenCalledWith("/microapps/computer-use/runtime");
  });

  it("posts managed browser runtime install requests", async () => {
    await installComputerUseRuntime();
    expect(post).toHaveBeenCalledWith("/microapps/computer-use/runtime/install", { force: false });
    await installComputerUseRuntime(true);
    expect(post).toHaveBeenLastCalledWith("/microapps/computer-use/runtime/install", { force: true });
  });
});
