import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const OCM_TOOL_DIR = mkdtempSync(join(tmpdir(), "ocm-tool-"));
let ocmBinaryPath: string | undefined;

afterAll(() => {
  rmSync(OCM_TOOL_DIR, { recursive: true, force: true });
});

function getOcmBinaryPath(): string {
  if (ocmBinaryPath) return ocmBinaryPath;
  const binDir = process.platform === "win32" ? join(OCM_TOOL_DIR, "Scripts") : join(OCM_TOOL_DIR, "bin");
  const candidate = join(binDir, process.platform === "win32" ? "ocm.exe" : "ocm");
  const pythonBinary = join(binDir, process.platform === "win32" ? "python.exe" : "python");
  if (!existsSync(candidate)) {
    const createVenv = spawnSync("uv", ["venv", OCM_TOOL_DIR], {
      env: process.env,
      cwd: PROJECT_DIR,
      encoding: "utf8",
      timeout: SESSION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    if (createVenv.error) throw createVenv.error;
    if (createVenv.status !== 0) {
      throw new Error(
        `Failed to create ocm venv\nSTDOUT:\n${createVenv.stdout ?? ""}\nSTDERR:\n${createVenv.stderr ?? ""}`,
      );
    }
    const install = spawnSync(
      "uv",
      ["pip", "install", "--python", pythonBinary, MANAGER_PACKAGE],
      {
        env: process.env,
        cwd: PROJECT_DIR,
        encoding: "utf8",
        timeout: SESSION_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      },
    );
    if (install.error) throw install.error;
    if (install.status !== 0 || !existsSync(candidate)) {
      throw new Error(
        `Failed to install ocm\nSTDOUT:\n${install.stdout ?? ""}\nSTDERR:\n${install.stderr ?? ""}`,
      );
    }
  }
  ocmBinaryPath = candidate;
  return candidate;
}

function runOcm(args: string[]) {
  const result = spawnSync(
    getOcmBinaryPath(),
    args,
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

type RouteHandler = (count: number) => {
  body: Buffer | string;
  headers: Record<string, string>;
  status?: number;
};

async function withFixtureServer<T>(
  routes: Record<string, RouteHandler>,
  callback: (baseUrl: string, counts: Map<string, number>) => Promise<T>,
): Promise<T> {
  const counts = new Map<string, number>();
  const server = createServer((request, response) => {
    const path = request.url ?? "/";
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    const handler = routes[path];
    if (!handler) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    const result = handler(count);
    response.writeHead(result.status ?? 200, result.headers);
    response.end(result.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a numeric port.");
  }
  try {
    return await callback(`http://127.0.0.1:${address.port}`, counts);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

type RawSessionMessage = {
  info?: {
    role?: string;
  };
  parts?: Array<{
    type?: string;
    text?: string;
  } | null>;
};

async function readRawSessionMessages(sessionID: string): Promise<RawSessionMessage[]> {
  const response = await fetch(`${BASE_URL}/session/${sessionID}/message`);
  if (!response.ok) {
    throw new Error(`Failed to load session messages for ${sessionID}: ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Session messages for ${sessionID} were not an array.`);
  }
  return data as RawSessionMessage[];
}

function flattenMessageText(message: RawSessionMessage): string {
  return (message.parts ?? [])
    .filter(
      (part): part is { type?: string; text?: string } =>
        part !== null && typeof part === "object",
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

async function waitForAssistantText(sessionID: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = (await readRawSessionMessages(sessionID))
      .filter((message) => message.info?.role === "assistant")
      .map(flattenMessageText)
      .find((text) => text.length > 0);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for assistant text in session ${sessionID}.`);
}

describe("improved-webtools live e2e", () => {
  it("proves webfetch executes via the plugin and returns real content from example.com", async () => {
    await withFixtureServer(
      {
        "/html": () => ({
          headers: { "content-type": "text/html; charset=utf-8" },
          body: "<!doctype html><html><body><h1>Example Domain</h1></body></html>",
        }),
      },
      async (baseUrl) => {
        let sessionID: string | undefined;
        try {
          sessionID = beginSession(
            `Call webfetch exactly once with url=${baseUrl}/html. Reply with ONLY the exact text returned by the tool, nothing else.`,
          );
          const output = await waitForAssistantText(sessionID, SESSION_TIMEOUT_MS);
          expect(output).toContain("Example Domain");
        } finally {
          if (sessionID) {
            try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
          }
        }
      },
    );
  }, SESSION_TIMEOUT_MS);

  it("proves repeated webfetch calls reuse the cached result on the second call", async () => {
    await withFixtureServer(
      {
        "/cache": (count) => ({
          headers: { "content-type": "text/html; charset=utf-8" },
          body: `<!doctype html><html><body><h1>cache body ${count}</h1></body></html>`,
        }),
      },
      async (baseUrl, counts) => {
        const sessionIDs: string[] = [];
        const cacheProofUrl = `${baseUrl}/cache`;
        try {
          const warmSessionID = beginSession(
            `Call webfetch exactly once with url=${cacheProofUrl} and overwrite_cache=true. Reply with ONLY DONE.`,
          );
          sessionIDs.push(warmSessionID);
          await waitForAssistantText(warmSessionID, SESSION_TIMEOUT_MS);

          const proofSessionID = beginSession(
            `Call the tool named webfetch exactly once with url=${cacheProofUrl}. Reply with ONLY the exact text returned by the tool, nothing else.`,
          );
          sessionIDs.push(proofSessionID);
          const output = await waitForAssistantText(proofSessionID, SESSION_TIMEOUT_MS);
          expect(output).toContain("cache body 1");
          expect(counts.get("/cache")).toBe(1);
        } finally {
          for (const sessionID of sessionIDs) {
            try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
          }
        }
      },
    );
  }, SESSION_TIMEOUT_MS);

  it("proves pdf webfetch returns the temp-download contract instead of a generic binary notice", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4\nfixture\n");
    await withFixtureServer(
      {
        "/doc.pdf": () => ({
          headers: {
            "content-type": "application/pdf",
            "content-length": String(pdfBytes.length),
          },
          body: pdfBytes,
        }),
      },
      async (baseUrl) => {
        let sessionID: string | undefined;
        try {
          sessionID = beginSession(
            `Call the tool named webfetch exactly once with url=${baseUrl}/doc.pdf and overwrite_cache=true. Reply with ONLY the exact line from the tool output that begins with 'Saved PDF:'.`,
          );
          const output = await waitForAssistantText(sessionID, SESSION_TIMEOUT_MS);
          expect(output).toContain("Saved PDF: /tmp/webfetch-pdf-");
        } finally {
          if (sessionID) {
            try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
          }
        }
      },
    );
  }, SESSION_TIMEOUT_MS);

  it("proves overwrite_cache forces a fresh fetch after a cached response exists", async () => {
    await withFixtureServer(
      {
        "/refresh": (count) => ({
          headers: { "content-type": "text/html; charset=utf-8" },
          body: `<!doctype html><html><body><h1>refresh body ${count}</h1></body></html>`,
        }),
      },
      async (baseUrl, counts) => {
        const sessionIDs: string[] = [];
        const refreshProofUrl = `${baseUrl}/refresh`;
        try {
          const warmSessionID = beginSession(
            `Call webfetch exactly once with url=${refreshProofUrl} and overwrite_cache=true. Reply with ONLY DONE.`,
          );
          sessionIDs.push(warmSessionID);
          await waitForAssistantText(warmSessionID, SESSION_TIMEOUT_MS);

          const cacheSessionID = beginSession(
            `Call the tool named webfetch exactly once with url=${refreshProofUrl}. Reply with ONLY DONE.`,
          );
          sessionIDs.push(cacheSessionID);
          await waitForAssistantText(cacheSessionID, SESSION_TIMEOUT_MS);

          const refreshSessionID = beginSession(
            `Call the tool named webfetch exactly once with url=${refreshProofUrl} and overwrite_cache=true. Reply with ONLY the exact text returned by the tool, nothing else.`,
          );
          sessionIDs.push(refreshSessionID);
          const output = await waitForAssistantText(refreshSessionID, SESSION_TIMEOUT_MS);
          expect(output).toContain("refresh body 2");
          expect(counts.get("/refresh")).toBe(2);
        } finally {
          for (const sessionID of sessionIDs) {
            try { runOcm(["delete", sessionID]); } catch { /* best-effort */ }
          }
        }
      },
    );
  }, SESSION_TIMEOUT_MS);
});
