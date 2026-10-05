import { workspaceResource } from "../mcp/resources/workspace-resource.js";
import {
  codebaseExploreTool,
} from "../mcp/managed-codegraph/codebase-explore.tool.js";
import {
  deletePathTool,
  movePathTool,
  replaceBlockTool,
  writeFileTool,
} from "../mcp/tools/edit-actions.tool.js";
import { editFileTool } from "../mcp/tools/edit-file.tool.js";
import { grepTool } from "../mcp/tools/grep.tool.js";
import { listTool } from "../mcp/tools/list.tool.js";
import {
  githubActionsTool,
  githubIssueTool,
  githubPullRequestTool,
  githubRepositoryTool,
} from "../mcp/tools/github-domain.tool.js";
import { newsSearchTool } from "../mcp/tools/news-search.tool.js";
import { readExtractTool } from "../mcp/tools/read-extract.tool.js";
import { readListTool } from "../mcp/tools/read-list.tool.js";
import { readLocateTool } from "../mcp/tools/read-locate.tool.js";
import { readOpenTool } from "../mcp/tools/read-open.tool.js";
import { readDiscoverTool } from "../mcp/tools/read-discover.tool.js";
import { readSliceTool } from "../mcp/tools/read-slice.tool.js";
import { readTool } from "../mcp/tools/read.tool.js";
import { terminalSessionTool } from "../mcp/tools/terminal-session.tool.js";
import { webSearchTool } from "../mcp/tools/web-search.tool.js";
import { mailQueryTool } from "../mcp/tools/mail-query.tool.js";
import { workspaceMutationTool } from "../mcp/tools/workspace-mutation.tool.js";
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
  registerTool(readListTool);
  registerTool(readLocateTool);
  registerTool(readOpenTool);
  registerTool(readDiscoverTool);
  registerTool(grepTool);
  registerTool(readExtractTool);
  registerTool(readSliceTool);
  registerTool(readTool);

  registerTool(writeFileTool);
  registerTool(replaceBlockTool);
  registerTool(deletePathTool);
  registerTool(movePathTool);

  // WenShu document types are exposed as Skills, not duplicate Harness tools.
  // Keep runtime-pack readiness observable while ensuring legacy office_* wrappers
  // are not left registered from older bootstrap paths or persisted processes.
  reconcileWenshuOfficeHarnessCapabilities();

  // Compatibility-only implementations for persisted/legacy invocations.
  // Exposure policy keeps these out of the Agent-visible edit surface.
  registerTool(editFileTool);
  registerTool(workspaceMutationTool);

  registerTool(webSearchTool);
  registerTool(newsSearchTool);
  registerTool(mailQueryTool);

  // GitHub exposes exactly four stable domain tools. Legacy *_read implementations
  // remain internal delegates but are intentionally not registered as tools.
  registerTool(githubRepositoryTool);
  registerTool(githubIssueTool);
  registerTool(githubPullRequestTool);
  registerTool(githubActionsTool);

  registerTool(terminalSessionTool);
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
