import { getSession } from "../lib/sessionStorage";
import i18n from "@/shared/i18n";

/**
 * 根据消息内容生成标题
 * @param messageContents - 消息内容
 * @param providerCode - 提供者代码，默认使用 default
 * @returns 生成的标题
 */
export const generateTitle = async (
  messageContents: string = "",
  _providerCode?: string,
): Promise<string> => {
  if (!messageContents.trim()) {
    return i18n.t("chat.title.default");
  }

  // 构建标题生成提示
  const titlePrompt = `请根据以下对话内容生成一个简短的标题（不超过20个字符），只返回标题本身，不要其他内容：\n\n${messageContents.slice(0, 500)}`;

  try {
    const url = `/api/proxy/task/default`;

    // 从获取 token
    const token = getSession()?.token || "";

    // 调用代理 API 生成标题
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: titlePrompt }],
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    // 解析 SSE 流
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let titleGenerated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data);

              // 处理多种格式：
              // 格式1: OpenAI 风格 {choices: [{delta: {content: "xxx"}}]}
              // 格式2: 结构化风格 {type: "text-delta", delta: "xxx"}
              let text = "";

              if (parsed.type === "text-delta" && parsed.delta) {
                // 新格式：结构化 SSE
                text = parsed.delta;
              } else if (parsed.choices?.[0]?.delta?.content) {
                // 旧格式：OpenAI 风格
                text = parsed.choices[0].delta.content;
              } else if (parsed.choices?.[0]?.message?.content) {
                text = parsed.choices[0].message.content;
              } else if (parsed.content?.[0]?.text) {
                text = parsed.content[0].text;
              }

              titleGenerated += text;
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    }

    // 清理标题：移除 <think> 标签、去引号、截断
    const finalTitle =
      titleGenerated
        .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
        .trim()
        .replace(/^["'""''"]+|["'""''"]+$/g, "")
        .slice(0, 50) || i18n.t("chat.title.default");
    return finalTitle;
  } catch (error) {
    console.error("[Chat API] Failed to generate title:", error);
    return i18n.t("chat.title.default");
  }
};
