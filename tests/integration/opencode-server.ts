import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createOpencodeClient,
  createOpencodeServer,
  type SessionMessagesResponse,
  type ToolPart,
} from "@opencode-ai/sdk";
import getPort from "get-port";
import { z } from "zod";

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

function isWebFetchPart(part: SessionMessagesResponse[number]["parts"][number]): part is ToolPart {
  return part.type === "tool" && part.tool === "webfetch";
}

function completedWebFetchOutput(messages: SessionMessagesResponse): string {
  const webFetchPart = messages.flatMap((message) => message.parts).find(isWebFetchPart);
  if (webFetchPart === undefined) {
    throw new Error("OpenCode did not call the shadowed webfetch tool.");
  }
  if (webFetchPart.state.status !== "completed") {
    throw new Error(`OpenCode webfetch ended with status ${webFetchPart.state.status}.`);
  }
  return webFetchPart.state.output;
}

export async function executeWebFetchThroughOpenCode(url: string): Promise<string> {
  const server = await startServer();
  try {
    const client = createOpencodeClient({ baseUrl: server.url });
    const created = await client.session.create({
      body: { title: "improved-webtools Reddit integration" },
      query: { directory: TOOL_DIR },
    });
    if (created.data === undefined) {
      throw new Error("OpenCode did not create the integration session.");
    }

    const reply = await client.session.prompt({
      path: { id: created.data.id },
      query: { directory: TOOL_DIR },
      body: {
        model: { providerID: TEST_PROVIDER, modelID: TEST_MODEL },
        agent: "build",
        tools: { webfetch: true },
        parts: [
          {
            type: "text",
            text: `Call webfetch once with url=${url} and overwrite_cache=true. Then stop.`,
          },
        ],
      },
    });
    if (reply.data === undefined) {
      throw new Error(
        `OpenCode did not return the integration response: ${JSON.stringify(reply.error)}`,
      );
    }

    const messages = await client.session.messages({
      path: { id: created.data.id },
      query: { directory: TOOL_DIR },
    });
    if (messages.data === undefined) {
      throw new Error(
        `OpenCode did not return the integration messages: ${JSON.stringify(messages.error)}`,
      );
    }

    return completedWebFetchOutput(messages.data);
  } finally {
    server.close();
  }
}
