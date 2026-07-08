import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  extractArxivIdFromUrl,
  fetchArxivLibraryContent,
  buildGitHubCommandPlan,
  fetchGitHubContent,
  fetchRedditPostMarkdown,
  fetchStackExchangeMarkdown,
  fetchPackageRegistryMarkdown,
  fetchHackerNewsItemMarkdown,
  fetchHuggingFaceCardMarkdown,
  fetchXPostMarkdown,
  fetchWikipediaMarkdown,
  fetchYoutubeTranscriptMarkdown,
} from "@webfetch-handlers";

function fixtureText(relativePath: string): string {
  const path = new URL(`../../fixtures/real/${relativePath}`, import.meta.url);
  return readFileSync(path, "utf8");
}

function fixtureJson<T>(relativePath: string): T {
  return JSON.parse(fixtureText(relativePath)) as T;
}

function youtubeDependencyCheckOutput(overrides: Partial<Record<string, boolean>> = {}): string {
  const checks: Record<string, boolean> = {
    uvx: true,
    ffmpeg: true,
    ffprobe: true,
    bun: true,
    node: true,
    deno: true,
    ...overrides,
  };

  return Object.entries(checks)
    .map(([command, available]) => `DEP_CHECK:${command}:${available ? 1 : 0}`)
    .join("\n");
}

describe("webfetch handler modules", () => {
  const originalFetch = globalThis.fetch;
  const originalSpawn = Bun.spawn;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalSpawn;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (Bun as any).spawn = originalSpawn;
  });

  it("builds github issue plans and fetches via runner with real gh fixture output", async () => {
    const issueFixture = fixtureText("github/issue-14460.json");
    const plan = buildGitHubCommandPlan(new URL("https://github.com/anomalyco/opencode/issues/8094"));
    expect(plan.args).toEqual([
      "gh",
      "issue",
      "view",
      "8094",
      "--repo",
      "anomalyco/opencode",
      "--json",
      "number,title,body,author,comments,state,url,labels",
    ]);

    const output = await fetchGitHubContent({
      url: new URL("https://github.com/anomalyco/opencode/issues/8094"),
      runCommand: async () => ({ stdoutText: issueFixture, stderrText: "", exitCode: 0 }),
    });

    expect(output.routeName).toBe("github");
    expect(output.sourceUrl).toBe("https://github.com/anomalyco/opencode/issues/8094");
    const parsed = JSON.parse(output.content) as Record<string, unknown>;
    expect(parsed.number).toBe(14460);
    expect(parsed.state).toBe("OPEN");
    expect(typeof parsed.title).toBe("string");
    expect(Array.isArray(parsed.comments)).toBe(true);
  });

  it("builds github command plans across all supported URL scopes", () => {
    const cases: Array<{
      url: string;
      args: string[];
      sourceUrl: string;
    }> = [
      {
        url: "https://github.com/anomalyco/opencode/pull/144",
        args: ["gh", "pr", "view", "144", "--repo", "anomalyco/opencode", "--comments"],
        sourceUrl: "https://github.com/anomalyco/opencode/pull/144",
      },
      {
        url: "https://github.com/anomalyco/opencode/blob/main/packages/opencode/src/index.ts",
        args: [
          "gh",
          "api",
          "repos/anomalyco/opencode/contents/packages/opencode/src/index.ts",
          "-f",
          "ref=main",
          "-H",
          "Accept: application/vnd.github.raw+json",
        ],
        sourceUrl: "https://github.com/anomalyco/opencode/blob/main/packages/opencode/src/index.ts",
      },
      {
        url: "https://github.com/anomalyco/opencode/commit/27c8fa5",
        args: ["gh", "api", "repos/anomalyco/opencode/commits/27c8fa5"],
        sourceUrl: "https://github.com/anomalyco/opencode/commit/27c8fa5",
      },
      {
        url: "https://github.com/anomalyco/opencode/releases",
        args: ["gh", "release", "list", "--repo", "anomalyco/opencode", "--limit", "20"],
        sourceUrl: "https://github.com/anomalyco/opencode/releases",
      },
      {
        url: "https://github.com/anomalyco/opencode/issues",
        args: ["gh", "issue", "list", "--repo", "anomalyco/opencode", "--limit", "30"],
        sourceUrl: "https://github.com/anomalyco/opencode/issues",
      },
      {
        url: "https://github.com/anomalyco/opencode/pulls",
        args: ["gh", "pr", "list", "--repo", "anomalyco/opencode", "--limit", "30"],
        sourceUrl: "https://github.com/anomalyco/opencode/pulls",
      },
      {
        url: "https://github.com/anomalyco/opencode",
        args: ["gh", "repo", "view", "anomalyco/opencode", "--readme"],
        sourceUrl: "https://github.com/anomalyco/opencode",
      },
      {
        url: "https://github.com/anomalyco",
        args: ["gh", "search", "repos", "anomalyco", "--limit", "20"],
        sourceUrl: "https://github.com/anomalyco",
      },
    ];

    for (const testCase of cases) {
      const plan = buildGitHubCommandPlan(new URL(testCase.url));
      expect(plan).toEqual({
        args: testCase.args,
        sourceUrl: testCase.sourceUrl,
      });
    }
  });

  it("renders reddit post/comment markdown from real apify dataset fixture", async () => {
    const fixture = fixtureJson<Array<Record<string, unknown>>>("reddit/apify-search-openai.json");
    const fixtureRaw = JSON.stringify(fixture);

    expect(Array.isArray(fixture)).toBe(true);
    expect(fixture[0]?.record_type).toBe("post");
    expect(typeof fixture[0]?.permalink).toBe("string");
    expect(fixture.some((item) => item.record_type === "comment")).toBe(true);

    const output = await fetchRedditPostMarkdown({
      url: new URL("https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/"),
      apifyActor: "mock/actor",
      runCommand: async () => ({ stdoutText: fixtureRaw, stderrText: "", exitCode: 0 }),
      fetchFallbackWithW3M: async () => ({ stdoutText: "unexpected fallback", stderrText: "", exitCode: 0 }),
    });

    expect(output.routeName).toBe("reddit");
    expect(output.sourceUrl).toBe("https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/");
    expect(output.content).toContain("# Reddit Post");
    expect(output.content).toContain("Anyone Else Excited for o3 Mini Release?");
    expect(output.content).toContain("## Comments (nested)");
    expect(output.content).toContain("- u/The_GSingh (score 20):");
    expect(output.content).toContain("  - u/Thinklikeachef (score 13):");
  });

  it("uses reddit fallback path when URL is not a post permalink", async () => {
    const output = await fetchRedditPostMarkdown({
      url: new URL("https://www.reddit.com/r/test"),
      apifyActor: "mock/actor",
      runCommand: async () => ({ stdoutText: "", stderrText: "", exitCode: 0 }),
      fetchFallbackWithW3M: async () => ({ stdoutText: "fallback text", stderrText: "", exitCode: 0 }),
    });

    expect(output.routeName).toBe("reddit");
    expect(output.sourceUrl).toBe("https://www.reddit.com/r/test");
    expect(output.content).toBe("fallback text");
  });

  it("extracts youtube captions from real yt-dlp subtitle fixture", async () => {
    const calls: string[][] = [];
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const vtt = fixtureText("youtube/dQw4w9WgXcQ.en.vtt");

    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://youtu.be/dQw4w9WgXcQ"),
      runCommand: async (args) => {
        calls.push(args);
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }

        if (args.includes("--list-subs")) {
          return { stdoutText: listSubs, stderrText: "", exitCode: 0 };
        }

        if (args.includes("--write-subs")) {
          const outputIndex = args.indexOf("-o");
          const template = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (template) {
            const slash = template.lastIndexOf("/");
            const dir = slash >= 0 ? template.slice(0, slash) : ".";
            await Bun.$`mkdir -p ${dir}`.quiet();
            await Bun.write(`${dir}/dQw4w9WgXcQ.en.vtt`, vtt);
          }
          return { stdoutText: fixtureText("youtube/dQw4w9WgXcQ.write-subs.out"), stderrText: "", exitCode: 0 };
        }

        return { stdoutText: "", stderrText: "unexpected", exitCode: 1 };
      },
    });

    expect(calls.some((args) => args.includes("--list-subs"))).toBe(true);
    expect(calls.some((args) => args.includes("--write-subs"))).toBe(true);
    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("We're no strangers to");
    expect(output.content).toContain("00:00:21.790 We're no strangers to");
  });

  it("parses legacy and note-block WebVTT forms without leaking cue IDs or NOTE metadata", async () => {
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const legacyVtt = `WEBVTT

NOTE
This is a parser-level note.
Keep this hidden.

caption-id-001
00:18.800 --> 00:20.000
First visible line
Second visible line

NOTE this inline note starts a block
should not leak

100:00:18.800 --> 100:00:20.000
Long-hour timestamp should parse too`;

    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://youtu.be/dQw4w9WgXcQ"),
      runCommand: async (args) => {
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }

        if (args.includes("--list-subs")) {
          return { stdoutText: listSubs, stderrText: "", exitCode: 0 };
        }

        if (args.includes("--write-subs")) {
          const outputIndex = args.indexOf("-o");
          const template = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (template) {
            const slash = template.lastIndexOf("/");
            const dir = slash >= 0 ? template.slice(0, slash) : ".";
            await Bun.$`mkdir -p ${dir}`.quiet();
            await Bun.write(`${dir}/dQw4w9WgXcQ.en.vtt`, legacyVtt);
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }

        return { stdoutText: "", stderrText: "unexpected", exitCode: 1 };
      },
    });

    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("00:18.800 First visible line Second visible line");
    expect(output.content).toContain("100:00:18.800 Long-hour timestamp should parse too");
    expect(output.content).not.toContain("caption-id-001");
    expect(output.content).not.toContain("parser-level note");
    expect(output.content).not.toContain("should not leak");
  });

  it("preserves every cue line, including repeated timestamps", async () => {
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const duplicateVtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
first line

00:00:01.000 --> 00:00:02.000
first line

00:00:02.000 --> 00:00:03.000
second line`;

    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://youtu.be/dQw4w9WgXcQ"),
      runCommand: async (args) => {
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }

        if (args.includes("--list-subs")) {
          return { stdoutText: listSubs, stderrText: "", exitCode: 0 };
        }

        if (args.includes("--write-subs")) {
          const outputIndex = args.indexOf("-o");
          const template = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (template) {
            const slash = template.lastIndexOf("/");
            const dir = slash >= 0 ? template.slice(0, slash) : ".";
            await Bun.$`mkdir -p ${dir}`.quiet();
            await Bun.write(`${dir}/dQw4w9WgXcQ.en.vtt`, duplicateVtt);
          }
          return { stdoutText: fixtureText("youtube/dQw4w9WgXcQ.write-subs.out"), stderrText: "", exitCode: 0 };
        }

        return { stdoutText: "", stderrText: "unexpected", exitCode: 1 };
      },
    });

    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("00:00:01.000 first line");
    const lines = output.content.split("\n").filter((line) => line.includes("first line"));
    expect(lines).toHaveLength(2);
  });

  it("passes an optional yt-dlp cookies file to youtube commands", async () => {
    const originalCookiesFile = process.env.YTDLP_COOKIES_FILE;
    process.env.YTDLP_COOKIES_FILE = "/tmp/test-youtube-cookies.txt";
    const calls: string[][] = [];

    try {
      await fetchYoutubeTranscriptMarkdown({
        url: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        runCommand: async (args) => {
          calls.push(args);
          if (args[0] === "sh" && args[1] === "-lc") {
            if (args[2]?.includes("DEP_CHECK:")) {
              return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
            }
            return { stdoutText: "", stderrText: "", exitCode: 0 };
          }
          return {
            stdoutText: "",
            stderrText: "video unavailable",
            exitCode: 1,
          };
        },
      });

      expect(calls.length).toBeGreaterThan(1);
      const commandCall = calls.find((args) => args.includes("--cookies"));
      expect(commandCall).toBeDefined();
      expect(commandCall).toContain("/tmp/test-youtube-cookies.txt");
      expect(commandCall?.indexOf("--cookies")).toBeGreaterThan(commandCall?.indexOf("yt-dlp") ?? -1);
    } finally {
      if (originalCookiesFile === undefined) {
        delete process.env.YTDLP_COOKIES_FILE;
      } else {
        process.env.YTDLP_COOKIES_FILE = originalCookiesFile;
      }
    }
  });

  it("falls back to whisper transcript path using real whisper fixture text", async () => {
    const calls: string[][] = [];
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const whisperText = fixtureText("youtube/dQw4w9WgXcQ.whisper.txt");

    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      runCommand: async (args) => {
        calls.push(args);
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }

        if (args.includes("--list-subs")) {
          return { stdoutText: listSubs, stderrText: "", exitCode: 0 };
        }

        if (args.includes("--write-subs")) {
          // Simulate no subtitle artifact written, forcing audio+whisper path.
          return { stdoutText: fixtureText("youtube/dQw4w9WgXcQ.write-subs.out"), stderrText: "", exitCode: 0 };
        }

        if (args.includes("-x") && args.includes("--audio-format")) {
          const outputIndex = args.indexOf("-o");
          const template = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
          if (template) {
            const audioPath = template.replace("%(id)s.%(ext)s", "dQw4w9WgXcQ.mp3");
            mkdirSync(dirname(audioPath), { recursive: true });
            writeFileSync(audioPath, "mp3 fixture bytes");
          }
          return {
            stdoutText: fixtureText("youtube/dQw4w9WgXcQ.download-audio.out"),
            stderrText: fixtureText("youtube/dQw4w9WgXcQ.download-audio.err"),
            exitCode: 0,
          };
        }

        if (args[0] === "uvx" && args.includes("whisper")) {
          const outputDirIndex = args.indexOf("--output_dir");
          const outputDir = outputDirIndex >= 0 ? args[outputDirIndex + 1] : undefined;
          if (outputDir) {
            mkdirSync(outputDir, { recursive: true });
            writeFileSync(join(outputDir, "dQw4w9WgXcQ.txt"), whisperText);
          }
          return {
            stdoutText: fixtureText("youtube/dQw4w9WgXcQ.whisper.out"),
            stderrText: fixtureText("youtube/dQw4w9WgXcQ.whisper.err"),
            exitCode: 0,
          };
        }

        return { stdoutText: "", stderrText: "unexpected", exitCode: 1 };
      },
    });

    expect(calls.some((args) => args.includes("--list-subs"))).toBe(true);
    expect(calls.some((args) => args.includes("--write-subs"))).toBe(true);
    expect(calls.some((args) => args.includes("-x") && args.includes("--audio-format"))).toBe(true);
    expect(calls.some((args) => args[0] === "uvx" && args.includes("whisper"))).toBe(true);
    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("Source: Whisper transcription (English)");
    expect(output.content).toContain("Never gonna let you down");
  });

  it("fetches wikipedia parse API then converts through external script runner using real parse fixture", async () => {
    const parseFixture = fixtureJson<Record<string, unknown>>("wikipedia/parse-fourier-transform.json");
    const converted = fixtureText("wikipedia/fourier-transform.converted.md");

    const fetchCalls: Array<{ url: string; userAgent?: string }> = [];
    (globalThis as any).fetch = async (input: string | Request | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        userAgent:
          (init?.headers as Record<string, string> | undefined)?.["User-Agent"] ??
          (init?.headers as Record<string, string> | undefined)?.["user-agent"],
      });
      return new Response(JSON.stringify(parseFixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const runCalls: string[][] = [];
    const output = await fetchWikipediaMarkdown({
      url: new URL("https://en.wikipedia.org/wiki/Fourier_transform"),
      userAgent: "test-agent",
      converterScriptPath: "/tmp/mock_converter.py",
      convertTimeoutMs: 120000,
      runCommand: async (args) => {
        runCalls.push(args);
        return {
          stdoutText: converted,
          stderrText: "",
          exitCode: 0,
        };
      },
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toContain("/w/api.php?action=parse");
    expect(fetchCalls[0]?.userAgent).toBe("test-agent");
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0]?.[0]).toBe("uvx");
    expect(runCalls[0]).toContain("python");
    expect(runCalls[0]).toContain("/tmp/mock_converter.py");
    expect(output.routeName).toBe("wikipedia");
    expect(output.sourceUrl).toBe("https://en.wikipedia.org/wiki/Fourier_transform");
    expect(output.content).toContain("# Fourier transform");
    expect(output.content).toContain("In [mathematics](https://en.wikipedia.org/wiki/Mathematics");
  });

  it("supports wikipedia index.php title URLs and normalizes source URL", async () => {
    const parseFixture = fixtureJson<Record<string, unknown>>("wikipedia/parse-wave-equation.json");
    const converted = fixtureText("wikipedia/wave-equation.converted.md");
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(parseFixture), { status: 200, headers: { "content-type": "application/json" } });

    const output = await fetchWikipediaMarkdown({
      url: new URL("https://en.wikipedia.org/w/index.php?title=Wave_equation"),
      userAgent: "test-agent",
      converterScriptPath: "/tmp/mock_converter.py",
      convertTimeoutMs: 120000,
      runCommand: async () => ({
        stdoutText: converted,
        stderrText: "",
        exitCode: 0,
      }),
    });

    expect(output.routeName).toBe("wikipedia");
    expect(output.sourceUrl).toBe("https://en.wikipedia.org/wiki/Wave_equation");
    expect(output.content).toContain("# Wave equation");
    expect(output.content).toContain("The **wave equation** is a second-order linear");
  });

  it("returns subtitle-discovery failure report with real bot-check stderr fixture", async () => {
    const botCheckError = fixtureText("youtube/8S0FDjFBj8o.list-subs.err");
    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://www.youtube.com/watch?v=8S0FDjFBj8o"),
      runCommand: async (args) => {
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }
        if (args.includes("--list-subs")) {
          return { stdoutText: fixtureText("youtube/8S0FDjFBj8o.list-subs.out"), stderrText: botCheckError, exitCode: 1 };
        }
        return { stdoutText: "", stderrText: "", exitCode: 0 };
      },
    });

    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("Transcript extraction failed at subtitle discovery.");
    expect(output.content).toContain("Sign in to confirm you’re not a bot");
  });

  it("returns audio-stage failure report using real yt-dlp stderr fixture text", async () => {
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const audioErr = fixtureText("youtube/dQw4w9WgXcQ.download-audio.err");
    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      runCommand: async (args) => {
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }
        if (args.includes("--list-subs")) {
          return { stdoutText: listSubs, stderrText: "", exitCode: 0 };
        }
        if (args.includes("--write-subs")) {
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }
        if (args.includes("-x") && args.includes("--audio-format")) {
          return { stdoutText: "", stderrText: audioErr, exitCode: 1 };
        }
        return { stdoutText: "", stderrText: "", exitCode: 0 };
      },
    });

    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("Transcript extraction failed at audio download stage.");
    expect(output.content).toContain("Reason:");
  });

  it("returns a dependency checklist when required tools are missing", async () => {
    const listSubs = fixtureText("youtube/dQw4w9WgXcQ.list-subs.txt");
    const dependencyCalls: string[][] = [];

    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      runCommand: async (args) => {
        if (args[0] === "sh" && args[1] === "-lc") {
          dependencyCalls.push(args);
          if (args[2]?.includes("DEP_CHECK:")) {
            return {
              stdoutText: youtubeDependencyCheckOutput({ uvx: false, bun: false, node: false, deno: false, ffmpeg: false, ffprobe: false }),
              stderrText: "",
              exitCode: 0,
            };
          }
          return {
            stdoutText: "",
            stderrText: "",
            exitCode: 1,
          };
        }
        return { stdoutText: listSubs, stderrText: "", exitCode: 1 };
      },
    });

    expect(output.routeName).toBe("youtube");
    expect(output.content).toContain("Missing required dependencies:");
    expect(output.content).toContain("uvx");
    expect(output.content).toContain("bun | node | deno");
    expect(output.content).toContain("ffmpeg");
    expect(output.content).toContain("ffprobe");
    expect(dependencyCalls.length).toBe(1);
  });

  it("sanitizes cookies path from dependency and extractor failures", async () => {
    const originalCookiesFile = process.env.YTDLP_COOKIES_FILE;
    process.env.YTDLP_COOKIES_FILE = "/tmp/secret-cookie-path.txt";
    const output = await fetchYoutubeTranscriptMarkdown({
      url: new URL("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      runCommand: async (args) => {
        if (args[0] === "sh" && args[1] === "-lc") {
          if (args[2]?.includes("DEP_CHECK:")) {
            return { stdoutText: youtubeDependencyCheckOutput(), stderrText: "", exitCode: 0 };
          }
          return { stdoutText: "", stderrText: "", exitCode: 0 };
        }
        if (args.includes("--list-subs")) {
          return {
            stdoutText: "",
            stderrText: "Using cookies from /tmp/secret-cookie-path.txt",
            exitCode: 1,
          };
        }
        return { stdoutText: "", stderrText: "", exitCode: 0 };
      },
    });

    expect(output.content).toContain("Transcript extraction failed at subtitle discovery.");
    expect(output.content).toContain("Reason: Using cookies from [redacted-cookies-file]");
    expect(output.content).not.toContain("/tmp/secret-cookie-path.txt");
    if (originalCookiesFile === undefined) {
      delete process.env.YTDLP_COOKIES_FILE;
    } else {
      process.env.YTDLP_COOKIES_FILE = originalCookiesFile;
    }
  });

  it("fetches stackexchange question and top answers with accepted-marking fallback", async () => {
    const stackExchangeQuestionResponse = {
      items: [
        {
          question_id: 123,
          title: "Why is this package useful?",
          body: "<p>Explain the package design.</p>",
          score: 72,
          answer_count: 2,
          accepted_answer_id: 999,
          tags: ["typescript", "design"],
        },
      ],
    };

    const stackExchangeAnswersResponse = {
      items: [
        {
          answer_id: 101,
          score: 18,
          is_accepted: false,
          owner: { display_name: "alice" },
          body: "<p>Use the <b>core APIs</b>.</p>",
        },
        {
          answer_id: 999,
          score: 3,
          is_accepted: true,
          owner: { display_name: "bob" },
          body: "<p>Accepted answer with patch.</p>",
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: string | URL) => {
      const target = String(input);
      if (target.includes("/2.3/questions/123") && !target.includes("/answers")) {
        return new Response(JSON.stringify(stackExchangeQuestionResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (target.includes("/answers")) {
        return new Response(JSON.stringify(stackExchangeAnswersResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    };

    const output = await fetchStackExchangeMarkdown({
      url: new URL("https://stackoverflow.com/questions/123/why-is-this-package-useful"),
    });
    globalThis.fetch = originalFetch;

    expect(output.routeName).toBe("stackexchange");
    expect(output.content).toContain("# Stack Exchange: Why is this package useful?");
    expect(output.content).toContain("Top answers / accepted");
    expect(output.content).toContain("Answer 1 (top-voted)");
    expect(output.content).toContain("Answer 2 (accepted)");
    expect(output.content).toContain("Use the core APIs.");
    expect(output.content).toContain("Accepted answer with patch.");
    expect(output.content).toContain("alice");
    expect(output.content).toContain("bob");
  });

  it("renders package metadata from npm, pypi, and crates registries", async () => {
    const npmPayload = {
      name: "@scope/example",
      description: "Example package for tests",
      "dist-tags": {
        latest: "1.2.3",
      },
      time: {
        "1.2.3": "2026-06-01T00:00:00.000Z",
      },
      versions: {
        "1.2.3": {
          description: "Example version",
          dependencies: {
            "left-pad": "^1.3.0",
          },
          readme: "# Example\n\nA tiny example package.",
          license: "MIT",
        },
      },
      author: "Alice Example",
    };

    const pypiPayload = {
      info: {
        name: "requests",
        version: "2.32.3",
        summary: "HTTP for humans",
        requires_dist: ["charset_normalizer", "idna (>=3.4)"],
        requires_python: ">=3.8",
        license: "Apache-2.0",
        home_page: "https://requests.readthedocs.io/",
        author: "Kenneth Reitz",
        description: "A friendly HTTP library.",
        maintainer: "Kenneth Reitz",
      },
    };

    const cratesPayload = {
      crate: {
        name: "serde",
        description: "Serialization framework",
        max_stable_version: "1.0.200",
        updated_at: "2026-06-01T00:00:00.000Z",
        license: "MIT/Apache-2.0",
      },
      versions: [
        {
          num: "1.0.200",
          deps: [
            { name: "serde_derive", req: "^1.0", kind: "normal", optional: false },
            { name: "serde_json", req: "^1.0", kind: "normal", optional: true },
          ],
        },
      ],
    };

    const routeResponses = [
      {
        host: "registry.npmjs.org",
        body: JSON.stringify(npmPayload),
      },
      {
        host: "pypi.org",
        body: JSON.stringify(pypiPayload),
      },
      {
        host: "crates.io",
        body: JSON.stringify(cratesPayload),
      },
    ];

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: string | URL) => {
      const target = String(input);
      const matched = routeResponses.find((entry) => target.includes(entry.host));
      if (!matched) {
        return new Response("not found", { status: 404 });
      }
      return new Response(matched.body, { status: 200, headers: { "content-type": "application/json" } });
    };

    const npmResult = await fetchPackageRegistryMarkdown({
      url: new URL("https://www.npmjs.com/package/@scope/example"),
    });
    expect(npmResult.routeName).toBe("npm");
    expect(npmResult.content).toContain("# npm package");
    expect(npmResult.content).toContain("Package: @scope/example");
    expect(npmResult.content).toContain("Version: 1.2.3");
    expect(npmResult.content).toContain("- left-pad: ^1.3.0");

    const pypiResult = await fetchPackageRegistryMarkdown({ url: new URL("https://pypi.org/project/requests/") });
    expect(pypiResult.routeName).toBe("pypi");
    expect(pypiResult.content).toContain("# PyPI package");
    expect(pypiResult.content).toContain("Version: 2.32.3");
    expect(pypiResult.content).toContain("- charset_normalizer");

    const cratesResult = await fetchPackageRegistryMarkdown({
      url: new URL("https://crates.io/crates/serde"),
    });
    expect(cratesResult.routeName).toBe("crates");
    expect(cratesResult.content).toContain("# Cargo crate");
    expect(cratesResult.content).toContain("Crate: serde");
    expect(cratesResult.content).toContain("Version: 1.0.200");
    expect(cratesResult.content).toContain("serde_derive");
    expect(cratesResult.content).toContain("(optional)");

    globalThis.fetch = originalFetch;
  });

  it("renders HN nested comments as markdown", async () => {
    const itemPayload = {
      id: 555,
      title: "How does bundling work?",
      points: 42,
      author: "hacker-news-user",
      text: "How does this algorithm work?",
      created_at: "2026-06-01T00:00:00Z",
      url: "https://example.com",
      children: [
        {
          id: 1,
          author: "alice",
          text: "<p>Great question!</p>",
          points: 12,
          children: [
            {
              id: 2,
              author: "bob",
              text: "<p>Nested reply with details.</p>",
              points: 3,
            },
          ],
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: string | URL) =>
      new Response(JSON.stringify(itemPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const output = await fetchHackerNewsItemMarkdown({
      url: new URL("https://news.ycombinator.com/item?id=555"),
    });
    globalThis.fetch = originalFetch;

    expect(output.routeName).toBe("hackernews");
    expect(output.sourceUrl).toBe("https://news.ycombinator.com/item?id=555");
    expect(output.content).toContain("# Hacker News item");
    expect(output.content).toContain("Item ID: 555");
    expect(output.content).toContain("How does this algorithm work?");
    expect(output.content).toContain("u/alice");
    expect(output.content).toContain("Nested reply with details.");
  });

  it("renders huggingface card metadata and README", async () => {
    const apiPayload = {
      id: "meta-llama/Llama-3.2-1B",
      downloads: 1234,
      likes: 321,
      library_name: "transformers",
      pipeline_tag: "text-generation",
      cardData: {
        base_model: "llama",
        license: "Apache-2.0",
      },
      tags: ["text-generation", "llama"],
      siblings: [],
    };

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: string | URL) => {
      const target = String(input);
      if (target.includes("/api/models/")) {
        return new Response(JSON.stringify(apiPayload), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.includes("/resolve/main/README.md")) {
        return new Response("# Llama\n\nThis is a test README.", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const output = await fetchHuggingFaceCardMarkdown({
      url: new URL("https://huggingface.co/meta-llama/Llama-3.2-1B"),
    });
    globalThis.fetch = originalFetch;

    expect(output.routeName).toBe("huggingface");
    expect(output.content).toContain("# Hugging Face model");
    expect(output.content).toContain("ID: meta-llama/Llama-3.2-1B");
    expect(output.content).toContain("Pipeline: text-generation");
    expect(output.content).toContain("Base model: llama");
    expect(output.content).toContain("This is a test README.");
  });

  it("renders x/tweet via jina mirror and preserves conversation context", async () => {
    const mirrorPayload = [
      "# Post",
      "",
      "Original tweet body",
      "",
      "Replies (2)",
      "- reply one",
      "- reply two",
    ].join("\n");

    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(mirrorPayload, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });

    const output = await fetchXPostMarkdown({
      url: new URL("https://x.com/user/status/1234567890123456789"),
    });
    globalThis.fetch = originalFetch;

    expect(output.routeName).toBe("x");
    expect(output.content).toContain("Tweet ID: 1234567890123456789");
    expect(output.content).toContain("Original tweet body");
    expect(output.content).toContain("http://x.com/i/web/status/1234567890123456789?conversation=1");
  });

  it("throws for unsupported wikipedia URL shapes", async () => {
    await expect(
      fetchWikipediaMarkdown({
        url: new URL("https://en.wikipedia.org/"),
        userAgent: "test-agent",
        converterScriptPath: "/tmp/mock_converter.py",
        convertTimeoutMs: 120000,
        runCommand: async () => ({ stdoutText: "", stderrText: "", exitCode: 0 }),
      }),
    ).rejects.toThrow(Error);
  });

  it("throws for wikipedia parse API error payloads from real API fixture", async () => {
    const missingPage = fixtureJson<Record<string, unknown>>("wikipedia/parse-missing-page.json");
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify(missingPage), { status: 200, headers: { "content-type": "application/json" } });

    await expect(
      fetchWikipediaMarkdown({
        url: new URL("https://en.wikipedia.org/wiki/Does_Not_Exist"),
        userAgent: "test-agent",
        converterScriptPath: "/tmp/mock_converter.py",
        convertTimeoutMs: 120000,
        runCommand: async () => ({ stdoutText: "", stderrText: "", exitCode: 0 }),
      }),
    ).rejects.toThrow(Error);
  });

  it("normalizes arxiv IDs across supported URL shapes", () => {
    expect(extractArxivIdFromUrl(new URL("https://arxiv.org/abs/2401.12345v3"))).toBe("2401.12345");
    expect(extractArxivIdFromUrl(new URL("https://arxiv.org/pdf/2401.12345.pdf"))).toBe("2401.12345");
    expect(extractArxivIdFromUrl(new URL("https://arxiv.org/src/hep-th/9901001v2"))).toBe("hep-th/9901001");
    expect(extractArxivIdFromUrl(new URL("https://arxiv.org/abs/math.GT/0309136v1"))).toBe("math.GT/0309136");
    expect(extractArxivIdFromUrl(new URL("https://arxiv.org/html/2401.12345v1"))).toBe("2401.12345");
    expect(extractArxivIdFromUrl(new URL("https://example.com/abs/2401.12345"))).toBeUndefined();
    expect(extractArxivIdFromUrl(new URL("https://arxiv.org/abs/%2e%2e%2f%2e%2e%2ftmp%2fpwn"))).toBeUndefined();
  });

  it("builds the arxiv local library, records last access, and refreshes on demand", async () => {
    const libraryDir = (await Bun.$`mktemp -d /tmp/improved-webtools-arxiv-XXXXXX`.text()).trim();
    const apiXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v3</id>
    <title>Distributionally Robust Receive Combining</title>
    <updated>2025-06-17T20:37:32Z</updated>
    <published>2024-01-22T19:00:00Z</published>
    <author><name>Alice Example</name></author>
    <author><name>Bob Example</name></author>
    <summary>This article investigates signal estimation in wireless transmission.</summary>
    <category term="eess.SP"/>
    <arxiv:doi>10.1234/example</arxiv:doi>
    <arxiv:journal_ref>Example Journal 2025</arxiv:journal_ref>
  </entry>
</feed>`;
    const fetchCalls: string[] = [];

    const fetchImpl = (async (input: string | Request | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (url.includes("/api/query")) {
        return new Response(apiXml, { status: 200 });
      }
      if (url.includes("/pdf/2401.12345.pdf")) {
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
      }
      if (url.includes("/e-print/2401.12345")) {
        return new Response("\\documentclass{article}\n\\begin{document}\nHello arXiv.\n\\end{document}\n", {
          status: 200,
        });
      }
      return new Response("unexpected", { status: 404, statusText: "Not Found" });
    }) as unknown as typeof fetch;

    const runCommand = async (args: string[]) => {
      if (args[0] === "tar") {
        return { stdoutText: "", stderrText: "not a gzip archive", exitCode: 1 };
      }
      if (args[0] === "pandoc") {
        const outputIndex = args.indexOf("--output");
        const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
        if (outputPath) {
          const content = args.includes("--to=gfm")
            ? "# Distributionally Robust Receive Combining\n\nHello arXiv.\n"
            : "<html><body><h1>Distributionally Robust Receive Combining</h1></body></html>\n";
          writeFileSync(outputPath, content);
        }
        return { stdoutText: "", stderrText: "", exitCode: 0 };
      }
      return { stdoutText: "", stderrText: "unexpected command", exitCode: 1 };
    };

    try {
      const first = await fetchArxivLibraryContent({
        url: new URL("https://arxiv.org/abs/2401.12345v3"),
        libraryDir,
        fetchImpl,
        runCommand,
        now: new Date("2026-03-09T00:00:00Z"),
      });

      expect(first.routeName).toBe("arxiv/library");
      expect(first.content).toContain("Local arXiv library status: built");
      expect(first.content).toContain("Last accessed: 2026-03-09T00:00:00.000Z");
      expect(first.content).toContain(`Source archive file: ${join(libraryDir, "2401.12345", "2401.12345_source.tar.gz")}`);
      expect(first.content).toContain(`Markdown file: ${join(libraryDir, "2401.12345", "2401.12345.md")}`);
      expect(first.content).toContain(`HTML file: ${join(libraryDir, "2401.12345", "2401.12345.html")}`);

      const paperDir = join(libraryDir, "2401.12345");
      const metadataPath = join(paperDir, "metadata.yaml");
      const summaryPath = join(paperDir, "SUMMARY.md");
      const markdownPath = join(paperDir, "2401.12345.md");
      const htmlPath = join(paperDir, "2401.12345.html");

      expect(readFileSync(metadataPath, "utf8")).toContain('last_accessed_at: "2026-03-09T00:00:00.000Z"');
      expect(readFileSync(metadataPath, "utf8")).toContain("processing_notes:");
      expect(readFileSync(metadataPath, "utf8")).toContain("Source payload was not a tar archive; wrote raw source bytes to a .tex fallback");
      expect(readFileSync(summaryPath, "utf8")).toContain("Distributionally Robust Receive Combining");
      expect(readFileSync(markdownPath, "utf8")).toContain("# Distributionally Robust Receive Combining");
      expect(readFileSync(htmlPath, "utf8")).toContain("<html>");

      const fetchCountAfterBuild = fetchCalls.length;
      const second = await fetchArxivLibraryContent({
        url: new URL("https://arxiv.org/pdf/2401.12345.pdf"),
        libraryDir,
        fetchImpl,
        runCommand,
        now: new Date("2026-03-10T00:00:00Z"),
      });

      expect(second.content).toContain("Local arXiv library status: hit");
      expect(second.content).toContain("Last accessed: 2026-03-10T00:00:00.000Z");
      expect(second.content).toContain("Authors: Alice Example, Bob Example");
      expect(second.content).toContain("Published: 2024-01-22T19:00:00Z");
      expect(fetchCalls.length).toBe(fetchCountAfterBuild);
      expect(readFileSync(metadataPath, "utf8")).toContain('last_accessed_at: "2026-03-10T00:00:00.000Z"');

      const staleFilePath = join(paperDir, "source", "stale.tex");
      writeFileSync(staleFilePath, "stale artifact");
      expect(existsSync(staleFilePath)).toBe(true);

      const refreshed = await fetchArxivLibraryContent({
        url: new URL("https://arxiv.org/src/2401.12345"),
        libraryDir,
        fetchImpl,
        runCommand,
        now: new Date("2026-03-11T00:00:00Z"),
        overwriteCache: true,
      });

      expect(refreshed.content).toContain("Local arXiv library status: refreshed");
      expect(fetchCalls.length).toBeGreaterThan(fetchCountAfterBuild);
      expect(readFileSync(metadataPath, "utf8")).toContain('cache_status: "refreshed"');
      expect(readFileSync(metadataPath, "utf8")).toContain('last_accessed_at: "2026-03-11T00:00:00.000Z"');
      expect(existsSync(staleFilePath)).toBe(false);
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

  it("rejects unsafe tar archive entries before extraction", async () => {
    const libraryDir = (await Bun.$`mktemp -d /tmp/improved-webtools-arxiv-unsafe-XXXXXX`.text()).trim();
    const apiXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v3</id>
    <title>Unsafe Archive Fixture</title>
    <updated>2025-06-17T20:37:32Z</updated>
    <published>2024-01-22T19:00:00Z</published>
    <author><name>Alice Example</name></author>
    <summary>Unsafe archive fixture.</summary>
    <category term="eess.SP"/>
  </entry>
</feed>`;

    const fetchImpl = (async (input: string | Request | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/query")) {
        return new Response(apiXml, { status: 200 });
      }
      if (url.includes("/pdf/2401.12345.pdf")) {
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200 });
      }
      if (url.includes("/e-print/2401.12345")) {
        return new Response(new Uint8Array([0x1f, 0x8b]), { status: 200 });
      }
      return new Response("unexpected", { status: 404, statusText: "Not Found" });
    }) as unknown as typeof fetch;

    const runCommand = async (args: string[]) => {
      if (args[0] === "tar" && args[1] === "-tzf") {
        return { stdoutText: "../../tmp/pwn\n", stderrText: "", exitCode: 0 };
      }
      return { stdoutText: "", stderrText: "", exitCode: 0 };
    };

    try {
      await expect(
        fetchArxivLibraryContent({
          url: new URL("https://arxiv.org/abs/2401.12345"),
          libraryDir,
          fetchImpl,
          runCommand,
          now: new Date("2026-03-09T00:00:00Z"),
        }),
      ).rejects.toThrow("unsafe arXiv source archive entry");
    } finally {
      rmSync(libraryDir, { recursive: true, force: true });
    }
  });

});
