export type SkillExecutionContextMode = "inline" | "fork";
export type SkillPackageOrigin = "built-in" | "user" | "external";

/**
 * Declarative execution requirements carried by a Skill package.
 *
 * This is not a permission grant. `allowedTools` and `runtimeBindings` describe
 * what the Skill expects; the subAgent runtime still reconciles them against
 * the currently registered Harness capabilities, runtime availability, Policy,
 * approval and workspace boundaries.
 */
export type SkillExecutionManifest = {
  context: SkillExecutionContextMode;
  /** Optional named execution profile. Runtime always normalizes the actual
   * worker to one product-level subAgent for the active Skill. */
  agent?: string;
  allowedTools: string[];
  runtimeBindings: string[];
  workspaceBound?: boolean;
};

export type SkillManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  entry: string;
  /** Optional only for legacy in-memory fixtures; scanner output always sets it. */
  origin?: SkillPackageOrigin;
  source?: string;
  category?: string;
  license?: string;
  runtimeRequirements?: string[];
  /** Optional only for legacy in-memory fixtures; scanner output always sets it. */
  execution?: SkillExecutionManifest;
};

export type SkillContent = {
  manifest: SkillManifest;
  body: string;
};

export type SkillResourceKind = "reference" | "template" | "example" | "script";

export type SkillResource = {
  uri: string;
  skillId: string;
  name: string;
  kind: SkillResourceKind;
  description?: string;
};

export type LoadedSkillResource = SkillResource & {
  content: string;
};

export type SkillMatchSource =
  | "explicit"
  | "resource"
  | "exact"
  | "semantic"
  | "embedding"
  | "continuation";

export type SkillMatchCandidate = {
  skillId: string;
  score: number;
  reason: string;
  source: SkillMatchSource;
};

export type SkillMatchResult = {
  primary: SkillMatchCandidate | null;
  secondary: SkillMatchCandidate[];
};

export type SkillDisclosurePlan = {
  primarySkillId?: string;
  includeBody: boolean;
  availableResources: SkillResource[];
  disclosedResourceUris: string[];
};

export type SkillContext = {
  instruction: string;
  primary?: {
    id: string;
    version: string;
    name: string;
    body: string;
    /** Optional only for legacy persisted messages and test fixtures. */
    origin?: SkillPackageOrigin;
    /** Optional only for legacy persisted messages and test fixtures. */
    execution?: SkillExecutionManifest;
  };
  resources: SkillResource[];
  disclosedResources: Array<{
    uri: string;
    content: string;
  }>;
  /**
   * Optional progressive Tool disclosure for a forked execution. When present,
   * only these exact-known Tool ids are presented to the subAgent model with
   * their full input schema; the remaining allowed Tools stay at the compact
   * metadata stage. Absent means the Skill did not request progressive
   * disclosure and every allowed Tool is schema-disclosed.
   */
  disclosedTools?: string[];
  match?: {
    source: SkillMatchSource;
    reason: string;
    score: number;
    secondarySkillIds: string[];
  };
};
