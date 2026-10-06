---
name: pdf
description: "Create and process PDF files through Mira WenShu. Supports professional ReportLab documents with TOC/tables/images/charts/equations/code/header-footer, Markdown conversion, extraction, forms, merge/split/rotate/crop, and metadata operations."
---

# Routing

## Route A — Create a new PDF
Use `office_pdf` with `operation=create` and a structured `spec`.

This is the default creation route. Do not mechanically route PDF creation through Markdown when the user actually wants a designed report/document.

The spec supports:
- cover metadata: `title`, `subtitle`, `author`, `date`, `subject`;
- `pageSize`: `A4` or `LETTER`;
- `orientation`: `portrait` or `landscape`;
- `margins` and named `styles`;
- optional dynamic `toc` generated from heading blocks;
- `header`, `footer`, `pageNumbers`, `skipFirstHeaderFooter`;
- content blocks:
  - `heading1`, `heading2`, `heading3`;
  - `paragraph`, `caption`, `reference`;
  - `table`;
  - `image` using a workspace-relative source path;
  - `chart` (`bar`, `line`, `pie`) with categories/series;
  - `equation` rendered from matplotlib mathtext;
  - `code`;
  - `spacer`, `pageBreak`;
- `references[]` with text/title and optional real URL.

For creation, `spec.title` and a non-empty `spec.blocks[]` are mandatory. A report must never be represented only by cover metadata. Use this canonical shape:

```json
{
  "operation": "create",
  "outputPath": "report.pdf",
  "spec": {
    "title": "报告标题",
    "pageSize": "A4",
    "orientation": "portrait",
    "blocks": [
      { "type": "heading1", "text": "测试目标" },
      { "type": "paragraph", "text": "正文内容。" },
      { "type": "heading1", "text": "验证结果" },
      {
        "type": "table",
        "caption": "验证表",
        "header": true,
        "rows": [
          ["检查项", "状态"],
          ["Skill 命中", "通过"],
          ["Artifact 生成", "通过"]
        ]
      }
    ]
  }
}
```

Text blocks use `text`. Table blocks use a non-empty two-dimensional `rows` array; do not use `data`, `columns`, or a top-level `table` field. Content that is not placed in `spec.blocks` will not appear in the PDF body.

Content quality, facts, outline and citations must be prepared before calling the deterministic runtime. Do not fabricate sources.

For long reports, build the outline first, then write the full document against that outline. If a target length/page count is explicit, validate the finished artifact instead of guessing from source text length.

# TOC layout contract

When a report needs a table of contents, use the runtime-native `spec.toc` generated from `heading1` / `heading2` / `heading3` blocks.

Canonical input:

```json
{
  "toc": {
    "title": "报告目录"
  }
}
```

The TOC is a document-navigation structure, not a normal content table.

Hard layout rules:

1. Never synthesize a TOC with a `table` block.
2. Never build a four-column or two-column TOC such as `标题 | 点线页码 | 标题 | 点线页码`.
3. Never insert manual dot leaders or guessed page numbers into paragraph/table text.
4. Use a single-column TOC: title on the left, runtime-generated leader/page number on the right.
5. Chinese section titles must remain horizontal. They may wrap naturally to a second line, but must never collapse to one character per line.
6. If a heading is too long for two readable lines, shorten the heading text; keep the full wording in the section body.
7. A long TOC may continue onto another page. Do not compress it into multiple columns merely to keep it on one page.
8. Do not put line breaks inside heading text to force a visual layout. Heading text is also used for PDF bookmarks and TOC entries.
9. Rendered TOC quality must be inspected before completion. Any character-by-character vertical wrapping, overlapping leader/page number, clipped title, or unreadable indentation is a generation failure.

For exact failure examples and acceptance checks, read:

```text
skill://pdf/references/toc-layout.md
```

## Route B — Convert Markdown
Use `operation=md2pdf` when the real source is an existing Markdown artifact and conversion is desired.

Do not use this route merely because Markdown is convenient. The structured ReportLab route has richer layout, TOC, charts/equations and page-level control.

## Route C — Process existing PDF
Supported operations:
- `extract_text`
- `extract_tables`
- `extract_images`
- `form_info`
- `form_fill`
- `merge`
- `split`
- `rotate`
- `crop`
- `meta_get`
- `meta_set`

# Execution contract

Primary capability:

```text
office_pdf
```

Python-backed PDF operations are internal WenShu Runtime invocations. The Agent provides only the operation-level input (operation, workspace input/output paths, and structured spec/data); it must not provide a Python executable, `PYTHONPATH`, shell command, `python -m`, or package-install command. The internal launcher selects `wenshu-office`, resolves `pdf/pdf_create_runtime.py` or `pdf/pdf_runtime.py`, injects the managed Runtime Pack, and owns the deterministic result.

Page selections are 1-based, e.g. `1,3-5`.
Crop boxes use PDF point coordinates `[x0,y0,x1,y1]`.
Merge uses `inputPaths[]`.
Split/image extraction use an `outputDir` and may produce multiple artifacts.

# Quality rules

- Match the language requested by the user.
- Keep a readable hierarchy of title/headings/body/captions/references.
- Use charts only when they clarify real data; do not invent numbers to decorate a report.
- Tables should remain readable rather than cramming excessive columns into one page.
- References/citations must be real and verifiable when the task requires sourced factual content.
- For image blocks, source assets must remain inside the active workspace.
- A generated TOC must remain single-column, horizontally readable, correctly indented and page-number aligned.

# Hard rules

1. Never edit PDF bytes with `edit_file` or arbitrary binary replacement.
2. Preserve the source PDF for transformations; write a distinct output artifact by default.
3. Use the public Read surface to inspect context when needed, but use `office_pdf` for PDF-specific processing.
4. Do not claim generation/processing succeeded until accepted Evidence confirms the output/result.
5. Generated factual reports must use real, verifiable information and citations when citations are required.
6. Match the user's requested language, outline and document structure.
7. Do not silently use lossy conversion when a native PDF operation exists.
8. Do not use `terminal` to invoke any PDF Python script.
9. Never use a content `table` to imitate a table of contents; use `spec.toc`.

# Completion

A PDF task is complete only when all applicable conditions hold:
- requested extraction/inspection result exists in Evidence;
- generated or modified artifact exists and is readable;
- requested headings/tables/charts/equations/references or other document structure exist in generated reports;
- any requested TOC is single-column, horizontally readable, aligned and generated from actual headings;
- requested page/form/metadata operation is reflected in the result;
- multi-output operations report their output directory/file count;
- source files remain preserved unless the user explicitly requested otherwise.