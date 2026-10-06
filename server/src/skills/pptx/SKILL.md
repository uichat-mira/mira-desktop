---
name: pptx
description: "Create editable PowerPoint presentations with WenShu through Kimi's native multi-file PPTD DSL, strict protocol checking, and deterministic rendering."
---

# Core route

The domain capability is:

```text
office_presentation
```

Do not expose `add_slide`, `add_text`, raw OOXML, `python-pptx`, or renderer primitives as the presentation method. The Agent produces a complete Kimi PPTD project; WenShu checks and renders it.

SkillContext does not expand canonical ToolExposure. The Skill runtime owns execution through the internal WenShu Python invocation contract. The Agent may materialize the native PPTD project with the exposed file capability, but it must never invoke Python, `kimi_ppt_dsl`, or a renderer through `terminal`.

The internal invocation contains only:

```json
{
  "runtime": "wenshu-office",
  "script": "pptx/pptx_runtime.py",
  "args": ["validate|create|inspect", "...runtime-owned arguments"]
}
```

Do not provide a Python executable, `PYTHONPATH`, shell command, `python -m`, or package-install command. The WenShu launcher selects Mira's system development Python, injects the managed Runtime Pack, resolves the bundled script, and reports deterministic success or failure.

# Progressive disclosure

Do not load every reference into context at once. Read the smallest resource needed for the current stage:

- `skill://pptx/references/minimal-deck.json` — read for the first native deck, after a schema failure, or when a compact known-good project is needed.
- `skill://pptx/references/pptd-project-contract.md` — read when constructing `entry`, `pageFiles`, theme, paths, fills, bounds, or text alignment.
- `skill://pptx/references/element-cookbook.md` — read only when exact rich-text, shape, image, icon, table, or chart fields are needed.
- `skill://pptx/references/validation-and-repair.md` — read after checker errors or meaningful warnings.

References are L2 context resources, not new tools. Reading one does not alter ToolExposure or create a hidden Skill loop. Continue through the normal Parent Agent cycle:

```text
Planner → tool call → Evidence → Planner
```

A normal PPT task may involve several internal interactions while constructing and validating the protocol input. Once a valid project is passed to `create`, renderer success or renderer failure is authoritative. Do not ask a model to reinterpret the produced PPTX as a completion gate.

# Required project contract

`spec` uses the native multi-file form:

```json
{
  "entry": {
    "title": "Presentation title",
    "size": [1280, 720],
    "theme": {
      "colors": {},
      "textStyles": {},
      "tableStyles": {}
    },
    "pages": ["pages/01.page"]
  },
  "pageFiles": {
    "pages/01.page": {
      "pageType": "content",
      "background": { "type": "solid", "color": "#FFFFFF" },
      "elements": []
    }
  }
}
```

Rules:

- `entry.pages` contains relative `.page` paths only.
- Every referenced path exists exactly once in `pageFiles`.
- Do not put inline page objects in `entry.pages`.
- Do not invent another JSON AST or translate this contract into a custom renderer format.
- Coordinates use Kimi canvas units and every positioned element uses `bounds: [x, y, width, height]`.
- Element array order is z-order; later elements appear above earlier elements.

# Text contract — mandatory

Text must be placed in `content.text`. Never put text directly on the element and never omit `content`.

```json
{
  "elementType": "text",
  "elementId": "slide-title",
  "bounds": [80, 64, 1120, 96],
  "content": {
    "text": "真实写入 PowerPoint 的标题",
    "style": "$title",
    "fontSize": 38,
    "color": "#1F2937",
    "align": ["left", "middle"]
  }
}
```

`align` is `[horizontal, vertical]`, not an object.

`content.text` may contain Kimi-supported lightweight rich text. Theme style references such as `$title` and `$body` are preferred for consistency.

# Supported elements

Use Kimi's original element fields:

- `text`: `content.text`, style, font, alignment, gradient and shadow;
- `shape`: `shapeName`, fill, border, shadow and optional arrows;
- `image`: `src`, fit, crop, border and shadow;
- `icon`: `iconName`, fill, border and shadow;
- `table`: rows, cells, column widths, row heights and table style;
- `chart`: type, data, x/y fields, axes, legend, labels and series styles.

Image sources must resolve to real files inside the selected workspace before rendering. Do not send data URIs to the current renderer. Fonts are not embedded by WenShu; use common system font families and allow PowerPoint fallback. The bundled runtime keeps Kimi's lightweight icon renderer but does not ship a large font or stock-image library.

# Workflow

1. Understand goal, audience, slide count and content hierarchy.
2. Design the complete deck structure and theme first.
3. Read only the required L2 references.
4. Produce the complete `entry + pageFiles` project.
5. Run `operation=validate` when protocol validation is needed before creation.
6. Repair every blocking protocol error and review meaningful warnings.
7. Run `operation=create` with the valid project.
8. Treat deterministic renderer success as success and renderer failure as failure.
9. Use `operation=inspect` only when the user explicitly requests inspection or for diagnostics/development testing; it is not a completion gate.
10. Deliver the `.pptx` artifact, not only the intermediate spec/project files.

For long decks, prepare all page files before creating. Do not validate and deliver one slide at a time.

# Hard rules

1. Kimi's checker/parser/renderer are the source of truth; do not bypass them.
2. Do not use an LLM or semantic readback to decide whether deterministic renderer output counts as success.
3. If a legal protocol input cannot be rendered faithfully, fix the protocol/checker/renderer contract; do not add a model fallback.
4. Unsupported inputs must be rejected explicitly rather than silently replaced, ignored, or guessed.
5. Keep native text, shapes, tables and charts editable whenever supported.
6. Do not claim arbitrary lossless editing of an existing complex PPTX.
7. `write` may persist project/spec files, but it is not the presentation renderer.
8. `terminal` must not invoke Python or the bundled runtime. Only the internal WenShu Runtime invocation may execute `pptx/pptx_runtime.py`.

# Completion

A PPT creation task is complete when:

- the input satisfies the PPTD protocol and checker contract;
- the deterministic renderer completes successfully;
- the `.pptx` artifact is written successfully;
- the final artifact is returned to the user.

`inspect` is an explicit diagnostic capability, not a mandatory post-render verification step.
