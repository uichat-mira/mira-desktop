import { createAssistantTextStream } from "@/services/chat-stream-events.js";
import { getErrorMessage } from "@/utils/errors.js";

class ThinkTagFilter {
  private buffer = "";
  private inThink = false;

  push(delta: string): string[] {
    this.buffer += delta;
    const output: string[] = [];

    while (this.buffer) {
      if (this.inThink) {
        const closing = this.buffer.search(/<\/think\s*>/i);
        if (closing < 0) {
          this.buffer = this.buffer.slice(-8);
          break;
        }
        this.buffer = this.buffer.slice(closing).replace(/^<\/think\s*>/i, "");
        this.inThink = false;
        continue;
      }

      const opening = this.buffer.search(/<think\b[^>]*>/i);
      if (opening < 0) {
        const lastOpen = this.buffer.toLowerCase().lastIndexOf("<");
        const suffix = lastOpen >= 0 ? this.buffer.slice(lastOpen).toLowerCase() : "";
        const holdsOpeningPrefix =
          (suffix.startsWith("<think") || "<think".startsWith(suffix)) &&
          !suffix.includes(">");
        const safeLength = holdsOpeningPrefix ? lastOpen : this.buffer.length;
        if (safeLength > 0) {
          output.push(this.buffer.slice(0, safeLength));
          this.buffer = this.buffer.slice(safeLength);
        }
        break;
      }

      if (opening > 0) {
        output.push(this.buffer.slice(0, opening));
      }
      this.buffer = this.buffer.slice(opening).replace(/^<think\b[^>]*>/i, "");
      this.inThink = true;
    }

    return output.filter(Boolean);
  }

  finish(): string[] {
    if (this.inThink) {
      this.buffer = "";
      return [];
    }
    const output = this.buffer;
    this.buffer = "";
    return output ? [output] : [];
  }
}

export const createUiMessageStream = (
  streamText: () => AsyncIterable<string>,
) =>
  createAssistantTextStream(() => filterThinkTagStream(streamText()), {
    includeStartStep: true,
    getErrorMessage,
  });

export async function* filterThinkTagStream(
  stream: AsyncIterable<string>,
): AsyncGenerator<string> {
  const filter = new ThinkTagFilter();
  for await (const delta of stream) {
    for (const visible of filter.push(delta)) {
      yield visible;
    }
  }
  for (const visible of filter.finish()) {
    yield visible;
  }
}

export const __streamNormalizerTestUtils = { ThinkTagFilter };
