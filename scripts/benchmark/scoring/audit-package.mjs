#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { findSecrets } from "../recorder/lib/sanitize.mjs";

const argv = process.argv.slice(2);
const at = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const report = at("--report");
const output = at("--out");
if (!report) throw new Error("--report is required");
const root = path.resolve(report);

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const manifest = read(path.join(root, "manifest.json"));
const findings = [];
const packages = [];

const walk = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile()) out.push(p);
  }
  return out;
};

for (const file of walk(root)) {
  if (file === path.resolve(output ?? "")) continue;
  const bytes = fs.readFileSync(file);
  const hits = findSecrets(bytes.toString("utf8"));
  if (hits.length) findings.push({ type: "secret", path: path.relative(root, file), hits });
}

for (const c of manifest.cases ?? []) {
  const caseFile = path.join(root, "cases", c.caseId, "case.json");
  if (!fs.existsSync(caseFile)) findings.push({ type: "identity", caseId: c.caseId, error: "missing case.json" });
  for (const rep of c.repetitions ?? []) {
    const repRoot = path.join(root, "cases", c.caseId, "repetitions", String(rep));
    const required = ["execution.json", "trajectory.jsonl", "result.json", "judge-input.json"];
    const missing = required.filter((f) => !fs.existsSync(path.join(repRoot, f)));
    if (missing.length) {
      findings.push({ type: "identity", caseId: c.caseId, repetition: rep, error: "missing repetition files", missing });
      continue;
    }
    const caseDoc = read(caseFile);
    const execution = read(path.join(repRoot, "execution.json"));
    const result = read(path.join(repRoot, "result.json"));
    const judgeInput = read(path.join(repRoot, "judge-input.json"));
    const errors = [];
    if (caseDoc.id !== c.caseId) errors.push("case.json id mismatch");
    if (execution?.benchmark?.caseId !== c.caseId) errors.push("execution caseId mismatch");
    if (execution?.benchmark?.repetitionIndex !== rep) errors.push("execution repetition mismatch");
    if (execution?.benchmark?.caseSetVersion !== manifest?.benchmark?.caseSetVersion) errors.push("case-set version mismatch");
    if (execution?.mira?.commit !== manifest?.benchmark?.miraCommit) errors.push("Mira commit mismatch");
    if (judgeInput?.case?.contract?.id !== c.caseId) errors.push("judge-input case mismatch");
    if (result?.judge?.semanticResults !== null) errors.push("pre-Judge result unexpectedly contains semanticResults");
    const judgeCriteria = judgeInput?.semanticCriteria?.criteria ?? [];
    if (judgeCriteria.some((x) => x.scorer !== "judge")) errors.push("judge-input exposes non-judge criterion");

    let judgePackagePath = null;
    if (judgeCriteria.length > 0) {
      const judgeRoot = path.join(root, "judge-packages", c.caseId, `rep-${rep}`);
      const judgeRequired = ["case.json", "execution.json", "trajectory.jsonl", "result.json", "judge-input.json"];
      const judgeMissing = judgeRequired.filter((f) => !fs.existsSync(path.join(judgeRoot, f)));
      if (judgeMissing.length) {
        errors.push(`judge transport package missing: ${judgeMissing.join(", ")}`);
      } else {
        const canonical = {
          "case.json": caseFile,
          "execution.json": path.join(repRoot, "execution.json"),
          "trajectory.jsonl": path.join(repRoot, "trajectory.jsonl"),
          "result.json": path.join(repRoot, "result.json"),
          "judge-input.json": path.join(repRoot, "judge-input.json"),
        };
        for (const name of judgeRequired) {
          if (!fs.readFileSync(canonical[name]).equals(fs.readFileSync(path.join(judgeRoot, name)))) {
            errors.push(`judge transport package differs from canonical ${name}`);
          }
        }
      }
      judgePackagePath = path.relative(root, judgeRoot).split(path.sep).join("/");
    }

    if (errors.length) findings.push({ type: "identity", caseId: c.caseId, repetition: rep, errors });
    packages.push({
      caseId: c.caseId,
      repetition: rep,
      path: path.relative(root, repRoot).split(path.sep).join("/"),
      judgePackagePath,
      semanticCriterionIds: judgeCriteria.map((x) => x.id),
      identityOk: errors.length === 0,
    });
  }
}

const audit = {
  schemaVersion: "mira-agent-core-benchmark-package-audit/0.1",
  auditedAt: new Date().toISOString(),
  reportRoot: path.basename(root),
  benchmark: {
    caseSetVersion: manifest?.benchmark?.caseSetVersion ?? null,
    miraCommit: manifest?.benchmark?.miraCommit ?? null,
    miraVersion: manifest?.benchmark?.miraVersion ?? null,
    modelProvider: manifest?.benchmark?.modelProvider ?? null,
    modelId: manifest?.benchmark?.modelId ?? null,
    hostOs: manifest?.benchmark?.hostOs ?? null,
    hostArch: manifest?.benchmark?.hostArch ?? null,
  },
  packageCount: packages.length,
  packages,
  secretAudit: {
    ok: findings.every((x) => x.type !== "secret"),
    findings: findings.filter((x) => x.type === "secret"),
  },
  identityAudit: {
    ok: findings.every((x) => x.type !== "identity"),
    findings: findings.filter((x) => x.type === "identity"),
  },
  publishable: findings.length === 0,
};

const rendered = JSON.stringify(audit, null, 2) + "\n";
if (output) {
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), rendered);
}
process.stdout.write(rendered);
if (!audit.publishable) process.exitCode = 2;
