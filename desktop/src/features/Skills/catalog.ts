export type SkillIconKind = "spreadsheet" | "pdf" | "word" | "presentation" | "markdown";

export type SkillPresentation = {
  id: string;
  icon: SkillIconKind;
};

/**
 * Frontend-only presentation overrides.
 *
 * Skill names, descriptions, source, category, files and content come from the
 * canonical /skills API. Keeping only visual hints here prevents the
 * desktop bundle from becoming a second Skill package truth source.
 */
export const skillPresentations: SkillPresentation[] = [
  { id: "xlsx", icon: "spreadsheet" },
  { id: "pdf", icon: "pdf" },
  { id: "docx", icon: "word" },
  { id: "pptx", icon: "presentation" },
];

export const getSkillPresentation = (id: string): SkillPresentation =>
  skillPresentations.find((skill) => skill.id === id) ?? { id, icon: "markdown" };
