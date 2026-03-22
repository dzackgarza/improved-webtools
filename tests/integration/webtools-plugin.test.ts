import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set (run against a repo-local or CI OpenCode server)`);
  }
  return value;
}

// OpenCode must already be running before this file executes.
// `just test` runs the suite, but it does not start or stop the server.
const BASE_URL = requireEnv("OPENCODE_BASE_URL");

const MANAGER_PACKAGE = "git+https://github.com/dzackgarza/opencode-manager.git";
const MAX_BUFFER = 8 * 1024 * 1024;
const SESSION_TIMEOUT_MS = 240_000;
const AGENT_NAME = "plugin-proof";
const PROJECT_DIR = process.cwd();

function runOcm(args: string[]) {
  const result = spawnSync(
    "uvx",
    ["--from", MANAGER_PACKAGE, "ocm", ...args],
    {
      env: { ...process.env, OPENCODE_BASE_URL: BASE_URL },
      cwd: PROJECT_DIR,
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

function completedToolSteps(steps: TranscriptStep[], toolName: string): TranscriptStep[] {
  return steps.filter(
    (s) => s.type === "tool" && s.tool === toolName && s.status === "completed",
  );
}

function readTranscriptSteps(sessionID: string): TranscriptStep[] {
  const { stdout } = runOcm(["transcript", sessionID, "--json"]);
  console.log(`[transcript] ${sessionID}:\n${stdout}`);
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

  it("proves repeated webfetch calls reuse the cached result on the second call", () => {
    const sessionIDs: string[] = [];
    const cacheProofUrl = "https://example.com/?cache-proof=phase-b";
    try {
      const warmSessionID = beginSession(
        `Call webfetch exactly once with url=${cacheProofUrl} and overwrite_cache=true. Reply with ONLY DONE.`,
      );
      sessionIDs.push(warmSessionID);
      waitIdle(warmSessionID);

      const proofSessionID = beginSession(
        `Call the tool named webfetch exactly once with url=${cacheProofUrl}. Reply with ONLY the exact text returned by the tool, nothing else.`,
      );
      sessionIDs.push(proofSessionID);
      waitIdle(proofSessionID);

      const steps = readTranscriptSteps(proofSessionID);
      const rawTranscript = JSON.stringify(steps, null, 2);
      const fetchSteps = completedToolSteps(steps, "webfetch");

      expect(fetchSteps, `webfetch step missing. Steps:\n${rawTranscript}`).toHaveLength(1);
      expect(fetchSteps[0]?.outputText).toContain("Route: default/html/cache");
      expect(fetchSteps[0]?.outputText).toContain("Example Domain");
    } finally {
      for (const sessionID of sessionIDs) {
        try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
      }
    }
  }, SESSION_TIMEOUT_MS);

  it("proves pdf webfetch returns the temp-download contract instead of a generic binary notice", () => {
    let sessionID: string | undefined;
    try {
      sessionID = beginSession(
        "Call the tool named webfetch exactly once with url=https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf and overwrite_cache=true. Then reply with ONLY the exact lines from the tool output that begin with 'Tool passphrase:', 'Route:', and 'Saved PDF:'.",
      );
      waitIdle(sessionID);

      const steps = readTranscriptSteps(sessionID);
      const rawTranscript = JSON.stringify(steps, null, 2);
      const fetchStep = steps.find(
        (s) => s.type === "tool" && s.tool === "webfetch" && s.status === "completed",
      );

      expect(fetchStep, `webfetch step missing. Steps:\n${rawTranscript}`).toBeDefined();
      expect(fetchStep!.outputText).toContain("Route: default/binary-pdf");
      expect(fetchStep!.outputText).toContain("Saved PDF: /tmp/webfetch-pdf-");
      expect(fetchStep!.outputText).toContain("Use your normal file-reading tools on the saved file.");
    } finally {
      if (sessionID) {
        try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
      }
    }
  }, SESSION_TIMEOUT_MS);

  it("proves overwrite_cache forces a fresh fetch after a cached response exists", () => {
    const sessionIDs: string[] = [];
    const refreshProofUrl = "https://example.com/?cache-refresh=phase-b";
    try {
      const warmSessionID = beginSession(
        `Call webfetch exactly once with url=${refreshProofUrl} and overwrite_cache=true. Reply with ONLY DONE.`,
      );
      sessionIDs.push(warmSessionID);
      waitIdle(warmSessionID);

      const cacheSessionID = beginSession(
        `Call the tool named webfetch exactly once with url=${refreshProofUrl}. Reply with ONLY DONE.`,
      );
      sessionIDs.push(cacheSessionID);
      waitIdle(cacheSessionID);

      const refreshSessionID = beginSession(
        `Call the tool named webfetch exactly once with url=${refreshProofUrl} and overwrite_cache=true. Reply with ONLY the exact text returned by the tool, nothing else.`,
      );
      sessionIDs.push(refreshSessionID);
      waitIdle(refreshSessionID);

      const steps = readTranscriptSteps(refreshSessionID);
      const rawTranscript = JSON.stringify(steps, null, 2);
      const fetchSteps = completedToolSteps(steps, "webfetch");

      expect(fetchSteps, `webfetch step missing. Steps:\n${rawTranscript}`).toHaveLength(1);
      expect(fetchSteps[0]?.outputText).toContain("Route: default/html");
      expect(fetchSteps[0]?.outputText).not.toContain("Route: default/html/cache");
      expect(fetchSteps[0]?.outputText).toContain("Example Domain");
    } finally {
      for (const sessionID of sessionIDs) {
        try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
      }
    }
  }, SESSION_TIMEOUT_MS);
});
