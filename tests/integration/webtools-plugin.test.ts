import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

// Server is started and torn down by `just test` — not by this file.
// Set OPENCODE_BASE_URL before running.
const BASE_URL = process.env.OPENCODE_BASE_URL;
if (!BASE_URL) throw new Error("OPENCODE_BASE_URL must be set (run via `just test`)");

const MANAGER_PACKAGE = "git+https://github.com/dzackgarza/opencode-manager.git";
const MAX_BUFFER = 8 * 1024 * 1024;
const SESSION_TIMEOUT_MS = 240_000;
const AGENT_NAME = "plugin-proof";

function runOcm(args: string[]) {
  const result = spawnSync(
    "uvx",
    ["--from", MANAGER_PACKAGE, "ocm", ...args],
    {
      env: { ...process.env, OPENCODE_BASE_URL: BASE_URL },
      encoding: "utf8",
      timeout: SESSION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    },
  );
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    throw new Error(`ocm ${args.join(" ")} failed\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
  return { stdout, stderr };
}

function beginSession(prompt: string): string {
  const { stdout } = runOcm(["begin-session", prompt, "--agent", AGENT_NAME, "--json"]);
  const data = JSON.parse(stdout) as { sessionID: string };
  if (!data.sessionID) throw new Error(`begin-session returned no sessionID: ${stdout}`);
  return data.sessionID;
}

function waitIdle(sessionID: string) {
  runOcm(["wait", sessionID, "--timeout-sec=180"]);
}

type TranscriptStep = {
  type: string;
  tool?: string;
  status?: string;
  outputText?: string;
};

function readTranscriptSteps(sessionID: string): TranscriptStep[] {
  const { stdout } = runOcm(["transcript", sessionID, "--json"]);
  const data = JSON.parse(stdout) as {
    turns: Array<{
      assistantMessages: Array<{ steps: Array<TranscriptStep | null> }>;
    }>;
  };
  return data.turns.flatMap((turn) =>
    turn.assistantMessages.flatMap((msg) =>
      (msg.steps ?? []).filter((s): s is TranscriptStep => s !== null),
    ),
  );
}

describe("improved-webtools live e2e", () => {
  it("proves webfetch executes via the plugin and returns real content from example.com", () => {
    let sessionID: string | undefined;
    try {
      sessionID = beginSession(
        "Call webfetch exactly once with url=https://example.com. Reply with ONLY the exact text returned by the tool, nothing else.",
      );
      waitIdle(sessionID);

      const steps = readTranscriptSteps(sessionID);
      const rawTranscript = JSON.stringify(steps, null, 2);

      const fetchStep = steps.find(
        (s) => s.type === "tool" && s.tool === "webfetch" && s.status === "completed",
      );
      expect(fetchStep, `webfetch step missing. Steps:\n${rawTranscript}`).toBeDefined();
      expect(fetchStep!.outputText).toContain("Example Domain");
    } finally {
      if (sessionID) {
        try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
      }
    }
  }, SESSION_TIMEOUT_MS);

  it("proves webfetch reddit handler extracts post content from a known URL", () => {
    let sessionID: string | undefined;
    try {
      sessionID = beginSession(
        "Call webfetch exactly once with url=https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/ and overwrite_cache=true. Reply with ONLY the exact text returned by the tool, nothing else.",
      );
      waitIdle(sessionID);

      const steps = readTranscriptSteps(sessionID);
      const rawTranscript = JSON.stringify(steps, null, 2);

      const fetchStep = steps.find(
        (s) => s.type === "tool" && s.tool === "webfetch" && s.status === "completed",
      );
      expect(fetchStep, `webfetch step missing. Steps:\n${rawTranscript}`).toBeDefined();
      // The Reddit handler extracts comments — output must contain the known author
      expect(fetchStep!.outputText).toContain("Thinklikeachef");
    } finally {
      if (sessionID) {
        try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
      }
    }
  }, SESSION_TIMEOUT_MS);
});
