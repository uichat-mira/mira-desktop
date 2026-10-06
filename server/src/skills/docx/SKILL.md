---
name: docx
description: "Create and review Word documents (.docx) through Mira WenShu. Covers structured DOCX creation, native comments, tracked changes, non-destructive review copies, and safe format-preserving routing boundaries."
---

# Package status

This directory is the bundled DOCX **Skill Package** for WenShu.

It ships with Mira and does not require the optional `wenshu-office` Python Runtime Pack.

Current execution is provided by WenShu's deterministic Office Domain Runtime. The package itself is **not** an active `SkillInstance`, and installing/shipping it does not imply formal Agent Skill Runtime integration.

DOCX currently has no Python Runtime Pack dependency. Its Node/OOXML domain runtime is the only execution path. Do not introduce a Python command, `PYTHONPATH`, package installation, or `terminal` workaround for DOCX.

Formal Agent integration remains deferred until the Skill Runtime contract provides versioned `SkillDefinition`, active `SkillInstance`, state/stage, Evidence-driven reducer, stage-specific tool constraints, and completion evaluation.

# Part 1: Routing semantics

These rules describe the business method that a future formal DOCX Skill Runtime should enforce and the MicroAPP can already use for deterministic execution.

## Route A — Existing DOCX whose formatting matters

Use the existing `.docx` as the document foundation and preserve it by default.

Supported deterministic review semantics:

- native Word comments anchored to exact visible text;
- suggested replacements represented as Track Changes deletion + insertion;
- non-destructive output to a new `.docx` copy.

Do not use plain-text editing, arbitrary ZIP surgery, or blind XML replacement on DOCX binaries.

Current safe editing boundary: review anchors must resolve to exact visible text in a simple Word text run. If the runtime refuses a complex run, do not force a lossy rewrite.

## Route B — DOCX used only as a content source

If the `.docx` is only reference material and formatting does not matter, reading/extraction should remain a separate concern. Do not create a modified DOCX artifact unless the task actually requests one.

## Route C — Create a new DOCX

The deterministic WenShu runtime supports structured creation with:

- title;
- paragraphs using semantic styles (`title`, `heading1`, `heading2`, `heading3`, `body`);
- bold text at the current paragraph-run level;
- simple tables expressed as rows and cells;
- native `.docx` output.

# Part 2: Current deterministic runtime

The current implementation is anchored in:

```text
server/src/microapps/office-suite/
  create.ts
  document-review.ts
  document.ts
  runtime.ts
  contract.ts
```

Capabilities include:

- `docx@9` structured DOCX creation;
- Office package inspection and artifact handling;
- native `comments.xml` creation and relationship/content-type wiring;
- comment range/reference anchors;
- `w:trackRevisions` enablement;
- tracked insertion/deletion through `w:ins`, `w:del`, and `w:delText`;
- non-destructive output copies;
- refusal of unsafe complex-run rewrites.

A task-level `office_document` implementation exists in the codebase, but this Skill Package does not automatically register, expose, or inject it as part of a formal Skill Runtime lifecycle.

# Hard Rules

1. Never overwrite the source DOCX during review unless a future explicit contract says otherwise.
2. Never use text-file editing tools on a DOCX binary.
3. Do not force lossy rewrites when the exact edit target cannot be localized safely.
4. Keep large document bytes out of semantic Skill state; use file/artifact references at the runtime boundary.
5. Do not claim arbitrary lossless Word editing beyond the current deterministic contract.
6. Package presence does not equal Agent Skill activation.
7. Formal Skill integration must only narrow Harness-eligible tools through stage-specific constraints; it must never expand canonical `toolExposure` merely because DOCX was selected.

# Quality Standard

A completed deterministic DOCX operation should satisfy all applicable checks:

- the requested output file exists;
- the document is readable by a normal DOCX consumer / Mira verification path;
- requested content is present;
- review tasks preserve the source file and create a distinct output;
- comments/revisions use native Word structures when those semantics are requested;
- unsupported complex edits fail explicitly instead of silently degrading the document.

For the exact runtime surface and current boundaries, read `references/office-runtime-reference.md`.
