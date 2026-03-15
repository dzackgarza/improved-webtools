import { type Plugin, tool } from "@opencode-ai/plugin";

import {
  executeWebFetch,
  executeWebSearch,
  getToolDescriptions,
  getToolIds,
} from "./operations.ts";

function buildLogger(client: {
  app: {
    log: (input: {
      body: {
        service: string;
        level: "error" | "warn" | "debug" | "info";
        message: string;
        extra?: Record<string, unknown>;
      };
    }) => Promise<unknown>;
  };
}) {
  return async (input: { message: string; extra: Record<string, unknown> }) => {
    await client.app.log({
      body: {
        service: "improved-webtools",
        level: "error",
        message: input.message,
        extra: input.extra,
      },
    });
  };
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export const ImprovedWebSearchPlugin: Plugin = async ({ client }) => {
  const toolIds = getToolIds();
  const toolDescriptions = getToolDescriptions();

  return {
    tool: {
      [toolIds.webfetch]: tool({
        description: toolDescriptions.webfetch,
      args: {
        url: tool.schema.string(),
        overwrite_cache: tool.schema.boolean().optional(),
      },
      async execute(args, context) {
        const parsed = parseHttpUrl(args.url);
        if (parsed) {
          await context.ask({
            permission: toolIds.webfetch,
            patterns: [parsed.toString()],
            always: ["*"],
            metadata: {
              url: parsed.toString(),
            },
          });

          context.metadata({
            title: `Web fetch: ${parsed.hostname}${parsed.pathname}`.slice(0, 120),
          });
        }

        return executeWebFetch(args, {
          log: buildLogger(client),
        });
      },
    }),
      [toolIds.websearch]: tool({
        description: toolDescriptions.websearch,
      args: {
        query: tool.schema.string(),
        category: tool.schema.string().optional(),
        num_results: tool.schema.number().optional(),
        offset: tool.schema.number().optional(),
        recency: tool.schema.number().optional(),
        domains: tool.schema.array(tool.schema.string()).optional(),
      },
      async execute(args, context) {
        const query = args.query.trim();
        if (query) {
          await context.ask({
            permission: toolIds.websearch,
            patterns: [query],
            always: ["*"],
            metadata: {
              query,
            },
          });

          context.metadata({
            title: `Web search: ${query.slice(0, 72)}`,
            metadata: {
              num_results: args.num_results,
            },
          });
        }

        return executeWebSearch(args, {
          abort: context.abort,
          log: buildLogger(client),
        });
      },
    }),
    },
  };
};

export const SearxngSearchPlugin = ImprovedWebSearchPlugin;
