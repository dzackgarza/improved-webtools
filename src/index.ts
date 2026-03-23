import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Plugin, tool } from "@opencode-ai/plugin";

const execFileAsync = promisify(execFile);
const CLI_TIMEOUT_MS = 120_000;
const CLI_MAX_BUFFER = 16 * 1024 * 1024;
const CLI_SPEC =
  process.env.WEBTOOLS_CLI_SPEC ?? "git+https://github.com/dzackgarza/webtools-manager.git";

async function runWebtools(toolName: string, args: Record<string, unknown>): Promise<string> {
  const commandArgs =
    toolName === "websearch"
      ? [
          "websearch",
          String(args.query),
          ...(args.category ? ["--category", String(args.category)] : []),
          ...(args.num_results !== undefined ? ["--num-results", String(args.num_results)] : []),
          ...(args.offset !== undefined ? ["--offset", String(args.offset)] : []),
          ...(args.recency !== undefined ? ["--recency", String(args.recency)] : []),
          ...((args.domains as string[] | undefined)?.flatMap((domain) => ["--domains", domain]) ??
            []),
        ]
      : ["webfetch", String(args.url), ...(args.overwrite_cache ? ["--overwrite-cache"] : [])];

  const { stdout } = await execFileAsync("uvx", ["--from", CLI_SPEC, "webtools", ...commandArgs], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER,
  });
  return stdout.trim();
}

export const ImprovedWebSearchPlugin: Plugin = async ({ client }) => {
  const websearchTool = tool({
    description:
      "Use when you need to search the web. Optional categories for narrowing only: news, it, npm, pypi, st, gh, hf, ollama, hn, science, arx, cr, gos, se, aa, lg. Use offset and num_results to paginate.",
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

  return {
    tool: {
      webfetch: tool({
        description: "Use when you need to read a webpage URL as plain text content.",
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
      }),
      websearch: websearchTool,
    },
  };
};

export const SearxngSearchPlugin = ImprovedWebSearchPlugin;
