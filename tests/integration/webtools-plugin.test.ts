import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { PASSPHRASE_WEBFETCH, PASSPHRASE_WEB_SEARCH } from "../../src/passphrases";

const OPENCODE = "opencode";
const TOOL_DIR = process.cwd();
const MAX_BUFFER = 8 * 1024 * 1024;
const OPENCODE_TEST_MODEL = "openrouter/openrouter/free";

let tempConfigPath: string;
let tempDebugConfigPath: string;

beforeAll(() => {
  const pluginUrl = pathToFileURL(join(TOOL_DIR, "src/index.ts")).toString();
  
  const config = {
    "$schema": "https://opencode.ai/config.json",
    "model": OPENCODE_TEST_MODEL,
    "plugin": [pluginUrl],
    "permission": {
      "webfetch": "allow",
      "websearch": "allow"
    }
  };
  
  const debugConfig = {
    ...config,
    "permission": {
      "webfetch_debug": "allow",
      "websearch_debug": "allow"
    }
  };

  tempConfigPath = join(TOOL_DIR, `.config/temp.opencode.${Math.random().toString(36).slice(2)}.json`);
  tempDebugConfigPath = join(TOOL_DIR, `.config/temp.opencode.debug.${Math.random().toString(36).slice(2)}.json`);

  writeFileSync(tempConfigPath, JSON.stringify(config, null, 2));
  writeFileSync(tempDebugConfigPath, JSON.stringify(debugConfig, null, 2));
});

afterAll(() => {
  rmSync(tempConfigPath, { force: true });
  rmSync(tempDebugConfigPath, { force: true });
});

type RunOptions = {
  timeout?: number;
  config?: string;
  env?: Record<string, string>;
  format?: "default" | "json";
};

const jsonEventSchema = z.object({ type: z.string() }).loose();
const completedToolUseSchema = z
  .object({
    type: z.literal("tool_use"),
    part: z
      .object({
        type: z.literal("tool"),
        tool: z.string(),
        state: z.object({ status: z.literal("completed"), output: z.string() }).loose(),
      })
      .loose(),
  })
  .loose();

type JsonEvent = z.infer<typeof jsonEventSchema>;
type CompletedToolUseEvent = z.infer<typeof completedToolUseSchema>;

function run(prompt: string, options: RunOptions = {}) {
  const args = ["run", "--agent", "build"];
  if (options.format === "json") {args.push("--format", "json");}
  args.push(prompt);

  const result = spawnSync(OPENCODE, args, {
    cwd: TOOL_DIR,
    encoding: "utf8",
    timeout: options.timeout ?? 180_000,
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      OPENCODE_CONFIG: options.config ?? tempConfigPath,
      ...options.env,
    },
  });
  if (result.error !== undefined) {throw result.error;}
  return (result.stdout ?? "") + (result.stderr ?? "");
}

function parseJsonEvents(output: string): JsonEvent[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => jsonEventSchema.parse(JSON.parse(line)));
}

function runJson(prompt: string, options: RunOptions = {}) {
  return parseJsonEvents(run(prompt, { ...options, format: "json" }));
}

function findCompletedToolUse(events: JsonEvent[], toolName: string): CompletedToolUseEvent {
  for (const event of events) {
    const result = completedToolUseSchema.safeParse(event);
    if (result.success && result.data.part.tool === toolName) {return result.data;}
  }
  throw new Error(`OpenCode did not complete the required ${toolName} call.`);
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
        config: tempDebugConfigPath,
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
        config: tempDebugConfigPath,
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
      "Call the tool named webfetch with url=https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/ and overwrite_cache=true. Then reply with ONLY this exact format: Author: <author> | Comments extracted: <count>.",
    );
    const toolUse = findCompletedToolUse(events, "webfetch");
    expect(toolUse.part.state.output).toContain("- Author: u/Thinklikeachef");
    expect(toolUse.part.state.output).toContain("- Comments extracted: 25");
  }, 200_000);
});
