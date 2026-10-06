import fs from "node:fs";
import type { McpResourceImplementation } from "../core/definitions.js";
import { mcpBadRequest } from "../core/errors.js";
import { assertReadEnvironment, assertPathExists } from "../document-readers.js";
import { executeGenericRead } from "../read/generic.js";
import { executeList } from "../read/list.js";
import { resolveWorkspacePath } from "../workspace.js";

export const workspaceResource: McpResourceImplementation = {
  definition: {
    id: "workspace",
    title: "Workspace Resource",
    description: "Read files and directories inside the configured workspace root.",
    kind: "workspace",
    mimeType: "application/json",
    tags: ["workspace", "read"],
    capabilities: {
      read: true,
      list: true,
    },
  },
  read: async ({ args, environment, pushEvent }) => {
    assertReadEnvironment(environment);

    const targetPath = resolveWorkspacePath(args.path);
    assertPathExists(targetPath);

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return executeList({ args, environment, pushEvent });
    }

    if (!stat.isFile()) {
      throw mcpBadRequest("Only files and directories are supported");
    }

    const result = await executeGenericRead({ args, environment, pushEvent });
    return {
      contents: result.contents,
      artifacts: result.artifacts,
    };
  },
};
