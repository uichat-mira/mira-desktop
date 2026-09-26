export type PreviewChunk = {
  id: string;
  index: number;
  text: string;
};

export type ChunkSettings = {
  separator: string;
  maxLength: number;
  overlap: number;
  replaceWhitespace: boolean;
  removeUrls: boolean;
  useQaSplit: boolean;
};

function decodeSeparator(separator: string) {
  return separator
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(raw: string, settings: ChunkSettings) {
  let next = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (settings.removeUrls) {
    next = next.replace(/https?:\/\/\S+/g, "").replace(/\b\S+@\S+\.\S+\b/g, "");
  }

  if (settings.replaceWhitespace) {
    next = next
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  return next.trim();
}

function splitBySeparator(text: string, separator: string) {
  const decoded = decodeSeparator(separator);

  if (!decoded.trim()) {
    return text
      .split(/\n\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (/^\s+$/.test(decoded)) {
    return text
      .split(new RegExp(`${escapeRegExp(decoded)}+`, "g"))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return text
    .split(decoded)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitIntoSentences(text: string) {
  return text
    .split(/(?<=[。！？!?\.])\s+|(?<=[:：；;])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitIntoClauses(text: string) {
  return text
    .split(/(?<=[，,、])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hardSplit(text: string, maxLength: number, overlap: number) {
  const chunks: string[] = [];
  const safeMaxLength = Math.max(1, maxLength);
  const safeOverlap = Math.max(0, Math.min(overlap, safeMaxLength - 1));
  let cursor = 0;

  while (cursor < text.length) {
    const limit = Math.min(cursor + safeMaxLength, text.length);
    let end = limit;

    if (limit < text.length) {
      const windowStart = Math.max(cursor + Math.floor(safeMaxLength * 0.55), cursor);
      const window = text.slice(windowStart, limit);
      const localBreak = Math.max(
        window.lastIndexOf("。"),
        window.lastIndexOf("！"),
        window.lastIndexOf("？"),
        window.lastIndexOf("."),
        window.lastIndexOf("；"),
        window.lastIndexOf(";"),
        window.lastIndexOf("，"),
        window.lastIndexOf(","),
        window.lastIndexOf(" "),
      );

      if (localBreak > -1) {
        end = windowStart + localBreak + 1;
      }
    }

    const piece = text.slice(cursor, end).trim();
    if (piece) {
      chunks.push(piece);
    }

    if (end >= text.length) {
      break;
    }

    cursor = Math.max(end - safeOverlap, cursor + 1);
  }

  return chunks;
}

function extractQaBlocks(text: string) {
  const lines = text.split("\n").map((line) => line.trim());
  const blocks: string[] = [];
  const questionPattern = /^(Q[:：]|问[:：]|问题[:：]?)/i;
  const answerPattern = /^(A[:：]|答[:：]|回答[:：]?)/i;

  let currentQuestion = "";
  let currentAnswer = "";

  for (const line of lines) {
    if (!line) {
      if (currentQuestion || currentAnswer) {
        blocks.push([currentQuestion, currentAnswer].filter(Boolean).join("\n"));
        currentQuestion = "";
        currentAnswer = "";
      }
      continue;
    }

    if (questionPattern.test(line)) {
      if (currentQuestion || currentAnswer) {
        blocks.push([currentQuestion, currentAnswer].filter(Boolean).join("\n"));
      }
      currentQuestion = line;
      currentAnswer = "";
      continue;
    }

    if (answerPattern.test(line)) {
      currentAnswer = currentAnswer ? `${currentAnswer}\n${line}` : line;
      continue;
    }

    if (currentAnswer) {
      currentAnswer = `${currentAnswer}\n${line}`;
      continue;
    }

    if (currentQuestion) {
      currentQuestion = `${currentQuestion}\n${line}`;
      continue;
    }
  }

  if (currentQuestion || currentAnswer) {
    blocks.push([currentQuestion, currentAnswer].filter(Boolean).join("\n"));
  }

  return blocks.filter(Boolean);
}

function toUnits(text: string, settings: ChunkSettings) {
  const qaBlocks = settings.useQaSplit ? extractQaBlocks(text) : [];
  const baseBlocks = qaBlocks.length > 0 ? qaBlocks : splitBySeparator(text, settings.separator);
  const units: string[] = [];

  for (const block of baseBlocks) {
    if (block.length <= settings.maxLength) {
      units.push(block);
      continue;
    }

    const sentences = splitIntoSentences(block);
    const sentenceUnits = sentences.length > 1 ? sentences : splitIntoClauses(block);

    for (const sentence of sentenceUnits) {
      if (sentence.length <= settings.maxLength) {
        units.push(sentence);
        continue;
      }

      units.push(...hardSplit(sentence, settings.maxLength, settings.overlap));
    }
  }

  return units;
}

function takeOverlapText(text: string, overlap: number) {
  if (overlap <= 0 || text.length <= overlap) {
    return text;
  }

  const tail = text.slice(-overlap);
  const whitespaceIndex = Math.max(tail.indexOf(" "), tail.indexOf("\n"));

  if (whitespaceIndex > -1 && whitespaceIndex < tail.length - 1) {
    return tail.slice(whitespaceIndex + 1).trim();
  }

  return tail.trim();
}

export function splitTextIntoChunks(text: string, settings: ChunkSettings) {
  const safeSettings = {
    ...settings,
    maxLength: Math.max(100, settings.maxLength || 0),
    overlap: Math.max(0, Math.min(settings.overlap || 0, Math.max((settings.maxLength || 100) - 1, 0))),
  };
  const cleaned = normalizeText(text, safeSettings);
  const units = toUnits(cleaned, safeSettings);
  const chunks: PreviewChunk[] = [];
  let current = "";

  const pushChunk = (value: string) => {
    const textValue = value.trim();
    if (!textValue) {
      return "";
    }

    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      index: chunks.length + 1,
      text: textValue,
    });

    return takeOverlapText(textValue, safeSettings.overlap);
  };

  for (const unit of units) {
    const nextValue = current ? `${current}\n\n${unit}` : unit;

    if (nextValue.length <= safeSettings.maxLength) {
      current = nextValue;
      continue;
    }

    const overlapSeed = pushChunk(current);
    current = overlapSeed ? `${overlapSeed}\n\n${unit}` : unit;

    if (current.length > safeSettings.maxLength) {
      const hardChunks = hardSplit(current, safeSettings.maxLength, safeSettings.overlap);
      current = "";

      for (let index = 0; index < hardChunks.length; index += 1) {
        const piece = hardChunks[index];
        if (index === hardChunks.length - 1) {
          current = piece;
        } else {
          pushChunk(piece);
        }
      }
    }
  }

  pushChunk(current);

  return chunks;
}
