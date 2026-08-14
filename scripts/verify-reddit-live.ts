import { fetchRedditPostMarkdown } from "../src/webfetch-handlers/domains/reddit";

async function runCommand(args: string[], timeoutMs = 180_000) {
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

function assertContains(text: string, expected: string, label: string) {
  if (!text.includes(expected)) {
    throw new Error(`${label} missing expected text: ${expected}`);
  }
}

function assertMatches(text: string, pattern: RegExp, label: string) {
  if (!pattern.test(text)) {
    throw new Error(`${label} missing expected pattern: ${pattern}`);
  }
}

async function main() {
  const result = await fetchRedditPostMarkdown({
    url: new URL("https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/"),
    runCommand,
  });

  assertContains(result.content, "# Reddit Post", "reddit success case");
  assertContains(result.content, "Anyone Else Excited for o3 Mini Release?", "reddit success case");
  assertContains(result.content, "- Subreddit: r/OpenAI", "reddit success case");
  assertContains(result.content, "## Comments (nested)", "reddit success case");
  assertMatches(result.content, /^- Comments extracted: [1-9][0-9]*$/m, "reddit success case");
  if (result.content.includes("[no comments extracted]")) {
    throw new Error("reddit success case unexpectedly returned an empty comment tree");
  }

  console.log("PASS: Reddit live verification succeeded.");
  console.log("PASS: PullPush returned the expected post metadata.");
  console.log("PASS: Nested comments were rendered from the live API response.");
}

await main();
