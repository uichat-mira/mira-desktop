import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildThreadContextTags,
  formatRoleReplyingLabel,
  resolveActiveRoleId,
  resolveChatMediaSettings,
  resolveRoleAvatarSrc,
  shouldShowRoleImageAction,
  upsertRoleSummary,
} from "./roleChatState";

test("Role image action is available for Agent conversations when no Knowledge Base is bound", () => {
  assert.equal(
    shouldShowRoleImageAction({
      roleId: "role-1",
      knowledgeBaseId: null,
    }),
    true,
  );
});

test("Role image action stays hidden when a Knowledge Base is bound", () => {
  assert.equal(
    shouldShowRoleImageAction({
      roleId: "role-1",
      knowledgeBaseId: "kb-1",
    }),
    false,
  );
});

test("resolveChatMediaSettings keeps persisted image state when RAG hides the control", () => {
  assert.deepEqual(resolveChatMediaSettings({
    hasPersistedThread: true,
    persistedSettings: { imageEnabled: true, ttsEnabled: true },
    welcomeSettings: { imageEnabled: false, ttsEnabled: false },
    hasRole: true,
    hasKnowledgeBase: true,
  }), { imageEnabled: true, ttsEnabled: true });
});

test("resolveChatMediaSettings defaults welcome RP image generation on", () => {
  assert.equal(resolveChatMediaSettings({
    hasPersistedThread: false,
    welcomeSettings: { imageEnabled: true, ttsEnabled: false },
    hasRole: true,
    hasKnowledgeBase: false,
  }).imageEnabled, true);
});

test("resolveActiveRoleId prefers the persisted thread role over the welcome draft", () => {
  const roleId = resolveActiveRoleId({
    hasPersistedThread: true,
    persistedRoleId: "role-thread",
    welcomeRoleId: "role-welcome",
  });

  assert.equal(roleId, "role-thread");
});

test("resolveActiveRoleId falls back to the welcome draft role before the first thread exists", () => {
  const roleId = resolveActiveRoleId({
    hasPersistedThread: false,
    persistedRoleId: null,
    welcomeRoleId: "role-welcome",
  });

  assert.equal(roleId, "role-welcome");
});

test("resolveActiveRoleId keeps role cleared on persisted threads even if welcome draft still exists", () => {
  const roleId = resolveActiveRoleId({
    hasPersistedThread: true,
    persistedRoleId: null,
    welcomeRoleId: "role-welcome",
  });

  assert.equal(roleId, null);
});

test("resolveRoleAvatarSrc returns the built-in avatar url when the role has an avatar id", () => {
  const src = resolveRoleAvatarSrc("pilot-helper", [
    {
      id: "pilot-helper",
      label: "Pilot Helper",
      src: "/avatars/pilot-helper.png",
      description: "Helper",
      tags: ["helper"],
    },
  ]);

  assert.equal(src, "/avatars/pilot-helper.png");
});

test("buildThreadContextTags places the selected role tag before the knowledge base tag", () => {
  const tags = buildThreadContextTags({
    role: {
      id: "role-1",
      name: "Formal Reviewer",
      summary: "A strict reviewer",
      avatarId: "formal-reviewer",
      status: "active",
      tags: ["review"],
      prompt: {
        description: "",
        worldview: "",
        persona: "",
        scenario: "",
        exampleDialogues: "",
        style: "",
        constraints: "",
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
    roleAvatarSrc: "/avatars/formal-reviewer.png",
    knowledgeBase: {
      id: "kb-1",
      name: "Specs",
      description: "Project specs",
      status: "ready",
      documentCount: 3,
      enabledDocumentCount: 2,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    },
  });

  assert.deepEqual(tags, [
    {
      id: "role:role-1",
      kind: "role",
      label: "Formal Reviewer",
      tooltip: "A strict reviewer",
      removable: true,
      avatarSrc: "/avatars/formal-reviewer.png",
    },
    {
      id: "knowledge-base:kb-1",
      kind: "knowledge-base",
      label: "Specs",
      tooltip: "Specs (2 enabled documents)",
      removable: true,
    },
  ]);
});

test("formatRoleReplyingLabel falls back to the default assistant label when no role is selected", () => {
  assert.equal(
    formatRoleReplyingLabel(null, "Assistant is typing a reply", " is replying"),
    "Assistant is typing a reply",
  );
});

test("formatRoleReplyingLabel uses the selected role name when available", () => {
  assert.equal(
    formatRoleReplyingLabel("Formal Reviewer", "Assistant is typing a reply", " is replying"),
    "Formal Reviewer is replying",
  );
});

test("upsertRoleSummary inserts a missing role at the front of the local cache", () => {
  const roles = upsertRoleSummary(
    [
      {
        id: "role-2",
        name: "Role 2",
        summary: "",
        avatarId: null,
        status: "active",
        tags: [],
        prompt: {
          description: "",
          worldview: "",
          persona: "",
          scenario: "",
          exampleDialogues: "",
          style: "",
          constraints: "",
        },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    {
      id: "role-1",
      name: "Role 1",
      summary: "",
      avatarId: null,
      status: "active",
      tags: [],
      prompt: {
        description: "",
        worldview: "",
        persona: "",
        scenario: "",
        exampleDialogues: "",
        style: "",
        constraints: "",
      },
      createdAt: "2025-01-02T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    },
  );

  assert.deepEqual(
    roles.map((role) => role.id),
    ["role-1", "role-2"],
  );
});

test("upsertRoleSummary replaces an existing cached role in place", () => {
  const roles = upsertRoleSummary(
    [
      {
        id: "role-1",
        name: "Old Name",
        summary: "",
        avatarId: null,
        status: "active",
        tags: [],
        prompt: {
          description: "",
          worldview: "",
          persona: "",
          scenario: "",
          exampleDialogues: "",
          style: "",
          constraints: "",
        },
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    {
      id: "role-1",
      name: "New Name",
      summary: "",
      avatarId: "pilot-helper",
      status: "active",
      tags: ["fresh"],
      prompt: {
        description: "",
        worldview: "",
        persona: "",
        scenario: "",
        exampleDialogues: "",
        style: "",
        constraints: "",
      },
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    },
  );

  assert.equal(roles[0]?.name, "New Name");
  assert.equal(roles[0]?.avatarId, "pilot-helper");
});
