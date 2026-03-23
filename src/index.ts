import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Plugin, tool } from "@opencode-ai/plugin";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 120_000;
const CLI_MAX_BUFFER = 16 * 1024 * 1024;
const CLI_SPEC =
  process.env.WEBTOOLS_CLI_SPEC ?? "git+https://github.com/dzackgarza/webtools-manager.git";

function envFlagEnabled(value?: string): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

const DEBUG_MODE = envFlagEnabled(process.env.IMPROVED_WEBTOOLS_DEBUG_MODE);
const WEBFETCH_TOOL_ID = DEBUG_MODE ? "webfetch_debug" : "webfetch";
const WEBSEARCH_TOOL_ID = DEBUG_MODE ? "websearch_debug" : "websearch";
const WEBFETCH_DESCRIPTION = DEBUG_MODE
  ? "Debug alias for webfetch — use only when verifying plugin loading without shadowing the built-in tool."
  : "Use when you need to read a webpage URL as plain text content.";
const WEBSEARCH_DESCRIPTION = DEBUG_MODE
  ? "Debug alias for websearch — use only when verifying plugin loading without shadowing the built-in tool."
  : "Use when you need to search the web. Optional categories for narrowing only: news, it, npm, pypi, st, gh, hf, ollama, hn, science, arx, cr, gos, se, aa, lg. Use offset and num_results to paginate.";

function buildWebsearchArgs(args: Record<string, unknown>): string[] {
  const result = ["websearch", String(args.query)];
  if (args.category !== undefined && args.category !== null)
    result.push("--category", String(args.category));
  if (args.num_results !== undefined) result.push("--num-results", String(args.num_results));
  if (args.offset !== undefined) result.push("--offset", String(args.offset));
  if (args.recency !== undefined) result.push("--recency", String(args.recency));
  const domains = args.domains as string[] | undefined;
  if (domains !== undefined) {
    for (const domain of domains) result.push("--domains", domain);
  }
  return result;
}

function buildWebfetchArgs(args: Record<string, unknown>): string[] {
  const result = ["webfetch", String(args.url)];
  if (args.overwrite_cache === true) result.push("--overwrite-cache");
  return result;
}

async function runWebtools(toolName: string, args: Record<string, unknown>): Promise<string> {
  const commandArgs = toolName === "websearch" ? buildWebsearchArgs(args) : buildWebfetchArgs(args);
  const { stdout } = await execFileAsync("uvx", ["--from", CLI_SPEC, "webtools", ...commandArgs], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER,
  });
  return stdout.trim();
}

export const ImprovedWebSearchPlugin: Plugin = async ({ client }) => {
  const websearchTool = tool({
    description: WEBSEARCH_DESCRIPTION,
    args: {
      query: tool.schema.string(),
      category: tool.schema.string().optional(),
      num_results: tool.schema.number().optional(),
      offset: tool.schema.number().optional(),
      recency: tool.schema.number().optional(),
      domains: tool.schema.array(tool.schema.string()).optional(),
    },
    async execute(args, context) {
      await context.ask({
        permission: "websearch",
        patterns: [args.query],
        always: ["*"],
        metadata: { query: args.query },
      });

      context.metadata({
        title: `Web search: ${args.query.slice(0, 72)}`,
        metadata: { num_results: args.num_results },
      });

      try {
        return await runWebtools("websearch", args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await client.app.log({
          body: {
            service: "web-search-plugin",
            level: "error",
            message: "websearch execution error",
            extra: { query: args.query, error: message },
          },
        });
        return `Search failed: ${message}`;
      }
    },
  });

  const webfetchTool = tool({
    description: WEBFETCH_DESCRIPTION,
    args: {
      url: tool.schema.string(),
      overwrite_cache: tool.schema.boolean().optional(),
    },
    async execute(args, context) {
      const rawUrl = args.url.trim();
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return `Invalid URL: ${JSON.stringify(args.url)}.`;
      }

      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return `Invalid URL: only http and https schemes are supported.`;
      }

      await context.ask({
        permission: "webfetch",
        patterns: [parsed.toString()],
        always: ["*"],
        metadata: { url: parsed.toString() },
      });

      context.metadata({
        title: `Web fetch: ${parsed.hostname}${parsed.pathname}`.slice(0, 120),
      });

      try {
        return await runWebtools("webfetch", args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await client.app.log({
          body: {
            service: "web-search-plugin",
            level: "error",
            message: "webfetch execution error",
            extra: { url: parsed.toString(), error: message },
          },
        });
        return "Failed to fetch URL.";
      }
    },
  });

  return {
    tool: {
      [WEBFETCH_TOOL_ID]: webfetchTool,
      [WEBSEARCH_TOOL_ID]: websearchTool,
    },
  };
};

export const SearxngSearchPlugin = ImprovedWebSearchPlugin;
