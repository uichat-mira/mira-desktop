import path from "node:path";
import AdmZip from "adm-zip";
import type { OfficeRuntimeWordReviewRequest } from "./contract.js";

const WORD_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const WORD_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const COMMENTS_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const COMMENTS_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";

export type DocumentReviewArtifact = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  summary: string;
  warnings: string[];
};

type EditableRun = {
  full: string;
  start: number;
  end: number;
  text: string;
  runProperties: string;
};

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const buildOutputFileName = (fileName: string) => {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, extension) || "document";
  return `${baseName}-wenshu.docx`;
};

const buildRun = (text: string, runProperties = "", deleted = false) => {
  if (!text) return "";
  const tag = deleted ? "w:delText" : "w:t";
  return `<w:r>${runProperties}<${tag} xml:space="preserve">${escapeXml(text)}</${tag}></w:r>`;
};

const findEditableRun = (documentXml: string, targetText: string): EditableRun => {
  if (!targetText) {
    throw new Error("Word review target text must not be empty");
  }

  const runRegex = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  let match: RegExpExecArray | null;
  while ((match = runRegex.exec(documentXml))) {
    const full = match[0];
    const textMatches = [...full.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
    if (textMatches.length !== 1) continue;

    const text = decodeXml(textMatches[0]?.[1] ?? "");
    if (!text.includes(targetText)) continue;

    const runProperties = full.match(/<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
    const stripped = full
      .replace(/^<w:r(?:\s[^>]*)?>/, "")
      .replace(/<\/w:r>$/, "")
      .replace(runProperties, "")
      .replace(textMatches[0]?.[0] ?? "", "")
      .trim();
    if (stripped) {
      throw new Error(
        `Word review target "${targetText}" is inside a complex run; refusing a lossy rewrite`,
      );
    }

    return {
      full,
      start: match.index,
      end: match.index + full.length,
      text,
      runProperties,
    };
  }

  throw new Error(`Word review target text was not found in a simple text run: ${targetText}`);
};

const replaceRun = (documentXml: string, run: EditableRun, replacement: string) =>
  `${documentXml.slice(0, run.start)}${replacement}${documentXml.slice(run.end)}`;

const nextNumericId = (xml: string, pattern: RegExp) => {
  let max = -1;
  for (const match of xml.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return max + 1;
};

const ensureCommentsPart = (archive: AdmZip) => {
  const existing = archive.getEntry("word/comments.xml");
  const commentsXml = existing
    ? existing.getData().toString("utf8")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${WORD_NS}"></w:comments>`;
  if (!existing) {
    archive.addFile("word/comments.xml", Buffer.from(commentsXml, "utf8"));
  }

  const relsEntry = archive.getEntry("word/_rels/document.xml.rels");
  if (!relsEntry) {
    throw new Error("Invalid DOCX file: word/_rels/document.xml.rels is missing");
  }
  let relsXml = relsEntry.getData().toString("utf8");
  if (!relsXml.includes(COMMENTS_REL_TYPE)) {
    const nextRid = nextNumericId(relsXml, /\bId="rId(\d+)"/g);
    const relationship = `<Relationship Id="rId${nextRid}" Type="${COMMENTS_REL_TYPE}" Target="comments.xml"/>`;
    const closeIndex = relsXml.lastIndexOf("</Relationships>");
    if (closeIndex < 0) {
      throw new Error("Invalid DOCX relationships XML");
    }
    relsXml = `${relsXml.slice(0, closeIndex)}${relationship}${relsXml.slice(closeIndex)}`;
    archive.updateFile("word/_rels/document.xml.rels", Buffer.from(relsXml, "utf8"));
  }

  const contentTypesEntry = archive.getEntry("[Content_Types].xml");
  if (!contentTypesEntry) {
    throw new Error("Invalid DOCX file: [Content_Types].xml is missing");
  }
  let contentTypesXml = contentTypesEntry.getData().toString("utf8");
  if (!contentTypesXml.includes('PartName="/word/comments.xml"')) {
    const override = `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_CONTENT_TYPE}"/>`;
    const closeIndex = contentTypesXml.lastIndexOf("</Types>");
    if (closeIndex < 0) throw new Error("Invalid DOCX content types XML");
    contentTypesXml = `${contentTypesXml.slice(0, closeIndex)}${override}${contentTypesXml.slice(closeIndex)}`;
    archive.updateFile("[Content_Types].xml", Buffer.from(contentTypesXml, "utf8"));
  }

  return commentsXml;
};

const appendComment = (commentsXml: string, input: {
  id: number;
  author: string;
  text: string;
  date: string;
}) => {
  const comment = `<w:comment w:id="${input.id}" w:author="${escapeXml(input.author)}" w:date="${input.date}"><w:p><w:r><w:t xml:space="preserve">${escapeXml(input.text)}</w:t></w:r></w:p></w:comment>`;

  // Real Word templates ship an empty comments part as a self-closing
  // <w:comments .../>, so a paired close tag is not guaranteed to exist.
  // Convert the empty self-closing root into a container before inserting.
  const selfClosing = /<w:comments\b([^>]*?)\/>\s*$/.exec(commentsXml);
  if (selfClosing) {
    return commentsXml.replace(
      selfClosing[0],
      `<w:comments${selfClosing[1]}>${comment}</w:comments>`,
    );
  }

  const closeIndex = commentsXml.lastIndexOf("</w:comments>");
  if (closeIndex < 0) throw new Error("Invalid DOCX comments XML");
  return `${commentsXml.slice(0, closeIndex)}${comment}${commentsXml.slice(closeIndex)}`;
};

const addCommentAnchor = (documentXml: string, input: {
  targetText: string;
  commentId: number;
}) => {
  const run = findEditableRun(documentXml, input.targetText);
  const targetIndex = run.text.indexOf(input.targetText);
  const before = run.text.slice(0, targetIndex);
  const after = run.text.slice(targetIndex + input.targetText.length);
  const replacement = [
    buildRun(before, run.runProperties),
    `<w:commentRangeStart w:id="${input.commentId}"/>`,
    buildRun(input.targetText, run.runProperties),
    `<w:commentRangeEnd w:id="${input.commentId}"/>`,
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${input.commentId}"/></w:r>`,
    buildRun(after, run.runProperties),
  ].join("");
  return replaceRun(documentXml, run, replacement);
};

const SETTINGS_BEFORE_TRACK_REVISIONS = [
  "writeProtection",
  "view",
  "zoom",
  "removePersonalInformation",
  "removeDateAndTime",
  "doNotDisplayPageBoundaries",
  "displayBackgroundShape",
  "printPostScriptOverText",
  "printFractionalCharacterWidth",
  "printFormsData",
  "embedTrueTypeFonts",
  "embedSystemFonts",
  "saveSubsetFonts",
  "saveFormsData",
  "mirrorMargins",
  "alignBordersAndEdges",
  "bordersDoNotSurroundHeader",
  "bordersDoNotSurroundFooter",
  "gutterAtTop",
  "hideSpellingErrors",
  "hideGrammaticalErrors",
  "activeWritingStyle",
  "proofState",
  "formsDesign",
  "attachedTemplate",
  "linkStyles",
  "stylePaneFormatFilter",
  "stylePaneSortMethod",
  "documentType",
  "mailMerge",
  "revisionView",
] as const;

const resolveTrackRevisionsInsertIndex = (settingsXml: string) => {
  let lastEnd = -1;
  for (const tag of SETTINGS_BEFORE_TRACK_REVISIONS) {
    const pattern = new RegExp(`<w:${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/w:${tag}>)`, "g");
    for (const match of settingsXml.matchAll(pattern)) {
      if (match.index !== undefined) {
        lastEnd = Math.max(lastEnd, match.index + match[0].length);
      }
    }
  }
  if (lastEnd >= 0) return lastEnd;

  const rootOpen = settingsXml.match(/<w:settings\b[^>]*>/);
  if (rootOpen?.index !== undefined) {
    return rootOpen.index + rootOpen[0].length;
  }
  throw new Error("Invalid DOCX settings XML");
};

const ensureTrackRevisions = (archive: AdmZip) => {
  const settingsEntry = archive.getEntry("word/settings.xml");
  if (!settingsEntry) {
    throw new Error("Invalid DOCX file: word/settings.xml is missing");
  }
  const settingsXml = settingsEntry.getData().toString("utf8");
  if (/<w:trackRevisions\b/.test(settingsXml)) return;
  const insertIndex = resolveTrackRevisionsInsertIndex(settingsXml);
  const updated = `${settingsXml.slice(0, insertIndex)}<w:trackRevisions/>${settingsXml.slice(insertIndex)}`;
  archive.updateFile("word/settings.xml", Buffer.from(updated, "utf8"));
};

const addTrackedInsertion = (documentXml: string, input: {
  afterText: string;
  text: string;
  revisionId: number;
  author: string;
  date: string;
}) => {
  const run = findEditableRun(documentXml, input.afterText);
  const targetIndex = run.text.indexOf(input.afterText) + input.afterText.length;
  const before = run.text.slice(0, targetIndex);
  const after = run.text.slice(targetIndex);
  const insertion = `<w:ins w:id="${input.revisionId}" w:author="${escapeXml(input.author)}" w:date="${input.date}">${buildRun(input.text, run.runProperties)}</w:ins>`;
  return replaceRun(
    documentXml,
    run,
    `${buildRun(before, run.runProperties)}${insertion}${buildRun(after, run.runProperties)}`,
  );
};

const addTrackedDeletion = (documentXml: string, input: {
  targetText: string;
  revisionId: number;
  author: string;
  date: string;
}) => {
  const run = findEditableRun(documentXml, input.targetText);
  const targetIndex = run.text.indexOf(input.targetText);
  const before = run.text.slice(0, targetIndex);
  const after = run.text.slice(targetIndex + input.targetText.length);
  const deletion = `<w:del w:id="${input.revisionId}" w:author="${escapeXml(input.author)}" w:date="${input.date}">${buildRun(input.targetText, run.runProperties, true)}</w:del>`;
  return replaceRun(
    documentXml,
    run,
    `${buildRun(before, run.runProperties)}${deletion}${buildRun(after, run.runProperties)}`,
  );
};

export const reviewDocument = (input: {
  fileName: string;
  buffer: Buffer;
  request: OfficeRuntimeWordReviewRequest;
}): DocumentReviewArtifact => {
  const archive = new AdmZip(input.buffer);
  const documentEntry = archive.getEntry("word/document.xml");
  if (!documentEntry) {
    throw new Error("Invalid DOCX file: word/document.xml is missing");
  }

  const author = input.request.author?.trim() || "Mira";
  const date = new Date().toISOString();
  let documentXml = documentEntry.getData().toString("utf8");
  let commentsAdded = 0;
  let insertionsAdded = 0;
  let deletionsAdded = 0;

  if (input.request.comments?.length) {
    let commentsXml = ensureCommentsPart(archive);
    let commentId = nextNumericId(commentsXml, /<w:comment\b[^>]*\bw:id="(\d+)"/g);
    for (const comment of input.request.comments) {
      documentXml = addCommentAnchor(documentXml, {
        targetText: comment.targetText,
        commentId,
      });
      commentsXml = appendComment(commentsXml, {
        id: commentId,
        author: comment.author?.trim() || author,
        text: comment.text,
        date,
      });
      commentId += 1;
      commentsAdded += 1;
    }
    archive.updateFile("word/comments.xml", Buffer.from(commentsXml, "utf8"));
  }

  const revisionCount =
    (input.request.insertions?.length ?? 0) + (input.request.deletions?.length ?? 0);
  if (revisionCount > 0) {
    ensureTrackRevisions(archive);
    let revisionId = nextNumericId(documentXml, /<w:(?:ins|del)\b[^>]*\bw:id="(\d+)"/g);
    for (const insertion of input.request.insertions ?? []) {
      documentXml = addTrackedInsertion(documentXml, {
        afterText: insertion.afterText,
        text: insertion.text,
        revisionId,
        author: insertion.author?.trim() || author,
        date,
      });
      revisionId += 1;
      insertionsAdded += 1;
    }
    for (const deletion of input.request.deletions ?? []) {
      documentXml = addTrackedDeletion(documentXml, {
        targetText: deletion.targetText,
        revisionId,
        author: deletion.author?.trim() || author,
        date,
      });
      revisionId += 1;
      deletionsAdded += 1;
    }
  }

  archive.updateFile("word/document.xml", Buffer.from(documentXml, "utf8"));

  return {
    fileName: buildOutputFileName(input.fileName),
    mimeType: WORD_MIME,
    buffer: archive.toBuffer(),
    summary: `完成 Word 审阅编辑：${commentsAdded} 条批注、${insertionsAdded} 条修订插入、${deletionsAdded} 条修订删除，并输出新的 DOCX 副本。`,
    warnings: [],
  };
};
