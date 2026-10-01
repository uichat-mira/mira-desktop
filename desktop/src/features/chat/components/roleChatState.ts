import type { KnowledgeBaseSummary } from "@/shared/api/knowledgeBase";
import type { RoleSummary } from "@/shared/api/roles";
import type { BuiltinAvatarOption } from "@/shared/avatars";
import type { ChatThreadContextTag } from "@/shared/uchat/core";

export type ChatMediaSettings = {
  ttsEnabled: boolean;
  imageEnabled: boolean;
};

export const resolveChatMediaSettings = ({
  hasPersistedThread,
  persistedSettings,
  welcomeSettings,
  hasRole,
  hasKnowledgeBase,
}: {
  hasPersistedThread: boolean;
  persistedSettings?: Partial<ChatMediaSettings>;
  welcomeSettings: ChatMediaSettings;
  hasRole: boolean;
  hasKnowledgeBase: boolean;
}): ChatMediaSettings => ({
  ttsEnabled: hasPersistedThread
    ? persistedSettings?.ttsEnabled === true
    : welcomeSettings.ttsEnabled,
  imageEnabled: hasPersistedThread
    ? persistedSettings?.imageEnabled ?? (hasRole && !hasKnowledgeBase)
    : welcomeSettings.imageEnabled,
});

export const shouldShowRoleImageAction = ({
  roleId,
  knowledgeBaseId,
}: {
  roleId: string | null;
  knowledgeBaseId: string | null;
}) => Boolean(roleId && !knowledgeBaseId);

export const resolveActiveRoleId = ({
  hasPersistedThread,
  persistedRoleId,
  welcomeRoleId,
}: {
  hasPersistedThread: boolean;
  persistedRoleId: string | null | undefined;
  welcomeRoleId: string | null;
}) => {
  if (hasPersistedThread) {
    return persistedRoleId ?? null;
  }

  return persistedRoleId ?? welcomeRoleId;
};

export const resolveRoleAvatarSrc = (
  avatarId: string | null,
  avatarOptions: BuiltinAvatarOption[],
) =>
  avatarId
    ? avatarOptions.find((option) => option.id === avatarId)?.src ?? null
    : null;

export const upsertRoleSummary = (
  roles: RoleSummary[],
  nextRole: RoleSummary,
): RoleSummary[] => {
  const existingIndex = roles.findIndex((role) => role.id === nextRole.id);
  if (existingIndex < 0) {
    return [nextRole, ...roles];
  }

  const nextRoles = [...roles];
  nextRoles[existingIndex] = nextRole;
  return nextRoles;
};

export const buildThreadContextTags = ({
  knowledgeBase,
  role,
  roleAvatarSrc,
}: {
  knowledgeBase: KnowledgeBaseSummary | null;
  role: RoleSummary | null;
  roleAvatarSrc: string | null;
}): ChatThreadContextTag[] => {
  const tags: ChatThreadContextTag[] = [];

  if (role) {
    tags.push({
      id: `role:${role.id}`,
      kind: "role",
      label: role.name,
      tooltip: role.summary || role.name,
      removable: true,
      avatarSrc: roleAvatarSrc ?? undefined,
    });
  }

  if (knowledgeBase) {
    tags.push({
      id: `knowledge-base:${knowledgeBase.id}`,
      kind: "knowledge-base",
      label: knowledgeBase.name,
      tooltip: `${knowledgeBase.name} (${knowledgeBase.enabledDocumentCount} enabled documents)`,
      removable: true,
    });
  }

  return tags;
};

export const formatRoleReplyingLabel = (
  roleName: string | null,
  defaultLabel: string,
  suffix: string,
) => (roleName ? `${roleName}${suffix}` : defaultLabel);
