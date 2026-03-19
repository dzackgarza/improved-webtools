import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PASSPHRASE_WEB_SEARCH = 'PASS_WEB_SEARCH_SHADOW_20260305_6A9F';
const PASSPHRASE_WEBFETCH = 'PASS_WEBFETCH_SHADOW_20260305_C3D2';

const OPENCODE = process.env.OPENCODE_BIN || 'opencode';
const TOOL_DIR = process.cwd();
const MAX_BUFFER = 8 * 1024 * 1024;

let tempConfigPath: string;
let tempDebugConfigPath: string;

beforeAll(() => {
  const pluginUrl = pathToFileURL(join(TOOL_DIR, 'src/index.ts')).toString();

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: 'github-copilot/gpt-4.1',
    plugin: [pluginUrl],
    permission: {
      webfetch: 'allow',
      websearch: 'allow',
    },
  };

  const debugConfig = {
    ...config,
    permission: {
      webfetch_debug: 'allow',
      websearch_debug: 'allow',
    },
  };

  tempConfigPath = join(
    TOOL_DIR,
    `.config/temp.opencode.${Math.random().toString(36).slice(2)}.json`,
  );
  tempDebugConfigPath = join(
    TOOL_DIR,
    `.config/temp.opencode.debug.${Math.random().toString(36).slice(2)}.json`,
  );

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
  format?: 'default' | 'json';
};

type ToolUseEvent = {
  type: 'tool_use';
  part: {
    type: 'tool';
    tool: string;
    state: {
      status?: string;
      input?: unknown;
      output?: string;
    };
  };
};

function run(prompt: string, options: RunOptions = {}) {
  const args = ['run', '--agent', 'Minimal'];
  if (options.format === 'json') args.push('--format', 'json');
  args.push(prompt);

  const result = spawnSync(OPENCODE, args, {
    cwd: TOOL_DIR,
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      OPENCODE_CONFIG: options.config ?? tempConfigPath,
      ...options.env,
    },
  });
  if (result.error) throw result.error;
  return (result.stdout ?? '') + (result.stderr ?? '');
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
  return parseJsonEvents(run(prompt, { ...options, format: 'json' }));
}

function findCompletedToolUse(events: unknown[], toolName: string): ToolUseEvent {
  const match = events.find(
    (event): event is ToolUseEvent =>
      typeof event === 'object' &&
      event !== null &&
      'type' in event &&
      event.type === 'tool_use' &&
      'part' in event &&
      typeof event.part === 'object' &&
      event.part !== null &&
      'type' in event.part &&
      event.part.type === 'tool' &&
      'tool' in event.part &&
      event.part.tool === toolName &&
      'state' in event.part &&
      typeof event.part.state === 'object' &&
      event.part.state !== null &&
      'status' in event.part.state &&
      event.part.state.status === 'completed',
  );
  expect(match).toBeDefined();
  return match!;
}

describe('improved-webtools live e2e', () => {
  it('proves default shadow-mode webfetch executes and returns the hidden passphrase', () => {
    const events = runJson(
      'Call the tool named webfetch with url=https://example.com. Then reply with ONLY the exact passphrase returned by that tool, nothing else.',
    );
    const toolUse = findCompletedToolUse(events, 'webfetch');
    expect(toolUse.part.state.output).toContain(PASSPHRASE_WEBFETCH);
  }, 200_000);

  it('proves debug-mode webfetch_debug executes and returns the hidden passphrase', () => {
    const events = runJson(
      'Call the tool named webfetch_debug with url=https://example.com. Then reply with ONLY the exact passphrase returned by that tool, nothing else.',
      {
        config: tempDebugConfigPath,
        env: {
          IMPROVED_WEBTOOLS_DEBUG_MODE: '1',
        },
      },
    );
    const toolUse = findCompletedToolUse(events, 'webfetch_debug');
    expect(toolUse.part.state.output).toContain(PASSPHRASE_WEBFETCH);
  }, 200_000);

  it('proves debug-mode websearch_debug executes and returns the hidden passphrase', () => {
    const events = runJson(
      'Call the tool named websearch_debug with query=openai. Then reply with ONLY the exact passphrase returned by that tool, nothing else.',
      {
        config: tempDebugConfigPath,
        env: {
          IMPROVED_WEBTOOLS_DEBUG_MODE: '1',
        },
      },
    );
    const toolUse = findCompletedToolUse(events, 'websearch_debug');
    expect(toolUse.part.state.output).toContain(PASSPHRASE_WEB_SEARCH);
  }, 200_000);

  it('proves the reddit handler executes a fresh fetch and returns the expected metadata lines', () => {
    const events = runJson(
      'Call the tool named webfetch with url=https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/ and overwrite_cache=true. Then reply with ONLY this exact format: Author: <author> | Comments extracted: <count>.',
    );
    const toolUse = findCompletedToolUse(events, 'webfetch');
    expect(toolUse.part.state.output).toContain('- Author: u/Thinklikeachef');
    expect(toolUse.part.state.output).toContain('- Comments extracted: 25');
  }, 200_000);
});
