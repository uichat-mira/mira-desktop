import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import iconv from "iconv-lite";

export type WebFetchContentKind =
  | "html"
  | "text"
  | "browser_required"
  | "unsupported";

export interface WebFetchExtractInput {
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

export type WebFetchExtractResult =
  | { kind: "html"; title: string; content: string }
  | { kind: "text"; content: string }
  | { kind: "browser_required"; reason: string }
  | { kind: "unsupported"; reason: string };

const MIN_READABLE_TEXT_LENGTH = 64;
const SNIFF_SAMPLE_BYTES = 4_096;
const BINARY_SNIFF_SAMPLE_BYTES = 1_024;

const JS_REQUIRED_PATTERN =
  /enable\s+javascript|javascript\s+is\s+(required|disabled|not\s+enabled)|requires?\s+javascript|please\s+enable\s+js|need\s+to\s+enable\s+javascript/i;
const CHALLENGE_PATTERN =
  /captcha|recaptcha|hcaptcha|cf[-_]?challenge|checking\s+your\s+browser|just\s+a\s+moment|attention\s+required|cloudflare|verify\s+you\s+are\s+human/i;
const LOGIN_PATTERN =
  /(sign|log)\s*in\s+to\s+continue|login\s+required|please\s+(sign|log)\s*in|authentication\s+required|access\s+denied|unauthorized/i;
const DOCUMENT_MIME_PATTERN =
  /^application\/(pdf|x-pdf|msword)$|vnd\.openxmlformats|^application\/vnd\.ms-/i;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const normalizeMimeType = (contentType: string) =>
  contentType.split(";")[0]?.trim().toLowerCase() ?? "";

type ContentFamily = "html" | "text" | "unknown";

const classifyContentType = (contentType: string): ContentFamily => {
  const mime = normalizeMimeType(contentType);
  if (!mime || mime === "application/octet-stream") {
    return "unknown";
  }
  if (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    mime === "text/xhtml"
  ) {
    return "html";
  }
  if (mime.startsWith("text/")) {
    return "text";
  }
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/ld+json" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml")
  ) {
    return "text";
  }
  return "unknown";
};

const detectBomCharset = (body: Buffer): string | undefined => {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    return "utf-8";
  }
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
    return "utf-16le";
  }
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
    return "utf-16be";
  }
  return undefined;
};

const parseCharsetFromContentType = (contentType: string) => {
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match?.[1]?.trim();
};

const sniffHtmlMetaCharset = (body: Buffer) => {
  const head = body.subarray(0, SNIFF_SAMPLE_BYTES).toString("latin1");
  const direct = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i.exec(head);
  if (direct?.[1]) {
    return direct[1];
  }
  const httpEquiv =
    /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_-]+)/i.exec(
      head,
    );
  return httpEquiv?.[1];
};

const resolveCharset = (input: {
  contentType: string;
  body: Buffer;
  isHtml: boolean;
}) => {
  const bom = detectBomCharset(input.body);
  if (bom) {
    return bom;
  }
  const headerCharset = parseCharsetFromContentType(input.contentType);
  if (headerCharset && iconv.encodingExists(headerCharset)) {
    return headerCharset;
  }
  if (input.isHtml) {
    const metaCharset = sniffHtmlMetaCharset(input.body);
    if (metaCharset && iconv.encodingExists(metaCharset)) {
      return metaCharset;
    }
  }
  return "utf-8";
};

const decodeBody = (body: Buffer, charset: string) => {
  const effective = iconv.encodingExists(charset) ? charset : "utf-8";
  const text = iconv.decode(body, effective);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const looksLikeHtml = (body: Buffer) => {
  const head = body
    .subarray(0, SNIFF_SAMPLE_BYTES)
    .toString("latin1")
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<!--")
  );
};

const hasNulByte = (body: Buffer) =>
  body.subarray(0, BINARY_SNIFF_SAMPLE_BYTES).includes(0);

const detectExplicitBrowserOnlyEvidence = (html: string): string | undefined => {
  const sample = html.slice(0, 200_000);
  if (JS_REQUIRED_PATTERN.test(sample)) {
    return "The page requires JavaScript to render its content.";
  }
  if (CHALLENGE_PATTERN.test(sample)) {
    return "The page is protected by an anti-bot challenge that requires a browser.";
  }
  if (LOGIN_PATTERN.test(sample)) {
    return "The page requires authentication that web_fetch cannot perform.";
  }
  return undefined;
};

const detectScriptRenderedShell = (input: {
  scriptCount: number;
  textLength: number;
}): string | undefined =>
  input.textLength < MIN_READABLE_TEXT_LENGTH && input.scriptCount > 0
    ? "The page appears to render its content with JavaScript."
    : undefined;

const extractHtml = (input: {
  html: string;
  finalUrl: string;
}): WebFetchExtractResult => {
  const html = input.html.trim();
  if (!html) {
    return { kind: "unsupported", reason: "The response body was empty." };
  }

  const explicitEvidence = detectExplicitBrowserOnlyEvidence(html);
  if (explicitEvidence) {
    return { kind: "browser_required", reason: explicitEvidence };
  }

  let document: Document;
  let scriptCount: number;
  let article: { title: string; content: string; textContent: string } | null;
  try {
    const dom = new JSDOM(html, {
      url: input.finalUrl || "https://invalid.mira.local/",
    });
    document = dom.window.document;
    scriptCount = document.querySelectorAll("script").length;
    const parsed = new Readability(document).parse();
    article = parsed
      ? {
          title: parsed.title ?? "",
          content: parsed.content ?? "",
          textContent: parsed.textContent ?? "",
        }
      : null;
  } catch {
    return {
      kind: "unsupported",
      reason: "The HTML document could not be parsed.",
    };
  }

  const articleText = (article?.textContent ?? "").replace(/\s+/g, " ").trim();

  const scriptShell = detectScriptRenderedShell({
    scriptCount,
    textLength: articleText.length,
  });
  if (scriptShell) {
    return { kind: "browser_required", reason: scriptShell };
  }

  if (article?.content && articleText.length >= MIN_READABLE_TEXT_LENGTH) {
    let markdown = "";
    try {
      markdown = turndown.turndown(article.content).trim();
    } catch {
      markdown = "";
    }
    return {
      kind: "html",
      title: (article.title || document.title || "").trim(),
      content: markdown || articleText,
    };
  }

  return {
    kind: "unsupported",
    reason: "No readable main content was found in the response.",
  };
};

export const extractWebContent = (
  input: WebFetchExtractInput,
): WebFetchExtractResult => {
  const family = classifyContentType(input.contentType);
  const bomCharset = detectBomCharset(input.body);
  const treatAsHtml =
    family === "html" || (family === "unknown" && looksLikeHtml(input.body));

  if (treatAsHtml) {
    if (!bomCharset && hasNulByte(input.body)) {
      return { kind: "unsupported", reason: "The response body is binary, not HTML." };
    }
    const charset = resolveCharset({
      contentType: input.contentType,
      body: input.body,
      isHtml: true,
    });
    return extractHtml({
      html: decodeBody(input.body, charset),
      finalUrl: input.finalUrl,
    });
  }

  if (family === "text") {
    if (!bomCharset && hasNulByte(input.body)) {
      return { kind: "unsupported", reason: "The response body is binary, not text." };
    }
    const charset = resolveCharset({
      contentType: input.contentType,
      body: input.body,
      isHtml: false,
    });
    const text = decodeBody(input.body, charset).trim();
    if (!text) {
      return { kind: "unsupported", reason: "The response body was empty." };
    }
    return { kind: "text", content: text };
  }

  const mime = normalizeMimeType(input.contentType);
  if (DOCUMENT_MIME_PATTERN.test(mime)) {
    return {
      kind: "unsupported",
      reason: `Document content (${mime}) is not extracted by web_fetch; use the governed document read path instead.`,
    };
  }
  return {
    kind: "unsupported",
    reason: mime
      ? `Unsupported content type: ${mime}.`
      : "Unsupported content type.",
  };
};
