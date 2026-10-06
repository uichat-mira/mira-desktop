import { workspaceResource } from "../mcp/resources/workspace-resource.js";
import {
  codebaseExploreTool,
} from "../mcp/managed-codegraph/codebase-explore.tool.js";
import { writeTool } from "../mcp/tools/write.tool.js";
import { editTool } from "../mcp/tools/edit.tool.js";
import { moveTool } from "../mcp/tools/move.tool.js";
import { deleteTool } from "../mcp/tools/delete.tool.js";
import { grepTool } from "../mcp/tools/grep.tool.js";
import { globTool } from "../mcp/tools/glob.tool.js";
import { listTool } from "../mcp/tools/list.tool.js";
import {
  githubActionsTool,
  githubIssueTool,
  githubPullRequestTool,
  githubRepositoryTool,
} from "../mcp/tools/github-domain.tool.js";
import { newsSearchTool } from "../mcp/tools/news-search.tool.js";
import { readExtractTool } from "../mcp/tools/read-extract.tool.js";
import { readOpenTool } from "../mcp/tools/read-open.tool.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { terminalSessionCompatibilityTool, terminalTool } from "../mcp/tools/terminal-session.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";
import { webFetchTool } from "../mcp/tools/web-fetch.tool.js";
import { mailQueryTool } from "../mcp/tools/mail-query.tool.js";
import { createBrowserAttachedTools } from "../mcp/tools/browser-attached.tool.js";
import { askExternalExpertTool } from "../mcp/tools/ask-external-expert.tool.js";
import {
  initializeExternalMcpDatabase,
  registerAllExternalMcpCapabilities,
} from "../mcp/external.js";
import { webSearchSettingsRepository } from "@/db/repositories/web-search-settings.repository.js";
import { reconcileCodeGraphHarnessCapability } from "./codegraph-capability.js";
import { registerTool, registerReadableResource } from "./registry.js";
import { reconcileWenshuOfficeHarnessCapabilities } from "./wenshu-office-capability.js";

let initialized = false;

export const initializeHarnessRuntime = () => {
  if (initialized) {
    return;
  }

  registerReadableResource(workspaceResource);
  registerTool(listTool);
  registerTool(globTool);
  registerTool(grepTool);
  registerTool(readTool);

  // Office/WenShu subAgent profiles still declare these two compatibility
  // readers. Keep them registered but hidden from the public Agent surface
  // until those verified Skill consumers migrate.
  registerTool(readOpenTool);
  registerTool(readExtractTool);

  registerTool(writeTool);
  registerTool(editTool);
  registerTool(moveTool);
  registerTool(deleteTool);

  // WenShu document types are exposed as Skills, not duplicate Harness tools.
  // Keep runtime-pack readiness observable while ensuring legacy office_* wrappers
  // are not left registered from older bootstrap paths or persisted processes.
  reconcileWenshuOfficeHarnessCapabilities();

  registerTool(webSearchTool);
  registerTool(webFetchTool);
  registerTool(newsSearchTool);
  registerTool(mailQueryTool);

  // GitHub exposes exactly four stable domain tools. Legacy *_read implementations
  // remain internal delegates but are intentionally not registered as tools.
  registerTool(githubRepositoryTool);
  registerTool(githubIssueTool);
  registerTool(githubPullRequestTool);
  registerTool(githubActionsTool);

  registerTool(terminalTool);
  // Compatibility-only alias for persisted approvals/runs created before the
  // canonical terminal Tool migration. Exposure policy hides this alias from
  // new Agent planning. Remove it once no supported persisted run can contain
  // toolId "terminal_session" in pending approval/tool-call state.
  registerTool(terminalSessionCompatibilityTool);
  for (const tool of createBrowserAttachedTools()) {
    registerTool(tool);
  }
  registerTool(askExternalExpertTool);
  reconcileCodeGraphHarnessCapability();
  // External MCP persistence is optional at bootstrap time. Some callers
  // (notably route-level tests and early app startup before DB wiring) only
  // need the built-in harness tools. In those cases we should not fail
  // the whole server just because DATABASE_URL has not been resolved yet.
  if (process.env.DATABASE_URL) {
    initializeExternalMcpDatabase();
    registerAllExternalMcpCapabilities();
    webSearchSettingsRepository.initialize();
  }
  initialized = true;
};

export const resetHarnessRuntime = () => {
  initialized = false;
};
