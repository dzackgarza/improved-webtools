import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolContext } from "@opencode-ai/plugin";
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import getPort from "get-port";
import { z } from "zod";
import { ImprovedWebSearchPlugin } from "../../src/index";

const TOOL_DIR = process.cwd();
const pluginUrl = pathToFileURL(join(TOOL_DIR, "src/index.ts")).href;
const TEST_PROVIDER = "opencode";
const TEST_MODEL = "deepseek-v4-flash-free";

const listedToolSchema = z.object({
  id: z.string(),
  description: z.string(),
});
const toolListSchema = z.array(listedToolSchema);

type ListedTool = z.infer<typeof listedToolSchema>;

async function startServer() {
  return createOpencodeServer({
    hostname: "127.0.0.1",
    port: await getPort(),
    timeout: 30_000,
    config: {
      model: `${TEST_PROVIDER}/${TEST_MODEL}`,
      plugin: [pluginUrl],
      permission: {
        webfetch: "allow",
      },
    },
  });
}

export async function listTools(): Promise<ListedTool[]> {
  const server = await startServer();
  try {
    const url = new URL("/experimental/tool", server.url);
    url.searchParams.set("provider", TEST_PROVIDER);
    url.searchParams.set("model", TEST_MODEL);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenCode tool registry request failed with HTTP ${response.status}.`);
    }
    return toolListSchema.parse(await response.json());
  } finally {
    server.close();
  }
}

export function resolvedTool(tools: ListedTool[], id: string): ListedTool {
  // OpenCode resolves duplicate IDs by registry order. The final registration wins.
  // Reference: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/tools.ts
  const registeredTool = tools.findLast((candidate) => candidate.id === id);
  if (registeredTool === undefined) {
    throw new Error(`OpenCode did not register ${id}.`);
  }
  return registeredTool;
}

function integrationToolContext(): ToolContext {
  return {
    sessionID: "ses_improved_webtools_integration",
    messageID: "msg_improved_webtools_integration",
    agent: "build",
    directory: TOOL_DIR,
    worktree: TOOL_DIR,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  };
}

export async function executePluginWebFetch(url: string): Promise<string> {
  const server = await startServer();
  try {
    const client = createOpencodeClient({ baseUrl: server.url });
    const plugin = await ImprovedWebSearchPlugin({
      client,
      project: {
        id: "improved-webtools-integration",
        worktree: TOOL_DIR,
        time: { created: 0 },
      },
      directory: TOOL_DIR,
      worktree: TOOL_DIR,
      serverUrl: new URL(server.url),
      $: Bun.$,
    });
    const webFetch = plugin.tool?.webfetch;
    if (webFetch === undefined) {
      throw new Error("The plugin did not export webfetch.");
    }
    return webFetch.execute({ url, overwrite_cache: true }, integrationToolContext());
  } finally {
    server.close();
  }
}
