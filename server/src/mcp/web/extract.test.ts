import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { extractWebContent } from "./extract.js";

const utf8 = (value: string) => Buffer.from(value, "utf8");

const articlePage = (input: { title: string; body: string }) => `<!doctype html>
<html>
  <head><title>${input.title}</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <header><h1>Site Header</h1></header>
    <main><article>${input.body}</article></main>
    <footer>Copyright 2026 Mira</footer>
  </body>
</html>`;

const LONG_PARAGRAPH =
  "Mira now retrieves a known public URL through a guarded transport and converts the readable main content into bounded markdown for the model. ";

describe("web content extraction", () => {
  it("extracts readable HTML main content as markdown", () => {
    const html = articlePage({
      title: "Mira Release Notes",
      body: `
        <h1>Mira Release Notes</h1>
        <p>${LONG_PARAGRAPH.repeat(2)}</p>
        <h2>Highlights</h2>
        <ul><li>Safe transport</li><li>Readable extraction</li></ul>
        <p>${LONG_PARAGRAPH.repeat(2)}</p>
      `,
    });

    const result = extractWebContent({
      finalUrl: "https://example.com/notes",
      contentType: "text/html; charset=utf-8",
      body: utf8(html),
    });

    expect(result.kind).toBe("html");
    if (result.kind !== "html") throw new Error("expected html result");
    expect(result.title).toContain("Mira Release Notes");
    expect(result.content).toContain("Mira now retrieves a known public URL");
    expect(result.content).toMatch(/^#{1,6}\s/m);
    expect(result.content).toContain("Highlights");
    expect(result.content).not.toContain("Site Header");
    expect(result.content).not.toContain("Copyright 2026");
  });

  it("does not treat a Cloudflare CDN script URL as an anti-bot challenge", () => {
    const html = `<!doctype html><html><head><title>Normal article</title><script src="https://cdnjs.cloudflare.com/ajax/libs/example/1.0.0/example.min.js"></script></head><body><article><h1>Normal article</h1><p>${LONG_PARAGRAPH.repeat(3)}</p></article></body></html>`;

    const result = extractWebContent({
      finalUrl: "https://example.com/article",
      contentType: "text/html; charset=utf-8",
      body: utf8(html),
    });

    expect(result.kind).toBe("html");
    if (result.kind !== "html") throw new Error("expected html result");
    expect(result.content).toContain("Mira now retrieves a known public URL");
  });

  it("decodes non-UTF-8 HTML declared in the Content-Type charset", () => {
    const chinese =
      "这是一段用于验证 GBK 解码是否正确的中文正文内容，包含足够长度以便被识别为主正文。".repeat(
        2,
      );
    const html = articlePage({
      title: "中文标题",
      body: `<h1>中文标题</h1><p>${chinese}</p>`,
    });
    const body = iconv.encode(html, "gbk");

    const result = extractWebContent({
      finalUrl: "https://example.com/cn",
      contentType: "text/html; charset=gbk",
      body,
    });

    expect(result.kind).toBe("html");
    if (result.kind !== "html") throw new Error("expected html result");
    expect(result.title).toContain("中文标题");
    expect(result.content).toContain("这是一段用于验证 GBK 解码");
    expect(result.content).not.toContain("\uFFFD");
  });

  it("decodes HTML using the meta charset when the header omits it", () => {
    const chinese =
      "当响应头没有声明字符集时，HTML 里的 meta 字符集声明也应该被正确识别并用于解码。".repeat(
        2,
      );
    const html = `<!doctype html><html><head><meta charset="gbk"><title>元数据</title></head><body><article><h1>元数据</h1><p>${chinese}</p></article></body></html>`;
    const body = iconv.encode(html, "gbk");

    const result = extractWebContent({
      finalUrl: "https://example.com/meta",
      contentType: "text/html",
      body,
    });

    expect(result.kind).toBe("html");
    if (result.kind !== "html") throw new Error("expected html result");
    expect(result.content).toContain("meta 字符集声明");
    expect(result.content).not.toContain("\uFFFD");
  });

  it("returns plain text for text/plain", () => {
    const result = extractWebContent({
      finalUrl: "https://example.com/robots.txt",
      contentType: "text/plain; charset=utf-8",
      body: utf8("User-agent: *\nDisallow: /private\n"),
    });

    expect(result).toEqual({
      kind: "text",
      content: "User-agent: *\nDisallow: /private",
    });
  });

  it("returns JSON payloads as text", () => {
    const result = extractWebContent({
      finalUrl: "https://example.com/api",
      contentType: "application/json",
      body: utf8('{"ok":true}'),
    });

    expect(result).toEqual({ kind: "text", content: '{"ok":true}' });
  });

  it("reports browser_required for a JavaScript shell", () => {
    const html = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript><script src="/app.js"></script></body></html>`;

    const result = extractWebContent({
      finalUrl: "https://example.com/app",
      contentType: "text/html; charset=utf-8",
      body: utf8(html),
    });

    expect(result.kind).toBe("browser_required");
    if (result.kind !== "browser_required") throw new Error("expected browser_required");
    expect(result.reason).toMatch(/javascript/i);
  });

  it("reports browser_required for a login wall", () => {
    const html = `<!doctype html><html><head><title>Sign in</title></head><body><form><h1>Sign in to continue</h1><input name="user"/></form></body></html>`;

    const result = extractWebContent({
      finalUrl: "https://example.com/login",
      contentType: "text/html; charset=utf-8",
      body: utf8(html),
    });

    expect(result.kind).toBe("browser_required");
    if (result.kind !== "browser_required") throw new Error("expected browser_required");
    expect(result.reason).toMatch(/authentication|log in|sign in/i);
  });

  it("reports browser_required for an anti-bot challenge", () => {
    const html = `<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Checking your browser before accessing the site</h1></body></html>`;

    const result = extractWebContent({
      finalUrl: "https://example.com/challenge",
      contentType: "text/html; charset=utf-8",
      body: utf8(html),
    });

    expect(result.kind).toBe("browser_required");
    if (result.kind !== "browser_required") throw new Error("expected browser_required");
    expect(result.reason).toMatch(/challenge/i);
  });

  it("reports unsupported for a PDF document without building a parser", () => {
    const result = extractWebContent({
      finalUrl: "https://example.com/doc.pdf",
      contentType: "application/pdf",
      body: utf8("%PDF-1.7\n1 0 obj\n"),
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(result.reason).toContain("pdf");
  });

  it("reports unsupported for a binary image", () => {
    const result = extractWebContent({
      finalUrl: "https://example.com/image.png",
      contentType: "image/png",
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    expect(result.kind).toBe("unsupported");
  });

  it("reports unsupported when HTML bytes are actually binary", () => {
    const result = extractWebContent({
      finalUrl: "https://example.com/odd",
      contentType: "text/html",
      body: Buffer.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x00, 0x00, 0x00]),
    });

    expect(result.kind).toBe("unsupported");
  });

  it("reports unsupported for a short static page without browser-only evidence", () => {
    const html = `<!doctype html><html><head><title>Note</title></head><body><p>Short note.</p></body></html>`;

    const result = extractWebContent({
      finalUrl: "https://example.com/note",
      contentType: "text/html; charset=utf-8",
      body: utf8(html),
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(result.reason).toMatch(/readable/i);
  });

  it("prefers browser_required over readable text for long browser-only pages", () => {
    const filler =
      "This paragraph exists only to make the page long enough that naive extraction would treat it as a readable article. ".repeat(
        4,
      );

    const fixtures = [
      {
        url: "https://example.com/member",
        html: articlePage({
          title: "Member Area",
          body: `<h1>Sign in to continue</h1><p>${filler}</p><p>${filler}</p>`,
        }),
      },
      {
        url: "https://example.com/challenge",
        html: `<!doctype html><html><head><title>Just a moment...</title></head><body><h1>Checking your browser before accessing the site</h1><p>${filler}</p></body></html>`,
      },
    ];

    for (const fixture of fixtures) {
      const result = extractWebContent({
        finalUrl: fixture.url,
        contentType: "text/html; charset=utf-8",
        body: utf8(fixture.html),
      });
      expect(result.kind).toBe("browser_required");
    }
  });
});
