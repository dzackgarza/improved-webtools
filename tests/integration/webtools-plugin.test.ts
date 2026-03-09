import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { PASSPHRASE_WEBFETCH, PASSPHRASE_WEB_SEARCH } from "../../src/passphrases";

const OPENCODE = "/home/dzack/.opencode/bin/opencode";
const TOOL_DIR = "/home/dzack/opencode-plugins/improved-webtools";
const MAX_BUFFER = 8 * 1024 * 1024;

function run(prompt: string, timeout = 180_000) {
  const result = spawnSync(OPENCODE, ["run", "--agent", "Minimal", prompt], {
    cwd: TOOL_DIR,
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      OPENCODE_CONFIG: `${TOOL_DIR}/.config/opencode.json`,
    },
  });
  if (result.error) throw result.error;
  return (result.stdout ?? "") + (result.stderr ?? "");
}

describe("improved-webtools live e2e", () => {
  it("proves webfetch relays the hidden tool passphrase", () => {
    const output = run(
      "Call the tool named webfetch with url=https://example.com. Then reply with ONLY the exact passphrase returned by that tool, nothing else.",
    );
    expect(output).toContain(PASSPHRASE_WEBFETCH);
  }, 200_000);

  it("proves canonical websearch relays the hidden tool passphrase", () => {
    const output = run(
      "Call the tool named websearch with query='openai'. Then reply with ONLY the exact passphrase returned by that tool, nothing else.",
    );
    expect(output).toContain(PASSPHRASE_WEB_SEARCH);
  }, 200_000);
});
