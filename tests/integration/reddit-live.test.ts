import { describe, expect, it } from "bun:test";

import { fetchRedditPostMarkdown } from "../../src/webfetch-handlers/domains/reddit";

async function runCommand(args: string[], timeoutMs = 120_000) {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdoutText, stderrText, exitCode };
  } finally {
    clearTimeout(timeout);
  }
}

describe("reddit live verification", () => {
  it("extracts a real Reddit post and nested comments through the Apify actor", async () => {
    const result = await fetchRedditPostMarkdown({
      url: new URL("https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/"),
      runCommand,
      fetchFallbackWithW3M: async () => ({
        stdoutText: "",
        stderrText: "fallback should not run for a Reddit post permalink",
        exitCode: 1,
      }),
      apifyActor: process.env.REDDIT_APIFY_ACTOR ?? "spry_wholemeal/reddit-scraper",
    });

    expect(result.routeName).toBe("reddit");
    expect(result.sourceUrl).toBe(
      "https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/",
    );
    expect(result.content).toContain("# Reddit Post");
    expect(result.content).toContain("## Title");
    expect(result.content).toContain("Anyone Else Excited for o3 Mini Release?");
    expect(result.content).toContain("- Subreddit: r/OpenAI");
    expect(result.content).toContain("- Author: u/Thinklikeachef");
    expect(result.content).toContain("## Comments (nested)");
    expect(result.content).toContain("- u/The_GSingh");
    expect(result.content).toContain("When is it even coming out.");
  }, 180_000);
});
