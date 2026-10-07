import type { ToolInvocationContext, ToolImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { githubIssueReadTool as baseGitHubIssueReadTool } from "./github-read.tool.js";

const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/iu;

const normalizeLoginFilter = (value: unknown, name: string) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw mcpBadRequest(`${name} must be a string`);
  }
  const login = value.trim();
  if (!login || !GITHUB_LOGIN_PATTERN.test(login)) {
    throw mcpBadRequest(`${name} must be a valid GitHub login`);
  }
  return login;
};

const normalizeUpdatedSince = (value: unknown) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw mcpBadRequest("updatedSince must be a string");
  }
  const updatedSince = value.trim();
  if (!updatedSince || !Number.isFinite(Date.parse(updatedSince))) {
    throw mcpBadRequest("updatedSince must be a valid date or ISO 8601 timestamp");
  }
  return updatedSince;
};

const normalizeSearchText = (value: unknown) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw mcpBadRequest("query must be a string");
  }
  const query = value
    .replace(/[\\":()]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!query) return undefined;
  return `${query} in:title,body`;
};

export const githubIssueReadTool: ToolImplementation = {
  definition: baseGitHubIssueReadTool.definition,
  execute: (context: ToolInvocationContext) =>
    baseGitHubIssueReadTool.execute({
      ...context,
      args: {
        ...context.args,
        query: normalizeSearchText(context.args.query),
        assignee: normalizeLoginFilter(context.args.assignee, "assignee"),
        creator: normalizeLoginFilter(context.args.creator, "creator"),
        updatedSince: normalizeUpdatedSince(context.args.updatedSince),
      },
    }),
};
