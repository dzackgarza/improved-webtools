import { afterEach, describe, expect, it } from "bun:test";

import { PASSPHRASE_WEBFETCH, PASSPHRASE_WEB_SEARCH } from "../../src/passphrases";

type AskInput = {
  permission: string;
  patterns: string[];
  always: string[];
  metadata: Record<string, unknown>;
};

type MetadataInput = {
  title?: string;
  metadata?: Record<string, unknown>;
};

type MockContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  asks: AskInput[];
  metadatas: MetadataInput[];
  ask: (input: AskInput) => Promise<void>;
  metadata: (input: MetadataInput) => void;
};

function buildContext(): MockContext {
  const asks: AskInput[] = [];
  const metadatas: MetadataInput[] = [];
  return {
    sessionID: "ses_integration",
    messageID: "msg_integration",
    agent: "LocalMinimalShadow",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    asks,
    metadatas,
    ask: async (input: AskInput) => {
      asks.push(input);
    },
    metadata: (input: MetadataInput) => {
      metadatas.push(input);
    },
  };
}

async function loadPlugin(debugMode: boolean) {
  const originalDebugMode = process.env.IMPROVED_WEBTOOLS_DEBUG_MODE;
  const originalSearxng = process.env.SEARXNG_INSTANCE_URL;

  if (debugMode) {
    process.env.IMPROVED_WEBTOOLS_DEBUG_MODE = "1";
  } else {
    delete process.env.IMPROVED_WEBTOOLS_DEBUG_MODE;
  }
  delete process.env.SEARXNG_INSTANCE_URL;

  const mod = await import(
    new URL(`../../src/index.ts?integration=${Date.now()}-${Math.random()}`, import.meta.url).href
  );

  const plugin = await mod.ImprovedWebSearchPlugin({
    client: {
      app: {
        log: async () => undefined,
      },
    },
  } as any);

  if (originalDebugMode === undefined) {
    delete process.env.IMPROVED_WEBTOOLS_DEBUG_MODE;
  } else {
    process.env.IMPROVED_WEBTOOLS_DEBUG_MODE = originalDebugMode;
  }

  if (originalSearxng === undefined) {
    delete process.env.SEARXNG_INSTANCE_URL;
  } else {
    process.env.SEARXNG_INSTANCE_URL = originalSearxng;
  }

  return plugin;
}

afterEach(() => {
  delete process.env.IMPROVED_WEBTOOLS_DEBUG_MODE;
});

describe("improved-webtools adapter integration", () => {
  it("exposes default tool ids and returns the search setup message through the adapter", async () => {
    const plugin = await loadPlugin(false);
    const toolNames = Object.keys(plugin.tool ?? {});
    expect(new Set(toolNames)).toEqual(new Set(["webfetch", "websearch"]));

    const context = buildContext();
    const originalSearxng = process.env.SEARXNG_INSTANCE_URL;
    delete process.env.SEARXNG_INSTANCE_URL;
    const output = await plugin.tool!.websearch.execute(
      {
        query: "openai",
        num_results: 3,
      },
      context as any,
    );
    if (originalSearxng === undefined) {
      delete process.env.SEARXNG_INSTANCE_URL;
    } else {
      process.env.SEARXNG_INSTANCE_URL = originalSearxng;
    }

    expect(output).toContain(PASSPHRASE_WEB_SEARCH);
    expect(output).toContain("set SEARXNG_INSTANCE_URL");
    expect(context.asks).toEqual([
      {
        permission: "websearch",
        patterns: ["openai"],
        always: ["*"],
        metadata: {
          query: "openai",
        },
      },
    ]);
    expect(context.metadatas[0]).toEqual({
      title: "Web search: openai",
      metadata: {
        num_results: 3,
      },
    });
  });

  it("exposes debug tool ids and preserves webfetch validation output", async () => {
    const plugin = await loadPlugin(true);
    const toolNames = Object.keys(plugin.tool ?? {});
    expect(new Set(toolNames)).toEqual(new Set(["webfetch_debug", "websearch_debug"]));

    const context = buildContext();
    const output = await plugin.tool!.webfetch_debug.execute(
      {
        url: "not-a-valid-url",
      },
      context as any,
    );

    expect(output).toContain(PASSPHRASE_WEBFETCH);
    expect(output).toContain('Invalid URL: "not-a-valid-url".');
    expect(context.asks).toHaveLength(0);
    expect(context.metadatas).toHaveLength(0);
  });
});
