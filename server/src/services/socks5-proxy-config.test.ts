import { describe, expect, it } from "vitest";
import { buildSocks5ProxyUrl } from "./socks5-proxy-config.js";

const settings = {
  socks5Host: " 127.0.0.1 ",
  socks5Port: 1080,
  socks5Username: "",
  socks5Password: "",
};

describe("shared SOCKS5 network settings", () => {
  it("preserves the original direct default when Host or Port is absent", () => {
    expect(buildSocks5ProxyUrl({ ...settings, socks5Host: "" })).toBeNull();
    expect(buildSocks5ProxyUrl({ ...settings, socks5Port: 0 })).toBeNull();
    expect(buildSocks5ProxyUrl({ ...settings, socks5Port: 65536 })).toBeNull();
  });

  it("preserves existing GitHub socks5 mode, but supports proxy-side DNS for Cloud", () => {
    expect(buildSocks5ProxyUrl(settings)).toBe("socks5://127.0.0.1:1080");
    expect(buildSocks5ProxyUrl(settings, "socks5h"))
      .toBe("socks5h://127.0.0.1:1080");
  });

  it("encodes credentials, never allowing their separators to alter the URL", () => {
    expect(buildSocks5ProxyUrl({
      ...settings, socks5Username: "test@host", socks5Password: "p:a/s?",
    }, "socks5h")).toBe("socks5h://test%40host:p%3Aa%2Fs%3F@127.0.0.1:1080");
  });
});
