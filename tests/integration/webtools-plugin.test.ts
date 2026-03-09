import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

const OPENCODE = "/home/dzack/.opencode/bin/opencode";
const TOOL_DIR = "/home/dzack/opencode-plugins/improved-webtools";
const MAX_BUFFER = 8 * 1024 * 1024;

function run(prompt: string, timeout = 180_000) {
  spawnSync("direnv", ["allow", TOOL_DIR], { cwd: TOOL_DIR, timeout: 30_000 });
  const result = spawnSync(
    "direnv",
    ["exec", TOOL_DIR, OPENCODE, "run", "--agent", "Minimal", prompt],
    { cwd: process.env.HOME, encoding: "utf8", timeout, maxBuffer: MAX_BUFFER },
  );
  if (result.error) throw result.error;
  return (result.stdout ?? "") + (result.stderr ?? "");
}

describe("improved-webtools live e2e", () => {
  it("proves webfetch can be invoked in a live OpenCode session", () => {
    const output = run(
      "If you can use a tool named webfetch, call it with url=https://example.com and then reply with ONLY READY. Otherwise reply with ONLY NO_TOOL.",
    );
    expect(output).toContain("WebFetch https://example.com");
    expect(output).toContain("READY");
  }, 200_000);

  it("proves improved_websearch relays the tool passphrase", () => {
    const output = run(
      "If you can use a tool named improved_websearch, call it with query='openai' and then reply with ONLY READY. Otherwise reply with ONLY NO_TOOL.",
    );
    expect(output).toContain("improved_websearch");
    expect(output).toContain("READY");
  }, 200_000);
});
