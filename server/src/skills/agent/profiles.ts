import type { SkillContext, SkillExecutionManifest } from "@/skills/context/types.js";
import type {
  SkillAgentExecutionProfile,
  SkillAgentRuntimeBinding,
  SubAgentExecutionProfile,
} from "./types.js";

const KNOWN_PRIVATE_RUNTIME_BINDINGS: Record<string, SkillAgentRuntimeBinding> = {
  office_document: {
    id: "office_document",
    kind: "skill-private-runtime",
    status: "ready",
    description: "DOCX domain runtime private to the active document Skill subAgent.",
  },
  office_pdf: {
    id: "office_pdf",
    kind: "skill-private-runtime",
    status: "ready",
    description: "PDF domain runtime private to the active PDF Skill subAgent.",
  },
  office_presentation: {
    id: "office_presentation",
    kind: "skill-private-runtime",
    status: "ready",
    description: "Presentation domain runtime private to the active PPTX Skill subAgent.",
  },
  office_spreadsheet: {
    id: "office_spreadsheet",
    kind: "skill-private-runtime",
    status: "ready",
    description: "Spreadsheet inspect/recalc/verify runtime private to the active XLSX Skill subAgent.",
  },
  wenshu_xlsx_xml_runtime: {
    id: "wenshu_xlsx_xml_runtime",
    kind: "skill-private-runtime",
    status: "pending",
    description:
      "XML-first create/edit execution bridge; unavailable until a managed private runtime binding is registered.",
  },
};

const LEGACY_OFFICE_EXECUTION: Record<string, SkillExecutionManifest> = {
  docx: {
    context: "fork",
    agent: "subAgent",
    allowedTools: ["read_open", "read_extract"],
    runtimeBindings: ["office_document"],
    workspaceBound: true,
  },
  pdf: {
    context: "fork",
    agent: "subAgent",
    allowedTools: ["read_open", "read_extract"],
    runtimeBindings: ["office_pdf"],
    workspaceBound: true,
  },
  pptx: {
    context: "fork",
    agent: "subAgent",
    allowedTools: ["read_open", "read_extract"],
    runtimeBindings: ["office_presentation"],
    workspaceBound: true,
  },
  xlsx: {
    context: "fork",
    agent: "subAgent",
    allowedTools: ["read_open", "read_extract"],
    runtimeBindings: ["office_spreadsheet", "wenshu_xlsx_xml_runtime"],
    workspaceBound: true,
  },
};

const DEFAULT_EXECUTION: SkillExecutionManifest = {
  context: "fork",
  agent: "subAgent",
  allowedTools: [],
  runtimeBindings: [],
  workspaceBound: false,
};

type PrimarySkill = NonNullable<SkillContext["primary"]>;
type ProfileSource = string | Pick<PrimarySkill, "id" | "execution">;

const unique = (values: string[]) => [...new Set(values)];

const toRuntimeBinding = (runtimeId: string): SkillAgentRuntimeBinding => {
  const known = KNOWN_PRIVATE_RUNTIME_BINDINGS[runtimeId];
  if (known) return { ...known };
  return {
    id: runtimeId,
    kind: "skill-private-runtime",
    status: "pending",
    description:
      "Declared private runtime requirement; unavailable until a governed runtime adapter is registered.",
  };
};

const cloneExecution = (execution: SkillExecutionManifest): SkillExecutionManifest => ({
  ...execution,
  context: "fork",
  agent: "subAgent",
  allowedTools: [...execution.allowedTools],
  runtimeBindings: [...execution.runtimeBindings],
  workspaceBound: execution.workspaceBound ?? false,
});

const resolveExecution = (input: {
  skillId: string;
  declared?: SkillExecutionManifest;
}) => {
  const compatibility = LEGACY_OFFICE_EXECUTION[input.skillId];
  if (!input.declared) {
    return cloneExecution(compatibility ?? DEFAULT_EXECUTION);
  }
  if (!compatibility) {
    return cloneExecution(input.declared);
  }

  // Office package discovery can derive the private runtime from the built-in
  // Registry, while the historic read-only Harness surface is intentionally not
  // duplicated there. Merge the minimum compatibility requirements so moving
  // from a hard-coded profile to a discovered manifest cannot reduce capability.
  return cloneExecution({
    ...input.declared,
    allowedTools: unique([
      ...compatibility.allowedTools,
      ...input.declared.allowedTools,
    ]),
    runtimeBindings: unique([
      ...compatibility.runtimeBindings,
      ...input.declared.runtimeBindings,
    ]),
    workspaceBound:
      Boolean(compatibility.workspaceBound) || Boolean(input.declared.workspaceBound),
  });
};

/**
 * Resolve the single logical subAgent profile for any discovered Skill.
 *
 * A profile is a requirement envelope, never a permission grant. Harness and
 * private-runtime adapters still decide what is actually registered, healthy,
 * authorized and approved for this run.
 */
export const resolveSubAgentExecutionProfile = (
  source: ProfileSource,
): SubAgentExecutionProfile => {
  const skillId = typeof source === "string" ? source : source.id;
  const declared = typeof source === "string" ? undefined : source.execution;
  const execution = resolveExecution({ skillId, declared });

  return {
    skillId,
    mode: "forked-agent",
    engine: "pi-agent-core",
    allowedHarnessToolIds: [...execution.allowedTools],
    runtimeBindings: execution.runtimeBindings.map(toRuntimeBinding),
    workspaceBound: execution.workspaceBound ?? false,
  };
};

/** Compatibility entry for older callers; unlike the old implementation it
 * returns a profile for every Skill id instead of only four WenShu ids. */
export const getSkillAgentExecutionProfile = (
  source: ProfileSource,
): SkillAgentExecutionProfile => resolveSubAgentExecutionProfile(source);

export const listSubAgentExecutionProfiles = (
  skills: Array<Pick<PrimarySkill, "id" | "execution">>,
) => skills.map((skill) => resolveSubAgentExecutionProfile(skill));

// Temporary compatibility aliases for existing smoke/tests. These names no
// longer define the execution boundary and may be removed after migration.
export type WenShuPiSkillId = keyof typeof LEGACY_OFFICE_EXECUTION;
export const isWenShuPiSkillPilot = (skillId: string) =>
  Boolean(LEGACY_OFFICE_EXECUTION[skillId]);
export const listWenShuPiSkillProfiles = () =>
  Object.keys(LEGACY_OFFICE_EXECUTION).map((skillId) =>
    resolveSubAgentExecutionProfile(skillId),
  );
