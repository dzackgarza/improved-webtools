import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

function fixtureJson<T>(relativePath: string): T {
  return JSON.parse(fixtureText(relativePath)) as T;
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
  if (options?.webfetchCacheTtlDays) {
    process.env.WEBFETCH_CACHE_TTL_DAYS = options.webfetchCacheTtlDays;
  } else {
    delete process.env.WEBFETCH_CACHE_TTL_DAYS;
  }
  const mod = await import(
    new URL(
      `../../src/index.ts?ts=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href
  );

  const client = {
    app: {
      log: async () => {},
    },
  };

  const plugin = await mod.ImprovedWebSearchPlugin({ client } as any);
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
  const originalPdfMaxBytes = process.env.WEBFETCH_PDF_MAX_BYTES;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalSpawn;
    (Bun as any).write = originalWrite;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalSpawn;
    (Bun as any).write = originalWrite;
    if (originalSearxngUrl === undefined)
      delete process.env.SEARXNG_INSTANCE_URL;
    else process.env.SEARXNG_INSTANCE_URL = originalSearxngUrl;
    if (originalCacheEnabled === undefined)
      delete process.env.WEBFETCH_CACHE_ENABLED;
    else process.env.WEBFETCH_CACHE_ENABLED = originalCacheEnabled;
    if (originalCacheDir === undefined) delete process.env.WEBFETCH_CACHE_DIR;
    else process.env.WEBFETCH_CACHE_DIR = originalCacheDir;
    if (originalCacheTtlDays === undefined)
      delete process.env.WEBFETCH_CACHE_TTL_DAYS;
    else process.env.WEBFETCH_CACHE_TTL_DAYS = originalCacheTtlDays;
    if (originalArxivLibraryDir === undefined)
      delete process.env.WEBFETCH_ARXIV_LIBRARY_DIR;
    else process.env.WEBFETCH_ARXIV_LIBRARY_DIR = originalArxivLibraryDir;
    if (originalPdfMaxBytes === undefined) delete process.env.WEBFETCH_PDF_MAX_BYTES;
    else process.env.WEBFETCH_PDF_MAX_BYTES = originalPdfMaxBytes;
  });

  it("formats websearch results with pagination", async () => {
    const pageOpenAI1 = fixtureJson<{
      results: Array<Record<string, unknown>>;
    }>("searxng/openai-page1.json");
    const pageOpenAI2 = fixtureJson<{
      results: Array<Record<string, unknown>>;
    }>("searxng/openai-page2.json");
    const responses = new Map<string, unknown>([
      ["openai|1", pageOpenAI1 as unknown],
      ["openai|2", pageOpenAI2 as unknown],
    ]);

    const openAiExpectedWindow = [
      ...pageOpenAI1.results,
      ...pageOpenAI2.results,
    ].slice(1, 3);

    (globalThis as any).fetch = async (input: string | Request | URL) => {
      const url = new URL(String(input));
      const q = url.searchParams.get("q") ?? "";
      const page = Number(url.searchParams.get("pageno") ?? "1");
      const key = `${q}|${page}`;
      const body = responses.get(key);
      if (!body) {
        return new Response(
          JSON.stringify({ error: `unexpected key ${key}` }),
          { status: 500 },
        );
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const { websearch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await websearch.execute(
      {
        query: "openai",
        num_results: 2,
        offset: 1,
      },
      context as any,
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
    expect(output).toContain(String(openAiExpectedWindow[0]?.url ?? ""));
    expect(output).toContain(String(openAiExpectedWindow[1]?.url ?? ""));
  });

  it("returns validation errors for invalid category and offset", async () => {
    (globalThis as any).fetch = async () =>
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
      );

    const { websearch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await websearch.execute(
      {
        query: "unused",
        category: "invalid_category",
      },
      context as any,
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

    (Bun as any).spawn = () => ({
      stdout: streamFromText(largeText),
      stderr: streamFromText(""),
      exited: Promise.resolve(0),
    });

    (Bun as any).write = async (path: string, content: string) => {
      writes.push({ path: String(path), content: String(content) });
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://example.com/big",
      },
      context as any,
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

  it("downloads PDFs and extracts PDF content into Markdown", async () => {
    const calls: string[][] = [];

    (Bun as any).spawn = (args: string[]) => {
      calls.push(args);
      const script = args[2] ?? "";
      const command = args[0] ?? "";

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

      if (script.includes("--max-filesize 10485760") && script.includes('curl -sSL --compressed --max-time 30')) {
        mkdirSync("/tmp/webfetch-pdf-abcd12", { recursive: true });
        writeFileSync("/tmp/webfetch-pdf-abcd12/document.pdf", "x".repeat(13264));
        return {
          stdout: streamFromText("/tmp/webfetch-pdf-abcd12/document.pdf\n"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }

      if (command === "python3" && (args[1] ?? "").endsWith("/pdf_to_markdown.py")) {
        return {
          stdout: streamFromText("# PDF Title\n\nSome extracted markdown content.\n"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }

      return {
        stdout: streamFromText(""),
        stderr: streamFromText(`unexpected command: ${script}`),
        exited: Promise.resolve(1),
      };
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng", {
      webfetchCacheEnabled: "0",
    });
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      },
      context as any,
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]?.[2]).toContain("curl -sSIL");
    expect(calls[1]?.[2]).toContain("max-filesize");
    expect(calls[1]?.[2]).toContain('curl -sSL --compressed --max-time 30 --max-filesize 10485760 -o "$outfile"');
    expect(calls[2]?.[0]).toBe("python3");
    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: default/pdf");
    expect(output).toContain("PDF content detected: application/pdf.");
    expect(output).toContain("Saved PDF: /tmp/webfetch-pdf-abcd12/document.pdf");
    expect(output).toContain("Detected size: 13264 bytes.");
    expect(output).toContain("Converted to Markdown:");
    expect(output).toContain("# PDF Title");
    expect(output).toContain("Some extracted markdown content.");
    expect(output).toContain("Token count:");
  });

  it("rejects large PDFs for automatic extraction with a clear size message", async () => {
    process.env.WEBFETCH_PDF_MAX_BYTES = "10000";

    const calls: string[][] = [];

    (Bun as any).spawn = (args: string[]) => {
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

      return {
        stdout: streamFromText(""),
        stderr: streamFromText(`unexpected command: ${script}`),
        exited: Promise.resolve(1),
      };
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      },
      context as any,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[2]).toContain("curl -sSIL");
    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: default/pdf");
    expect(output).toContain("The file size exceeds the configured limit of 10000 bytes.");
  });

  it("routes reddit posts through apify and renders nested markdown comments", async () => {
    const apifyDataset = fixtureJson<Array<Record<string, unknown>>>(
      "reddit/apify-search-openai.json",
    );

    (Bun as any).spawn = (args: string[]) => {
      if (args[0] === "apify" && args[1] === "call") {
        return {
          stdout: streamFromText(JSON.stringify(apifyDataset)),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }
      return {
        stdout: streamFromText(""),
        stderr: streamFromText("unexpected command"),
        exited: Promise.resolve(1),
      };
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/",
      },
      context as any,
    );

    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: reddit");
    expect(output).toContain("# Reddit Post");
    expect(output).toContain("## Comments (nested)");
    expect(output).toContain("- u/The_GSingh (score 20):");
    expect(output).toContain("When is it even coming out");
  });

  it("routes youtube URLs through transcript extraction pipeline", async () => {
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const vtt = fixtureText("youtube/dQw4w9WgXcQ.en.vtt");

    (Bun as any).spawn = (args: string[]) => {
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
        if (template) {
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
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      context as any,
    );

    expect(output).toContain(
      "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2",
    );
    expect(output).toContain("Route: youtube");
    expect(output).toContain("# YouTube Transcript");
    expect(output).toContain("We're no strangers to");
  });

  it("routes wikipedia URLs through parse API and markdown conversion", async () => {
    const parseFixture = fixtureJson<Record<string, unknown>>(
      "wikipedia/parse-fourier-transform.json",
    );
    const converted = fixtureText("wikipedia/fourier-transform.converted.md");
    const convertedShort = converted.split("\n").slice(0, 120).join("\n");

    (globalThis as any).fetch = async () => {
      return new Response(JSON.stringify(parseFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    (Bun as any).spawn = () => ({
      stdout: streamFromText(convertedShort),
      stderr: streamFromText(""),
      exited: Promise.resolve(0),
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://en.wikipedia.org/wiki/Fourier_transform",
      },
      context as any,
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
      (Bun as any).spawn = (args: string[]) => {
        calls.push(args);
        return {
          stdout: streamFromText("cached page content"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      };

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
        context as any,
      );
      const second = await webfetch.execute(
        {
          url: "https://example.com/cache-me",
        },
        context as any,
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
      (Bun as any).spawn = (args: string[]) => {
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
      };

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
        context as any,
      );
      expect(calls).toHaveLength(2);
      const refreshed = await webfetch.execute(
        {
          url: "https://example.com/cache-refresh",
          overwrite_cache: true,
        },
        context as any,
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
      (globalThis as any).fetch = async (input: string | Request | URL) => {
        if (String(input).includes("/api/query")) {
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
      };

      (Bun as any).spawn = (args: string[]) => {
        if (args[0] === "pandoc") {
          const outputIndex = args.indexOf("--output");
          const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (outputPath) {
            writeFileSync(outputPath, args.includes("--to=gfm") ? "# arxiv markdown\n" : "<html></html>\n");
          }
        }
        return { exited: Promise.resolve(0), stdout: streamFromText(""), stderr: streamFromText("") };
      };

      const { webfetch } = await loadPlugin("http://localhost/searxng", {
        webfetchCacheEnabled: "1",
        webfetchCacheDir: cacheDir,
      });
      const context = buildContext();

      const output = await webfetch.execute(
        {
          url: arxivUrl,
        },
        context as any,
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

    (Bun as any).spawn = () => ({
      stdout: streamFromText(issueFixture),
      stderr: streamFromText(""),
      exited: Promise.resolve(0),
    });

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://github.com/anomalyco/opencode/issues/8094",
      },
      context as any,
    );

    expect(output).toContain("Route: github");
    expect(output).toContain('"number":14460');
  });

  it("explains arxiv 429 as capacity-related", async () => {
    (Bun as any).spawn = (args: string[]) => {
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
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://export.arxiv.org/api/query?search_query=all:electron",
      },
      context as any,
    );

    expect(output).toContain("arXiv API case: `429 Rate exceeded`.");
    expect(output).toContain("ArXiv fallback content");
  });

  it("explains arxiv 503 as excessive-use signal", async () => {
    (Bun as any).spawn = (args: string[]) => {
      const script = args[2] ?? "";
      if (script.includes("curl -sSIL")) {
        return {
          stdout: streamFromText("HTTP/2 503\ncontent-type: text/plain\n\n"),
          stderr: streamFromText(""),
          exited: Promise.resolve(0),
        };
      }
      return { exited: Promise.resolve(0), stdout: streamFromText(""), stderr: streamFromText("") };
    };

    const { webfetch } = await loadPlugin("http://localhost/searxng");
    const context = buildContext();

    const output = await webfetch.execute(
      {
        url: "https://export.arxiv.org/api/query?search_query=all:quantum",
      },
      context as any,
    );

    expect(output).toContain("arXiv API case: `503 Service Unavailable`.");
  });
});
