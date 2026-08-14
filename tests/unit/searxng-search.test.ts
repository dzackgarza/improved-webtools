import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { z } from "zod";
import { ImprovedWebSearchPlugin } from "../../src/index";

type AskInput = Parameters<ToolContext["ask"]>[0];
type MetadataInput = Parameters<ToolContext["metadata"]>[0];

type MockContext = ToolContext & {
  asks: AskInput[];
  metadatas: MetadataInput[];
};

const searchPageSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
    }).passthrough(),
  ),
}).passthrough();

function inputUrl(input: string | Request | URL): string {
  if (typeof input === "string") {return input;}
  if (input instanceof URL) {return input.href;}
  return input.url;
}

function buildContext(): MockContext {
  const asks: AskInput[] = [];
  const metadatas: MetadataInput[] = [];
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
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

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fixtureText(relativePath: string): string {
  const path = new URL(`../fixtures/real/${relativePath}`, import.meta.url);
  return readFileSync(path, "utf8");
}

function fixtureJson(relativePath: string): z.infer<ReturnType<typeof z.json>> {
  return z.json().parse(JSON.parse(fixtureText(relativePath)));
}

async function loadPlugin(
  instanceUrl: string,
  options?: {
    webfetchCacheEnabled?: "0" | "1";
    webfetchCacheDir?: string;
    webfetchCacheTtlDays?: string;
  },
) {
  process.env.SEARXNG_INSTANCE_URL = instanceUrl;
  process.env.WEBFETCH_CACHE_ENABLED = options?.webfetchCacheEnabled ?? "1";
  process.env.WEBFETCH_CACHE_DIR =
    options?.webfetchCacheDir ??
    `/tmp/opencode-webfetch-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (options?.webfetchCacheTtlDays !== undefined) {
    process.env.WEBFETCH_CACHE_TTL_DAYS = options.webfetchCacheTtlDays;
  } else {
    delete process.env.WEBFETCH_CACHE_TTL_DAYS;
  }
  const client = createOpencodeClient({ baseUrl: "http://localhost" });
  Reflect.set(client.app, "log", async () => {});

  const plugin = await ImprovedWebSearchPlugin({
    client,
    project: {
      id: "test-project",
      worktree: "/tmp",
      time: { created: 0 },
    },
    directory: "/tmp",
    worktree: "/tmp",
    serverUrl: new URL("http://localhost"),
    $: Bun.$,
  });
  return {
    websearch: plugin.tool!.websearch,
    webfetch: plugin.tool!.webfetch,
  };
}

describe("searxng-search plugin", () => {
  const originalFetch = globalThis.fetch;
  const originalSpawn = Bun.spawn;
  const originalWrite = Bun.write;
  const originalSearxngUrl = process.env.SEARXNG_INSTANCE_URL;
  const originalCacheEnabled = process.env.WEBFETCH_CACHE_ENABLED;
  const originalCacheDir = process.env.WEBFETCH_CACHE_DIR;
  const originalCacheTtlDays = process.env.WEBFETCH_CACHE_TTL_DAYS;
  const originalArxivLibraryDir = process.env.WEBFETCH_ARXIV_LIBRARY_DIR;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    Reflect.set(Bun, "spawn", originalSpawn);
    Reflect.set(Bun, "write", originalWrite);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Reflect.set(Bun, "spawn", originalSpawn);
    Reflect.set(Bun, "write", originalWrite);
    if (originalSearxngUrl === undefined)
      {delete process.env.SEARXNG_INSTANCE_URL;}
    else {process.env.SEARXNG_INSTANCE_URL = originalSearxngUrl;}
    if (originalCacheEnabled === undefined)
      {delete process.env.WEBFETCH_CACHE_ENABLED;}
    else {process.env.WEBFETCH_CACHE_ENABLED = originalCacheEnabled;}
    if (originalCacheDir === undefined) {delete process.env.WEBFETCH_CACHE_DIR;}
    else {process.env.WEBFETCH_CACHE_DIR = originalCacheDir;}
    if (originalCacheTtlDays === undefined)
      {delete process.env.WEBFETCH_CACHE_TTL_DAYS;}
    else {process.env.WEBFETCH_CACHE_TTL_DAYS = originalCacheTtlDays;}
    if (originalArxivLibraryDir === undefined)
      {delete process.env.WEBFETCH_ARXIV_LIBRARY_DIR;}
    else {process.env.WEBFETCH_ARXIV_LIBRARY_DIR = originalArxivLibraryDir;}
  });

  it("formats websearch results with pagination", async () => {
    const pageOpenAI1 = searchPageSchema.parse(
      fixtureJson("searxng/openai-page1.json"),
    );
    const pageOpenAI2 = searchPageSchema.parse(
      fixtureJson("searxng/openai-page2.json"),
    );
    const responses = new Map<string, z.infer<typeof searchPageSchema>>([
      ["openai|1", pageOpenAI1],
      ["openai|2", pageOpenAI2],
    ]);

    const openAiExpectedWindow = [
      ...pageOpenAI1.results,
      ...pageOpenAI2.results,
    ].slice(1, 3);

    Reflect.set(globalThis, "fetch", async (input: string | Request | URL) => {
      const url = new URL(inputUrl(input));
      const q = url.searchParams.get("q") ?? "";
      const page = Number(url.searchParams.get("pageno") ?? "1");
      const key = `${q}|${page}`;
      const body = responses.get(key);
      if (body === undefined) {
        return new Response(
          JSON.stringify({ error: `unexpected key ${key}` }),
          { status: 500 },
        );
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { websearch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await websearch.execute(
      {
        query: "openai",
        num_results: 2,
        offset: 1,
      },
      context,
    );

    expect(context.asks).toHaveLength(1);
    expect(context.asks[0]).toEqual({
      permission: "websearch",
      patterns: ["openai"],
      always: ["*"],
      metadata: {
        query: "openai",
      },
    });

    expect(context.metadatas).toHaveLength(1);
    expect(context.metadatas[0]).toEqual({
      title: "Web search: openai",
      metadata: {
        num_results: 2,
      },
    });

    expect(output).toContain(
      "Tool passphrase: PASS_WEB_SEARCH_SHADOW_20260305_6A9F",
    );
    expect(output).toContain("Showing results: 2-3 of 0");
    expect(output).toContain(openAiExpectedWindow[0]?.url ?? "");
    expect(output).toContain(openAiExpectedWindow[1]?.url ?? "");
  });

  it("returns validation errors for invalid category and offset", async () => {
    Reflect.set(globalThis, "fetch", async () =>
      new Response(
        JSON.stringify({
          query: "unused",
          number_of_results: 0,
          results: [],
          answers: [],
          suggestions: [],
          unresponsive_engines: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));

    const { websearch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await websearch.execute(
      {
        query: "unused",
        category: "invalid_category",
      },
      context,
    );

    expect(output).toContain(
      "Tool passphrase: PASS_WEB_SEARCH_SHADOW_20260305_6A9F",
    );
    expect(output).toContain(`Invalid category: "invalid_category".`);
    expect(output).toContain(
      "Allowed categories: news, it, npm, pypi, st, gh, hf, ollama, hn, science, arx, cr, gos, se, aa, lg.",
    );
  });

  it("writes oversized webfetch content to /tmp and reports saved path", async () => {
    const largeText = fixtureText("wikipedia/fourier-transform.converted.md");
    const largePrefix = largeText.slice(0, 600).trim();
    const writes: Array<{ path: string; content: string }> = [];

    Reflect.set(Bun, "spawn", () => ({
      stdout: streamFromText(largeText),
      stderr: streamFromText(""),
      exited: Promise.resolve(0),
    }));

    Reflect.set(Bun, "write", async (path: string, content: string) => {
      writes.push({ path: String(path), content: String(content) });
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://example.com/big",
      },
      context,
    );

    expect(context.asks).toHaveLength(1);
    expect(context.asks[0]).toEqual({
      permission: "webfetch",
      patterns: ["https://example.com/big"],
      always: ["*"],
      metadata: {
        url: "https://example.com/big",
      },
    });

    expect(context.metadatas).toHaveLength(1);
    expect(context.metadatas[0]?.title).toBe("Web fetch: example.com/big");

    expect(writes).toHaveLength(2);
    const oversizedWrite = writes.find((item) =>
      item.path.startsWith("/tmp/webfetch-"),
    );
    const cacheWrite = writes.find((item) => item.path.endsWith(".json"));
    expect(oversizedWrite).toBeDefined();
    expect(cacheWrite).toBeDefined();
    expect(oversizedWrite!.content).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(oversizedWrite!.content).toContain(`Route: default`);
    expect(oversizedWrite!.content).toContain(
      "Source URL: https://example.com/big",
    );
    expect(oversizedWrite!.content).toContain(largePrefix);

    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: default");
    expect(output).toContain(
      "Full report exceeds inline limit (20000 tokens).",
    );
    expect(output).toContain(`Saved full content: ${oversizedWrite!.path}`);
    expect(output).toContain("Token count:");
  });

  it("downloads PDFs to a temp file instead of piping raw bytes through w3m", async () => {
    const calls: string[][] = [];

    Reflect.set(Bun, "spawn", (args: string[]) => {
      calls.push(args);
      const script = args[2] ?? "";

      if (script.includes("curl -sSIL")) {
        return {
          stdout: streamFromText(
            [
              "HTTP/2 200",
              "content-type: application/pdf",
              "content-length: 13264",
              "",
            ].join("\n"),
          ),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }

      if (script.includes('curl -sSL --compressed --max-time 30 -o "$outfile"')) {
        return {
          stdout: streamFromText("/tmp/webfetch-pdf-abcd12/document.pdf\n"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: streamFromText(""),
        stderr: streamFromText(`unexpected command: ${script}`),
        exited: Promise.resolve(1),
      };
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng", {
      webfetchCacheEnabled: "0",
    });
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      },
      context,
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.[2]).toContain("curl -sSIL");
    expect(calls[1]?.[2]).toContain('curl -sSL --compressed --max-time 30 -o "$outfile"');
    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: default/binary-pdf");
    expect(output).toContain(
      "Binary content detected: application/pdf.",
    );
    expect(output).toContain("Saved PDF: /tmp/webfetch-pdf-abcd12/document.pdf");
    expect(output).toContain("Content-Length: 13264 bytes");
  });

  it("routes youtube URLs through transcript extraction pipeline", async () => {
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const vtt = fixtureText("youtube/dQw4w9WgXcQ.en.vtt");

    Reflect.set(Bun, "spawn", (args: string[]) => {
      if (
        args[0] === "uvx" &&
        args.includes("yt-dlp") &&
        args.includes("--list-subs")
      ) {
        return {
          stdout: streamFromText(listSubs),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }

      if (
        args[0] === "uvx" &&
        args.includes("yt-dlp") &&
        args.includes("--write-subs")
      ) {
        const outputIndex = args.indexOf("-o");
        const template = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
        if (template !== undefined) {
          const dir = dirname(template);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, "dQw4w9WgXcQ.en.vtt"), vtt);
        }
        return {
          stdout: streamFromText(
            fixtureText("youtube/dQw4w9WgXcQ.write-subs.out"),
          ),
          stderr: streamFromText(
            fixtureText("youtube/dQw4w9WgXcQ.write-subs.err"),
          ),
          exited: Promise.resolve(0),
        };
      }

      return { exited: Promise.resolve(1) };
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      context,
    );

    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: youtube");
    expect(output).toContain("# YouTube Transcript");
    expect(output).toContain("We're no strangers to");
  });

  it("routes wikipedia URLs through parse API and markdown conversion", async () => {
    const parseFixture = fixtureJson("wikipedia/parse-fourier-transform.json");
    const converted = fixtureText("wikipedia/fourier-transform.converted.md");
    const convertedShort = converted.split("\n").slice(0, 120).join("\n");

    Reflect.set(globalThis, "fetch", async () => {
      return new Response(JSON.stringify(parseFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    Reflect.set(Bun, "spawn", () => ({
      stdout: streamFromText(convertedShort),
      stderr: streamFromText(""),
      exited: Promise.resolve(0),
    }));

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://en.wikipedia.org/wiki/Fourier_transform",
      },
      context,
    );

    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: wikipedia");
    expect(output).toContain("# Fourier transform");
  });

  it("uses webfetch cache on repeated URL requests with cache enabled", async () => {
    const tempRoot = await mkdtemp("/tmp/opencode-webfetch-cache-test-");
    const cacheDir = join(tempRoot, "cache");
    const calls: string[][] = [];

    try {
      Reflect.set(Bun, "spawn", (args: string[]) => {
        calls.push(args);
        return {
          stdout: streamFromText("cached page content"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      });

      const { webfetch } = await loadPlugin("http://localhost/searxng", {
        webfetchCacheEnabled: "1",
        webfetchCacheDir: cacheDir,
        webfetchCacheTtlDays: "90",
      });
      const context = buildContext();

      const first = await webfetch.execute(
        {
          url: "https://example.com/cache-me",
        },
        context,
      );
      const second = await webfetch.execute(
        {
          url: "https://example.com/cache-me",
        },
        context,
      );

      expect(calls).toHaveLength(2);
      expect(first).toContain("Route: default");
      expect(second).toContain("Route: default/cache");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refreshes plugin-wide webfetch cache entries when overwrite_cache is true", async () => {
    const tempRoot = await mkdtemp("/tmp/opencode-webfetch-cache-refresh-test-");
    const cacheDir = join(tempRoot, "cache");
    const pages = ["first page content", "refreshed page content"];
    let pageIndex = 0;
    const calls: string[][] = [];

    try {
      Reflect.set(Bun, "spawn", (args: string[]) => {
        calls.push(args);
        const command = args[2] ?? "";
        if (command.includes("curl -sSIL")) {
          return {
            stdout: streamFromText("HTTP/2 200\r\ncontent-type: text/html\r\ncontent-length: 18\r\n"),
            stderr: streamFromText(""),
            exited: Promise.resolve(0),
          };
        }
        const page = pages[Math.min(pageIndex, pages.length - 1)]!;
        pageIndex += 1;
        return {
          stdout: streamFromText(page),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      });

      const { webfetch } = await loadPlugin("http://localhost/searxng", {
        webfetchCacheEnabled: "1",
        webfetchCacheDir: cacheDir,
        webfetchCacheTtlDays: "90",
      });
      const context = buildContext();

      const first = await webfetch.execute(
        {
          url: "https://example.com/cache-refresh",
        },
        context,
      );
      expect(calls).toHaveLength(2);
      const refreshed = await webfetch.execute(
        {
          url: "https://example.com/cache-refresh",
          overwrite_cache: true,
        },
        context,
      );
      expect(calls).toHaveLength(4);
      expect(first).toContain("Route: default");
      expect(refreshed).toContain("Route: default");
      expect(refreshed).toContain("refreshed page content");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("bypasses generic webfetch cache for arxiv URLs and builds the local library", async () => {
    const tempRoot = await mkdtemp("/tmp/opencode-webfetch-arxiv-bypass-test-");
    const cacheDir = join(tempRoot, "cache");
    const libraryDir = join(tempRoot, "library");
    const arxivUrl = "https://arxiv.org/abs/2401.12345";
    const cachePath = join(cacheDir, `${createHash("sha256").update(arxivUrl).digest("hex")}.json`);

    process.env.WEBFETCH_ARXIV_LIBRARY_DIR = libraryDir;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        url: arxivUrl,
        routeName: "default",
        sourceUrl: arxivUrl,
        content: "stale cached arxiv page",
        cachedAt: new Date("2026-03-09T00:00:00Z").toISOString(),
      }),
    );

    try {
      Reflect.set(globalThis, "fetch", async (input: string | Request | URL) => {
        if (inputUrl(input).includes("/api/query")) {
          return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v3</id>
    <title>Distributionally Robust Receive Combining</title>
    <updated>2025-06-17T20:37:32Z</updated>
    <published>2024-01-22T19:00:00Z</published>
    <author><name>Alice Example</name></author>
    <summary>This article investigates signal estimation in wireless transmission.</summary>
    <category term="eess.SP"/>
  </entry>
</feed>`, { status: 200 });
        }
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
      });

      Reflect.set(Bun, "spawn", (args: string[]) => {
        if (args[0] === "pandoc") {
          const outputIndex = args.indexOf("--output");
          const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (outputPath !== undefined) {
            writeFileSync(outputPath, args.includes("--to=gfm") ? "# arxiv markdown\n" : "<html></html>\n");
          }
        }
        return { exited: Promise.resolve(0), stdout: streamFromText(""), stderr: streamFromText("") };
      });

      const { webfetch } = await loadPlugin("http://localhost/searxng", {
        webfetchCacheEnabled: "1",
        webfetchCacheDir: cacheDir,
      });
      const context = buildContext();

      const output = await webfetch.execute(
        {
          url: arxivUrl,
        },
        context,
      );

      expect(output).toContain("Route: arxiv/library");
      expect(output).toContain("Local arXiv library status: built");
      expect(output).not.toContain("stale cached arxiv page");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("routes github URLs through gh handler commands", async () => {
    const issueFixture = fixtureText("github/issue-14460.json");

    Reflect.set(Bun, "spawn", () => ({
      stdout: streamFromText(issueFixture),
      stderr: streamFromText(""),
      exited: Promise.resolve(0),
    }));

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://github.com/anomalyco/opencode/issues/8094",
      },
      context,
    );

    expect(output).toContain("Route: github");
    expect(output).toContain('"number":14460');
  });

  it("explains arxiv 429 as capacity-related", async () => {
    Reflect.set(Bun, "spawn", (args: string[]) => {
      const script = args[2] ?? "";
      if (script.includes("curl -sSIL")) {
        return {
          stdout: streamFromText("HTTP/2 429\ncontent-type: text/plain\n\n"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: streamFromText("ArXiv fallback content"),
        stderr: streamFromText(""),
        exited: Promise.resolve(0),
      };
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://export.arxiv.org/api/query?search_query=all:electron",
      },
      context,
    );

    expect(output).toContain("arXiv API case: `429 Rate exceeded`.");
    expect(output).toContain("ArXiv fallback content");
  });

  it("explains arxiv 503 as excessive-use signal", async () => {
    Reflect.set(Bun, "spawn", (args: string[]) => {
      const script = args[2] ?? "";
      if (script.includes("curl -sSIL")) {
        return {
          stdout: streamFromText("HTTP/2 503\ncontent-type: text/plain\n\n"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }
      return { exited: Promise.resolve(0), stdout: streamFromText(""), stderr: streamFromText("") };
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://export.arxiv.org/api/query?search_query=all:quantum",
      },
      context,
    );

    expect(output).toContain("arXiv API case: `503 Service Unavailable`.");
  });
});
