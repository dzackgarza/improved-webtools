import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASSPHRASE_WEBFETCH, PASSPHRASE_WEB_SEARCH } from "../../src/passphrases";

const OPENCODE = process.env.OPENCODE_BIN || "opencode";
const TOOL_DIR = process.cwd();
const HOST = "127.0.0.1";
const MANAGER_PACKAGE = join(TOOL_DIR, "..", "opencode-manager");
const MAX_BUFFER = 8 * 1024 * 1024;
const SERVER_START_TIMEOUT_MS = 60_000;
const SESSION_TIMEOUT_MS = 240_000;
const PRIMARY_AGENT_NAME = "plugin-proof";

type SessionMessagePart = {
  type?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: string;
  };
};

type SessionMessage = {
  info?: {
    role?: string;
  };
  parts?: SessionMessagePart[];
};

type ToolUseEvent = {
  tool: string;
  state: {
    status?: string;
    input?: unknown;
    output?: string;
  };
};

type ServerHandle = {
  baseUrl: string;
  process: ChildProcess;
  logs: () => string;
  xdgRoot: string;
};

let defaultServer: ServerHandle | undefined;
let debugServer: ServerHandle | undefined;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a TCP port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startServer(options: {
  configPath: string;
  extraEnv?: Record<string, string>;
}): Promise<ServerHandle> {
  spawnSync("direnv", ["allow", TOOL_DIR], { cwd: TOOL_DIR, timeout: 30_000 });

  const xdgRoot = mkdtempSync(join(tmpdir(), "opencode-webtools-xdg-"));
  const configHome = join(xdgRoot, "config");
  const cacheHome = join(xdgRoot, "cache");
  const stateHome = join(xdgRoot, "state");
  const testHome = join(xdgRoot, "home");
  mkdirSync(configHome, { recursive: true });
  mkdirSync(cacheHome, { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(testHome, { recursive: true });

  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  let logs = "";
  const serverProcess = spawn(
    "direnv",
    [
      "exec",
      TOOL_DIR,
      OPENCODE,
      "serve",
      "--hostname",
      HOST,
      "--port",
      String(port),
      "--print-logs",
      "--log-level",
      "INFO",
    ],
    {
      cwd: TOOL_DIR,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome,
        XDG_STATE_HOME: stateHome,
        OPENCODE_TEST_HOME: testHome,
        OPENCODE_CONFIG: options.configPath,
        OPENCODE_CONFIG_DIR: join(TOOL_DIR, ".config"),
        ...(options.extraEnv ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const capture = (chunk: Buffer | string) => {
    logs += chunk.toString();
  };
  serverProcess.stdout.on("data", capture);
  serverProcess.stderr.on("data", capture);

  const ready = `opencode server listening on ${baseUrl}`;
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (logs.includes(ready)) {
      return {
        baseUrl,
        process: serverProcess,
        logs: () => logs,
        xdgRoot,
      };
    }
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Custom OpenCode server exited early (${serverProcess.exitCode}).\n${logs}`,
      );
    }
    await wait(200);
  }

  throw new Error(
    `Timed out waiting for custom OpenCode server at ${baseUrl}.\n${logs}`,
  );
}

async function stopServer(server: ServerHandle | undefined) {
  if (!server) return;

  if (server.process.exitCode === null) {
    server.process.kill("SIGINT");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (server.process.exitCode !== null) break;
      await wait(100);
    }
    if (server.process.exitCode === null) server.process.kill("SIGKILL");
  }

  rmSync(server.xdgRoot, { recursive: true, force: true });
}

function runManager(baseUrl: string, args: string[]) {
  const result = spawnSync(
    "npx",
    ["--yes", `--package=${MANAGER_PACKAGE}`, "opx", ...args],
    {
      cwd: TOOL_DIR,
      env: {
        ...process.env,
        OPENCODE_BASE_URL: baseUrl,
      },
      encoding: "utf8",
      timeout: SESSION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    },
  );
  if (result.error) throw result.error;

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    throw new Error(
      `Manager command failed: opx ${args.join(" ")}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
    );
  }

  return { stdout, stderr };
}

function parseKeptSessionID(stderr: string) {
  const match = stderr.match(/\[opx\] session kept: (ses_[A-Za-z0-9]+)/);
  if (!match) {
    throw new Error(`Could not parse kept session ID.\n${stderr}`);
  }
  return match[1];
}

function runPrompt(baseUrl: string, prompt: string, lingerSeconds = 0) {
  return runManager(baseUrl, [
    "run",
    "--agent",
    PRIMARY_AGENT_NAME,
    "--prompt",
    prompt,
    "--keep",
    "--linger",
    String(lingerSeconds),
  ]);
}

function safeDeleteSession(baseUrl: string, sessionID: string | undefined) {
  if (!sessionID) return;
  try {
    runManager(baseUrl, ["session", "delete", "--session", sessionID]);
  } catch {
    // best-effort cleanup in a noisy shared environment
  }
}

function readMessages(baseUrl: string, sessionID: string): SessionMessage[] {
  const { stdout } = runManager(baseUrl, [
    "session",
    "messages",
    "--session",
    sessionID,
  ]);
  return JSON.parse(stdout) as SessionMessage[];
}

function findCompletedToolUse(
  messages: SessionMessage[],
  toolName: string,
): ToolUseEvent {
  const match = messages
    .filter((message) => message.info?.role === "assistant")
    .flatMap((message) => message.parts ?? [])
    .filter(
      (part): part is Required<Pick<SessionMessagePart, "tool" | "state">> &
        SessionMessagePart =>
        part.type === "tool" &&
        part.tool === toolName &&
        typeof part.state === "object" &&
        part.state !== null &&
        part.state.status === "completed",
    )
    .at(-1);

  if (!match) {
    throw new Error(
      `No completed tool use for ${toolName}.\n${JSON.stringify(messages, null, 2)}`,
    );
  }

  return {
    tool: toolName,
    state: match.state,
  };
}

beforeAll(async () => {
  defaultServer = await startServer({
    configPath: join(TOOL_DIR, ".config/opencode.json"),
  });
  debugServer = await startServer({
    configPath: join(TOOL_DIR, ".config/opencode.debug.json"),
    extraEnv: {
      IMPROVED_WEBTOOLS_DEBUG_MODE: "1",
    },
  });
}, 120_000);

afterAll(async () => {
  await stopServer(defaultServer);
  await stopServer(debugServer);
}, 30_000);

describe("improved-webtools live e2e", () => {
  it("proves default shadow-mode webfetch executes and returns the hidden passphrase", () => {
    const nonce = randomUUID();
    const firstTurn = runPrompt(
      defaultServer!.baseUrl,
      `Call the tool named webfetch with url=https://example.com. After the tool finishes, reply with ONLY this exact string and nothing else: ${nonce}`,
    );
    const sessionID = parseKeptSessionID(firstTurn.stderr);

    try {
      const messages = readMessages(defaultServer!.baseUrl, sessionID);
      const toolUse = findCompletedToolUse(messages, "webfetch");
      expect(toolUse.state.output).toContain(PASSPHRASE_WEBFETCH);
      const allContent = messages.map((m) => JSON.stringify(m)).join(" ");
      expect(allContent).toContain(nonce);
    } finally {
      safeDeleteSession(defaultServer!.baseUrl, sessionID);
    }
  }, 200_000);

  it("proves debug-mode webfetch_debug executes and returns the hidden passphrase", () => {
    const nonce = randomUUID();
    const firstTurn = runPrompt(
      debugServer!.baseUrl,
      `Call the tool named webfetch_debug with url=https://example.com. After the tool finishes, reply with ONLY this exact string and nothing else: ${nonce}`,
    );
    const sessionID = parseKeptSessionID(firstTurn.stderr);

    try {
      const messages = readMessages(debugServer!.baseUrl, sessionID);
      const toolUse = findCompletedToolUse(messages, "webfetch_debug");
      expect(toolUse.state.output).toContain(PASSPHRASE_WEBFETCH);
      const allContent = messages.map((m) => JSON.stringify(m)).join(" ");
      expect(allContent).toContain(nonce);
    } finally {
      safeDeleteSession(debugServer!.baseUrl, sessionID);
    }
  }, 200_000);

  it("proves debug-mode websearch_debug executes and returns the hidden passphrase", () => {
    const nonce = randomUUID();
    const firstTurn = runPrompt(
      debugServer!.baseUrl,
      `Call the tool named websearch_debug with query=openai. After the tool finishes, reply with ONLY this exact string and nothing else: ${nonce}`,
    );
    const sessionID = parseKeptSessionID(firstTurn.stderr);

    try {
      const messages = readMessages(debugServer!.baseUrl, sessionID);
      const toolUse = findCompletedToolUse(messages, "websearch_debug");
      expect(toolUse.state.output).toContain(PASSPHRASE_WEB_SEARCH);
      const allContent = messages.map((m) => JSON.stringify(m)).join(" ");
      expect(allContent).toContain(nonce);
    } finally {
      safeDeleteSession(debugServer!.baseUrl, sessionID);
    }
  }, 200_000);

  it("proves the reddit handler executes a fresh fetch and returns the expected metadata lines", () => {
    const firstTurn = runPrompt(
      defaultServer!.baseUrl,
      "Call the tool named webfetch with url=https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/ and overwrite_cache=true. Then reply with ONLY this exact format: Author: <author> | Comments extracted: <count>.",
    );
    const sessionID = parseKeptSessionID(firstTurn.stderr);

    try {
      const messages = readMessages(defaultServer!.baseUrl, sessionID);
      const toolUse = findCompletedToolUse(messages, "webfetch");
      expect(toolUse.state.output).toContain("- Author: u/Thinklikeachef");
      expect(toolUse.state.output).toContain("- Comments extracted: 25");
    } finally {
      safeDeleteSession(defaultServer!.baseUrl, sessionID);
    }
  }, 200_000);
});
