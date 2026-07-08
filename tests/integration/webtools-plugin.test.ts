import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PASSPHRASE_WEBFETCH, PASSPHRASE_WEB_SEARCH } from "../../src/passphrases";

const OPENCODE = process.env.OPENCODE_BIN || "opencode";
const TOOL_DIR = process.cwd();
const MAX_BUFFER = 8 * 1024 * 1024;
const FREE_OPENROUTER_MODEL = "openrouter/openrouter/free";

let tempConfigPath: string;
let tempDebugConfigPath: string;

beforeAll(() => {
  const pluginUrl = pathToFileURL(join(TOOL_DIR, "src/index.ts")).toString();
  
  const config = {
    "$schema": "https://opencode.ai/config.json",
    "model": FREE_OPENROUTER_MODEL,
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
  if (tempConfigPath) rmSync(tempConfigPath, { force: true });
  if (tempDebugConfigPath) rmSync(tempDebugConfigPath, { force: true });
});

type RunOptions = {
  timeout?: number;
  config?: string;
  env?: Record<string, string>;
  format?: "default" | "json";
};

type RunResult = {
  command: string;
  stdout: string;
  stderr: string;
  status: number | null;
  signal: NodeJS.Signals | null;
  output: string;
};

function summarizeResult(result: RunResult): string {
  const chunks = [
    `cmd: ${result.command}`,
    `status: ${result.status ?? "null"}`,
    `signal: ${result.signal ?? "null"}`,
  ];

  if (result.stderr) {
    chunks.push("stderr:", result.stderr.trimEnd());
  }

  if (result.stdout) {
    chunks.push("stdout:", result.stdout.trimEnd());
  }

  if (!result.stderr && !result.stdout && result.output) {
    chunks.push("output:", result.output.trimEnd());
  }

  return chunks.join("\n");
}

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

function run(prompt: string, options: RunOptions = {}): RunResult {
  const args = ["run", "--model", FREE_OPENROUTER_MODEL];
  if (options.format === "json") args.push("--format", "json");
  args.push(prompt);

  const result = spawnSync(OPENCODE, args, {
    cwd: TOOL_DIR,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      OPENCODE_CONFIG: options.config ?? tempConfigPath,
      ...options.env,
    },
  });
  if (result.error) throw result.error;

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  return {
    command: `${OPENCODE} ${args.join(" ")}`,
    stdout,
    stderr,
    status: result.status,
    signal: result.signal,
    output: stdout + stderr,
  };
}

function parseJsonEvents(runResult: RunResult): unknown[] {
  return runResult.output
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
  const result = run(prompt, { ...options, format: "json" });
  return {
    events: parseJsonEvents(result),
    result,
  };
}

function findCompletedToolUse(events: unknown[], toolName: string): ToolUseEvent | undefined {
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
  return match;
}

function ensureCompletedToolUse(
  events: unknown[],
  toolName: string,
  runResult: RunResult,
): ToolUseEvent {
  const match = findCompletedToolUse(events, toolName);
  if (!match) {
    const summary = summarizeResult(runResult);
    expect.fail(`Missing completed tool_use for ${toolName}.\n${summary}`);
  }
  return match;
}

function expectOutputContains(
  actual: string,
  expected: string,
  runResult: RunResult,
  context: string,
) {
  expect(actual, `${context}\n${summarizeResult(runResult)}`).toContain(expected);
}

describe("improved-webtools live e2e", () => {
  it("proves default shadow-mode webfetch executes and returns the hidden passphrase", () => {
    const events = runJson(
      "Call the tool named webfetch with url=https://example.com. Then reply with ONLY the exact passphrase returned by that tool, nothing else.",
    );
    const toolUse = ensureCompletedToolUse(events.events, "webfetch", events.result);
    expectOutputContains(
      toolUse.part.state.output ?? "",
      PASSPHRASE_WEBFETCH,
      events.result,
      "Missing passphrase in webfetch output",
    );
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
    const toolUse = ensureCompletedToolUse(events.events, "webfetch_debug", events.result);
    expectOutputContains(
      toolUse.part.state.output ?? "",
      PASSPHRASE_WEBFETCH,
      events.result,
      "Missing passphrase in webfetch_debug output",
    );
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
    const toolUse = ensureCompletedToolUse(events.events, "websearch_debug", events.result);
    expectOutputContains(
      toolUse.part.state.output ?? "",
      PASSPHRASE_WEB_SEARCH,
      events.result,
      "Missing passphrase in websearch_debug output",
    );
  }, 200_000);

  it("proves the reddit handler executes a fresh fetch and returns the expected metadata lines", () => {
    const events = runJson(
      "Call the tool named webfetch with url=https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/ and overwrite_cache=true. Then reply with ONLY this exact format: Author: <author> | Comments extracted: <count>.",
    );
    const toolUse = ensureCompletedToolUse(events.events, "webfetch", events.result);
    expectOutputContains(
      toolUse.part.state.output ?? "",
      "- Author: u/Thinklikeachef",
      events.result,
      "Reddit handler missing author",
    );
    expectOutputContains(
      toolUse.part.state.output ?? "",
      "- Comments extracted: 42",
      events.result,
      "Reddit handler missing comment count",
    );
  }, 200_000);
});
