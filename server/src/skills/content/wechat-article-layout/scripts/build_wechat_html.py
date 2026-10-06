#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build_wechat_html.py — 生成微信公众号编辑器可直接粘贴的排版 HTML。

核心：所有元素自带背景色与内边距、纵向间距一律用 padding、牺牲外层、
负 margin 出血，保证微信编辑器剥离外层样式后排版不崩。

用法：
    python build_wechat_html.py --input a.md --output o.html --style minimal-light

脚本只依赖 Python 标准库，可由 Mira 的 terminal 在受治理工作区内执行。
"""

import argparse
import os
import re

# ---------------------------------------------------------------- 风格预设
PRESETS = {
    "terminal-dark": {
        "desc": "终端暗黑风（Mira 系列同款）：黑底、等宽字体、绿色点缀、SECTION 编号、百分比芯片",
        "page_bg": "#0c0c0c", "text": "#c8c8c8",
        "font": "'SF Mono','Fira Code','Consolas','Noto Sans Mono',monospace",
        "accent": "#7fb285", "label_color": "#4a7c59", "divider": "#2a2a2a",
        "heading_color": "#f0f0f0",
        "quote_default": {"bg": "#1a1a1a", "border": "#666", "text": "#e0e0e0"},
        "quote_accent":  {"bg": "#142218", "border": "#4a7c59", "text": "#8fbc8f"},
        "quote_warn":    {"bg": "#241416", "border": "#a05555", "text": "#d08080"},
        "chip": {"bg": "#142218", "text": "#7fb285"},
        "sections_numbering": True, "percent_chips": True, "prompt_lines": True,
        "light": False,
    },
    "minimal-light": {
        "desc": "清爽简约风：白底黑字、灰引用块、细分割线，适合大多数正文",
        "page_bg": "#ffffff", "text": "#3f3f3f",
        "font": "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif",
        "accent": "#1a1a1a", "label_color": "#999999", "divider": "#e5e5e5",
        "heading_color": "#1a1a1a",
        "quote_default": {"bg": "#f7f7f7", "border": "#d0d0d0", "text": "#595959"},
        "quote_accent":  {"bg": "#f0f5f1", "border": "#7fb285", "text": "#4a7c59"},
        "quote_warn":    {"bg": "#faf3f3", "border": "#c08080", "text": "#a05555"},
        "chip": {"bg": "#f0f0f0", "text": "#1a1a1a"},
        "sections_numbering": False, "percent_chips": False, "prompt_lines": False,
        "light": True,
    },
    "magazine-warm": {
        "desc": "杂志暖调风：米白底、衬线大标题、朱红点缀，适合故事与随笔",
        "page_bg": "#faf7f2", "text": "#3a3a3a",
        "font": "Georgia,'Times New Roman','Songti SC','SimSun',serif",
        "accent": "#b3502e", "label_color": "#b3502e", "divider": "#ddd5c8",
        "heading_color": "#222222",
        "quote_default": {"bg": "#f3eee6", "border": "#c9bfa8", "text": "#5a5348"},
        "quote_accent":  {"bg": "#f5ece6", "border": "#b3502e", "text": "#8a4326"},
        "quote_warn":    {"bg": "#f5e6e6", "border": "#a05555", "text": "#8a3a3a"},
        "chip": {"bg": "#efe8dc", "text": "#b3502e"},
        "sections_numbering": False, "percent_chips": False, "prompt_lines": False,
        "light": True,
    },
    "academic-blue": {
        "desc": "学术规整风：白底、蓝色点缀、规整引用，适合科普与报告",
        "page_bg": "#ffffff", "text": "#333333",
        "font": "-apple-system,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif",
        "accent": "#2f5f9e", "label_color": "#2f5f9e", "divider": "#dcdfe4",
        "heading_color": "#1f3a5f",
        "quote_default": {"bg": "#f5f7fa", "border": "#b9c4d4", "text": "#4a5568"},
        "quote_accent":  {"bg": "#eef3fa", "border": "#2f5f9e", "text": "#2f5f9e"},
        "quote_warn":    {"bg": "#faf0f0", "border": "#a05555", "text": "#8a3a3a"},
        "chip": {"bg": "#e8eef7", "text": "#2f5f9e"},
        "sections_numbering": False, "percent_chips": False, "prompt_lines": False,
        "light": True,
    },
}

QUOTE_HINTS = {"[!accent]": "accent", "[!system]": "accent", "[!warn]": "warn", "[!red]": "warn"}
CJK = re.compile(r"[一-鿿]")


def list_styles():
    return [{"style": k, "desc": v["desc"]} for k, v in PRESETS.items()]


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def make_inline(p):
    chip = p["chip"]
    accent = p["accent"]

    def inline(t, strong_color=None, allow_chip=True):
        # 公众号正文按“链接不可依赖”处理：保留可读标题与地址，不生成 <a>。
        t = re.sub(
            r"\[([^\]]+)\]\((https?://[^)]+)\)",
            lambda m: f"{m.group(1)}（{m.group(2)}）",
            t,
        )
        t = esc(t)
        sc = strong_color or accent

        def bold_repl(m):
            inner = m.group(1)
            if allow_chip and p["percent_chips"] and chip:
                if re.fullmatch(r"\d+(?:\.\d+)?%(?:—\d+(?:\.\d+)?%)?。", inner):
                    return (f'<span style="font-family:inherit;background:{chip["bg"]};padding:2px 6px;'
                            f'border-radius:2px;color:{chip["text"]};font-weight:700;">{inner[:-1]}</span>。')
            return f'<strong style="color:{sc};">{inner}</strong>'

        t = re.sub(r"\*\*(.+?)\*\*", bold_repl, t)
        t = re.sub(r"`([^`]+)`",
                   lambda m: (f'<span style="font-family:inherit;background:{chip["bg"]};padding:2px 6px;'
                              f'border-radius:2px;color:{chip["text"]};">{m.group(1)}</span>') if chip
                   else f"<strong>{m.group(1)}</strong>", t)
        if allow_chip and p["percent_chips"] and chip:
            t = re.sub(r"(?<![\w.>%])(\d+(?:\.\d+)?%(?:—\d+(?:\.\d+)?%)?)",
                       (f'<span style="font-family:inherit;background:{chip["bg"]};padding:2px 6px;'
                        f'border-radius:2px;color:{chip["text"]};">\\1</span>'), t)
        return t
    return inline


def parse_blocks(md):
    """把 Markdown 切成稳定块，避免缺少空行时标题、引用和正文互相吞并。"""
    blocks = []
    paragraph = []
    quote_lines = []

    def flush_paragraph():
        if paragraph:
            blocks.append(("paragraph", paragraph[:]))
            paragraph.clear()

    def flush_quote():
        if quote_lines:
            blocks.append(("quote", quote_lines[:]))
            quote_lines.clear()

    for raw_line in md.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        stripped = line.strip()

        if not stripped:
            flush_quote()
            flush_paragraph()
            continue

        if line.lstrip().startswith(">"):
            flush_paragraph()
            quote_lines.append(line.lstrip()[1:].lstrip())
            continue

        flush_quote()

        if re.fullmatch(r"(\*\s*){3,}|(-\s*){3,}|(_\s*){3,}", stripped):
            flush_paragraph()
            blocks.append(("divider", stripped))
            continue

        if re.match(r"^#{1,3}\s+", stripped):
            flush_paragraph()
            blocks.append(("heading", stripped))
            continue

        if re.fullmatch(r"!\[[^\]]*\]\([^)]+\)", stripped):
            flush_paragraph()
            blocks.append(("image", stripped))
            continue

        list_match = re.match(r"^(?:[-+*]|\d+[.)])\s+(.+)$", stripped)
        if list_match:
            flush_paragraph()
            blocks.append(("list_item", list_match.group(1).strip()))
            continue

        paragraph.append(stripped)

    flush_quote()
    flush_paragraph()
    return blocks


def build(input_path, output_path, style="minimal-light", title=None, source=None):
    if style not in PRESETS:
        raise ValueError(f"Unknown style: {style}. Available: {', '.join(PRESETS)}")
    p = PRESETS[style]
    BG = p["page_bg"]
    inline = make_inline(p)

    with open(input_path, "r", encoding="utf-8") as f:
        md = f.read()

    blocks = parse_blocks(md.strip())
    out = []
    images = []
    sec_no = 0

    def divider():
        return (f'<section style="margin:0;padding:28px 16px;background:{BG};">'
                f'<section style="height:1px;background:{p["divider"]};"></section></section>')

    def sec_label(n):
        return (f'<section style="margin:0;padding:0 16px 20px;background:{BG};color:{p["label_color"]};'
                f'font-size:13px;">&gt; SECTION {n:02d}</section>')

    def para(text):
        return f'<p style="margin:0;padding:0 16px 0.9em;background-color:{BG};">{inline(text)}</p>'

    def heading(text, level):
        size = {1: "22px", 2: "18px", 3: "16px"}[level]
        pad_top = "24px" if level > 1 else "32px"
        return (f'<p style="margin:0;padding:{pad_top} 16px 12px;background-color:{BG};">'
                f'<span style="font-size:{size};font-weight:700;color:{p["heading_color"]};">{inline(text)}</span></p>')

    def quote(lines, kind):
        q = p["quote_default"] if kind == "default" else p["quote_" + kind]
        allow_chip = kind != "warn"
        sc = q["text"] if kind != "default" else None
        ps = []
        for i, ln in enumerate(lines):
            pad = "0 0 0.4em" if i < len(lines) - 1 else "0"
            ps.append(f'<p style="margin:0;padding:{pad};">{inline(ln, strong_color=sc, allow_chip=allow_chip)}</p>')
        return (f'<section style="margin:0;padding:0.9em 16px;background:{BG};">'
                f'<section style="margin:0;padding:12px 16px;background:{q["bg"]};'
                f'border-left:3px solid {q["border"]};color:{q["text"]};font-style:normal;">'
                + "".join(ps) + "</section></section>")

    def image_placeholder(src, alt):
        images.append({"src": src, "alt": alt or "image"})
        # 轻量单行标记：大块虚线框在编辑器里极易残留（真机教训），一行小字删除成本最低
        return (f'<p style="margin:0;padding:12px 16px;background-color:{BG};'
                f'color:{p["label_color"]};font-size:13px;">'
                f'【此处插入图片：{esc(alt) or "image"}，上传后删除本行】</p>')

    if p["sections_numbering"]:
        sec_no = 1
        out.append(sec_label(sec_no))
    for block_type, value in blocks:
        if block_type == "divider":
            out.append(divider())
            if p["sections_numbering"]:
                sec_no += 1
                out.append(sec_label(sec_no))
            continue
        if block_type == "quote":
            lines = value
            kind = "default"
            if lines:
                first = lines[0].strip()
                for hint, k in QUOTE_HINTS.items():
                    if first == hint:
                        kind = k
                        lines = lines[1:]
                        break
                    if first.startswith(hint + " "):
                        kind = k
                        lines[0] = first[len(hint):].strip()
                        break
            out.append(quote(lines, kind))
            continue
        if block_type == "image":
            m = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", value)
            if m:
                out.append(image_placeholder(m.group(2), m.group(1)))
            continue
        if block_type == "heading":
            m = re.match(r"^(#{1,3})\s+(.+)$", value)
            if m:
                out.append(heading(m.group(2).strip(), len(m.group(1))))
            continue
        if block_type == "list_item":
            out.append(
                f'<p style="margin:0;padding:0 16px 0.65em;background-color:{BG};">'
                f'<span style="color:{p["accent"]};font-weight:700;">•</span> {inline(value)}</p>'
            )
            continue

        lines = value
        joined = "".join(lines) if any(CJK.search(ln) for ln in lines) else " ".join(lines)
        out.append(para(joined))

    header = ""
    if title or source or p["prompt_lines"]:
        parts = [f'<section style="margin:0;padding:0 16px 24px;border-bottom:1px solid {p["divider"]};background:{BG};">']
        if p["prompt_lines"]:
            parts.append(f'<p style="margin:0;padding:0 0 8px;font-size:12px;color:{p["label_color"]};">'
                         f'root@memory-archive:~$ cat {esc(title or "article")}.log</p>')
        if title:
            parts.append(f'<p style="margin:0;padding:0;"><span style="font-size:26px;font-weight:700;'
                         f'color:{p["heading_color"]};letter-spacing:1px;">{esc(title)}</span></p>')
        if source:
            parts.append(f'<p style="margin:0;padding:8px 0 0;font-size:12px;color:#666;">{esc(source)}</p>')
        parts.append(f'</section><section style="height:8px;background:{BG};"></section>')
        header = "".join(parts)

    footer = ""
    if p["prompt_lines"]:
        footer = (f'<section style="height:32px;background:{BG};"></section>'
                  f'<section style="margin:0;padding:20px 16px 0;border-top:1px solid {p["divider"]};'
                  f'background:{BG};color:{p["label_color"]};font-size:12px;">'
                  f'root@memory-archive:~$ <span>_</span></section>')

    html = (
        "<section>"
        f'<section style="margin:0 -16px;padding:0;background:{BG};font-family:{p["font"]};'
        f'font-size:15px;line-height:1.75;color:{p["text"]};display:block;">'
        f'<section style="max-width:700px;margin:0 auto;background:{BG};">'
        f'<section style="height:32px;background:{BG};"></section>'
        + header + "\n".join(out) + footer
        + f'<section style="height:32px;background:{BG};"></section>'
        + "</section></section></section>"
    )
    output_dir = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_dir, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    return {"output": output_path, "style": style, "blocks": len(out),
            "sections": sec_no, "bytes": len(html.encode("utf-8")),
            "images": images}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input")
    ap.add_argument("--output")
    ap.add_argument("--style", default="minimal-light", choices=list(PRESETS))
    ap.add_argument("--title", default=None)
    ap.add_argument("--source", default=None)
    ap.add_argument("--list-styles", action="store_true")
    a = ap.parse_args()
    if a.list_styles:
        for s in list_styles():
            print(f'{s["style"]}: {s["desc"]}')
    else:
        print(build(a.input, a.output, a.style, a.title, a.source))
