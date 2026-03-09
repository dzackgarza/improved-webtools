import { fetchYoutubeTranscriptMarkdown } from "../src/webfetch-handlers/domains/youtube";

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

async function main() {
  const cookiesFile = (process.env.YTDLP_COOKIES_FILE ?? "").trim();
  if (!cookiesFile) {
    throw new Error("YTDLP_COOKIES_FILE must point to a Netscape-format cookie jar for live YouTube verification.");
  }

  const success = await fetchYoutubeTranscriptMarkdown({
    url: new URL("https://www.youtube.com/watch?v=LpSDuDIaBGk"),
    runCommand,
  });
  assertContains(success.content, "# YouTube Transcript", "TED success case");
  assertContains(success.content, "- Source: English captions (yt-dlp)", "TED success case");
  assertContains(
    success.content,
    "Aim to interact with five\ndifferent people each week,",
    "TED success case middle transcript",
  );

  const failure = await fetchYoutubeTranscriptMarkdown({
    url: new URL("https://www.youtube.com/watch?v=aaaaaaaaaaa"),
    runCommand,
  });
  assertContains(failure.content, "Transcript extraction failed at subtitle discovery.", "invalid-video case");
  assertContains(failure.content, "Video unavailable", "invalid-video case");

  console.log("PASS: YouTube live verification succeeded.");
  console.log("PASS: TED talk captions were extracted from the real handler path.");
  console.log("PASS: Invalid-video failure reporting remained intact.");
}

await main();
