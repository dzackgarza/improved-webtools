import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { PASSPHRASE_WEBFETCH, PASSPHRASE_WEB_SEARCH } from "../../src/passphrases";

const OPENCODE = "/home/dzack/.opencode/bin/opencode";
const TOOL_DIR = "/home/dzack/opencode-plugins/improved-webtools";
const DEFAULT_CONFIG = `${TOOL_DIR}/.config/opencode.json`;
const DEBUG_CONFIG = `${TOOL_DIR}/.config/opencode.debug.json`;
const MAX_BUFFER = 8 * 1024 * 1024;

type RunOptions = {
  timeout?: number;
  config?: string;
  env?: Record<string, string>;
  format?: "default" | "json";
};

type ToolUseEvent = {
  type: "tool_use";
  part: {
    type: "tool";
    tool: string;
    state: {
      status?: string;
      input?: unknown;
      output?: string;
    };
  };
};

function run(prompt: string, options: RunOptions = {}) {
  const args = ["run", "--agent", "Minimal"];
  if (options.format === "json") args.push("--format", "json");
  args.push(prompt);

  const result = spawnSync(OPENCODE, args, {
    cwd: TOOL_DIR,
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      OPENCODE_CONFIG: options.config ?? DEFAULT_CONFIG,
      ...options.env,
    },
  });
  if (result.error) throw result.error;
  return (result.stdout ?? "") + (result.stderr ?? "");
}

function parseJsonEvents(output: string): unknown[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function runJson(prompt: string, options: RunOptions = {}) {
  return parseJsonEvents(run(prompt, { ...options, format: "json" }));
}

function findCompletedToolUse(events: unknown[], toolName: string): ToolUseEvent {
  const match = events.find(
    (event): event is ToolUseEvent =>
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "tool_use" &&
      "part" in event &&
      typeof event.part === "object" &&
      event.part !== null &&
      "type" in event.part &&
      event.part.type === "tool" &&
      "tool" in event.part &&
      event.part.tool === toolName &&
      "state" in event.part &&
      typeof event.part.state === "object" &&
      event.part.state !== null &&
      "status" in event.part.state &&
      event.part.state.status === "completed",
  );
  expect(match).toBeDefined();
  return match!;
}

describe("improved-webtools live e2e", () => {
  it("proves default shadow-mode webfetch executes and returns the hidden passphrase", () => {
    const events = runJson(
      "Call the tool named webfetch with url=https://example.com. Then reply with ONLY the exact passphrase returned by that tool, nothing else.",
    );
    const toolUse = findCompletedToolUse(events, "webfetch");
    expect(toolUse.part.state.output).toContain(PASSPHRASE_WEBFETCH);
  }, 200_000);

  it("proves debug-mode webfetch_debug executes and returns the hidden passphrase", () => {
    const events = runJson(
      "Call the tool named webfetch_debug with url=https://example.com. Then reply with ONLY the exact passphrase returned by that tool, nothing else.",
      {
        config: DEBUG_CONFIG,
        env: {
          IMPROVED_WEBTOOLS_DEBUG_MODE: "1",
        },
      },
    );
    const toolUse = findCompletedToolUse(events, "webfetch_debug");
    expect(toolUse.part.state.output).toContain(PASSPHRASE_WEBFETCH);
  }, 200_000);

  it("proves debug-mode websearch_debug executes and returns the hidden passphrase", () => {
    const events = runJson(
      "Call the tool named websearch_debug with query=openai. Then reply with ONLY the exact passphrase returned by that tool, nothing else.",
      {
        config: DEBUG_CONFIG,
        env: {
          IMPROVED_WEBTOOLS_DEBUG_MODE: "1",
        },
      },
    );
    const toolUse = findCompletedToolUse(events, "websearch_debug");
    expect(toolUse.part.state.output).toContain(PASSPHRASE_WEB_SEARCH);
  }, 200_000);

  it("proves the reddit handler executes a fresh fetch and returns the expected metadata lines", () => {
    const events = runJson(
      "Call the tool named webfetch with url=https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/ and cache_mode=refresh. Then reply with ONLY this exact format: Author: <author> | Comments extracted: <count>.",
    );
    const toolUse = findCompletedToolUse(events, "webfetch");
    expect(toolUse.part.state.output).toContain("- Author: u/Thinklikeachef");
    expect(toolUse.part.state.output).toContain("- Comments extracted: 25");
  }, 200_000);
});
