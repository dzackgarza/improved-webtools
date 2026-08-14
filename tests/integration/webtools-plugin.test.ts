import { describe, expect, it } from "bun:test";
import { createOpencodeServer } from "@opencode-ai/sdk";
import getPort from "get-port";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { fetchLiveRedditPost } from "../../scripts/verify-reddit-live";

const TOOL_DIR = process.cwd();
const pluginUrl = pathToFileURL(join(TOOL_DIR, "src/index.ts")).href;
const DEBUG_MODE_VARIABLE = "IMPROVED_WEBTOOLS_DEBUG_MODE";

const listedToolSchema = z.object({
  id: z.string(),
  description: z.string(),
}).passthrough();
const toolListSchema = z.array(listedToolSchema);

type ListedTool = z.infer<typeof listedToolSchema>;

async function listTools(debugMode: boolean): Promise<ListedTool[]> {
  const previousDebugMode = process.env[DEBUG_MODE_VARIABLE];
  if (debugMode) {process.env[DEBUG_MODE_VARIABLE] = "1";}
  else {Reflect.deleteProperty(process.env, DEBUG_MODE_VARIABLE);}

  const serverPromise = createOpencodeServer({
    hostname: "127.0.0.1",
    port: await getPort(),
    timeout: 15_000,
    config: {
      plugin: [pluginUrl],
    },
  });

  if (previousDebugMode === undefined) {Reflect.deleteProperty(process.env, DEBUG_MODE_VARIABLE);}
  else {process.env[DEBUG_MODE_VARIABLE] = previousDebugMode;}

  const server = await serverPromise;

  try {
    const url = new URL("/experimental/tool", server.url);
    url.searchParams.set("provider", "opencode");
    url.searchParams.set("model", "mimo-v2.5-free");
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`OpenCode tool registry request failed with HTTP ${response.status}.`);
    }
    return toolListSchema.parse(await response.json());
  } finally {
    server.close();
  }
}

function resolvedTool(tools: ListedTool[], id: string): ListedTool {
  // OpenCode resolves duplicate IDs by registry order. The final registration wins.
  // Reference: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/tools.ts
  const tool = tools.findLast((candidate) => candidate.id === id);
  if (tool === undefined) {throw new Error(`OpenCode did not register ${id}.`);}
  return tool;
}

describe("improved-webtools live integration", () => {
  it("resolves the normal file plugin over the built-in web tools", async () => {
    const tools = await listTools(false);

    expect(resolvedTool(tools, "webfetch").description).toBe(
      "Use when you need to read a webpage URL as plain text content.",
    );
    expect(resolvedTool(tools, "websearch").description).toContain(
      "Optional categories for narrowing only",
    );
  }, 30_000);

  it("registers the non-shadowing debug aliases through OpenCode", async () => {
    const tools = await listTools(true);

    expect(resolvedTool(tools, "webfetch_debug").description).toContain(
      "explicitly debugging improved-webtools loading without shadowing",
    );
    expect(resolvedTool(tools, "websearch_debug").description).toContain(
      "explicitly debugging improved-webtools loading without shadowing",
    );
  }, 20_000);

  it("fetches the exact Reddit permalink and renders unique comments", async () => {
    const content = await fetchLiveRedditPost();

    expect(content).toContain("- Author: u/Thinklikeachef");
    expect(content).toContain("- Comments extracted: 46");
  }, 30_000);
});
