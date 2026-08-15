import { fetchRedditPostMarkdown } from "../src/webfetch-handlers/domains/reddit";

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

export async function fetchLiveRedditPost(): Promise<string> {
  const result = await fetchRedditPostMarkdown({
    url: new URL("https://www.reddit.com/r/OpenAI/comments/1hn44qh/anyone_else_excited_for_o3_mini_release/"),
    fetchImpl: fetch,
  });

  return result.content;
}

async function main() {
  const content = await fetchLiveRedditPost();

  assertContains(content, "# Reddit Post", "reddit success case");
  assertContains(content, "Anyone Else Excited for o3 Mini Release?", "reddit success case");
  assertContains(content, "- Subreddit: r/OpenAI", "reddit success case");
  assertContains(content, "## Comments (nested)", "reddit success case");
  assertMatches(content, /^- Comments extracted: [1-9][0-9]*$/m, "reddit success case");
  assertMatches(content, /^  - u\/[^\n]+ \(score -?[0-9]+\):$/m, "reddit nested comment");
  if (content.includes("[no comments]")) {
    throw new Error("reddit success case unexpectedly returned an empty comment tree");
  }

  process.stdout.write("Reddit live verification passed.\n");
}

if (import.meta.main) await main();
