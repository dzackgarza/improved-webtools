import { fetchYoutubeTranscriptMarkdown } from "../src/webfetch-handlers/domains/youtube";

function readTimeoutMs() {
  const raw = (process.env.YOUTUBE_VERIFY_TIMEOUT_MS ?? "").trim();
  if (!raw) return 600_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`YOUTUBE_VERIFY_TIMEOUT_MS must be a positive integer, received: ${raw}`);
  }
  return parsed;
}

async function runCommand(args: string[], timeoutMs = readTimeoutMs()) {
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

async function assertCommandSucceeds(args: string[], label: string, timeoutMs = 120_000) {
  const result = await runCommand(args, timeoutMs);
  if (result.exitCode !== 0) {
    const detail = result.stderrText.trim() || result.stdoutText.trim() || `exit ${result.exitCode}`;
    throw new Error(`${label} preflight failed: ${detail}`);
  }
}

async function main() {
  const cookiesFile = (process.env.YTDLP_COOKIES_FILE ?? "").trim();
  if (!cookiesFile) {
    throw new Error("YTDLP_COOKIES_FILE must point to a Netscape-format cookie jar for live YouTube verification.");
  }

  await assertCommandSucceeds(["uvx", "--version"], "uvx");
  await assertCommandSucceeds(
    ["uvx", "--from", "yt-dlp[default,curl-cffi]", "yt-dlp", "--version"],
    "yt-dlp via uvx",
  );
  await assertCommandSucceeds(
    ["uvx", "--from", "openai-whisper", "whisper", "--help"],
    "openai-whisper via uvx",
  );

  const captions = await fetchYoutubeTranscriptMarkdown({
    url: new URL("https://www.youtube.com/watch?v=LpSDuDIaBGk"),
    runCommand,
  });
  assertContains(captions.content, "# YouTube Transcript", "TED success case");
  assertContains(captions.content, "- Source: English captions (yt-dlp)", "TED success case");
  assertContains(
    captions.content,
    "Aim to interact with five\ndifferent people each week,",
    "TED success case middle transcript",
  );

  const whisper = await fetchYoutubeTranscriptMarkdown({
    url: new URL("https://www.youtube.com/watch?v=S26agrzKCro"),
    runCommand,
  });
  assertContains(whisper.content, "# YouTube Transcript", "Whisper success case");
  assertContains(whisper.content, "- Source: Whisper transcription (English)", "Whisper success case");
  assertContains(
    whisper.content,
    "I expect that the battle of Britain is about to begin.",
    "Whisper success case transcript",
  );

  const failure = await fetchYoutubeTranscriptMarkdown({
    url: new URL("https://www.youtube.com/watch?v=aaaaaaaaaaa"),
    runCommand,
  });
  assertContains(failure.content, "Transcript extraction failed at subtitle discovery.", "invalid-video case");
  assertContains(failure.content, "Video unavailable", "invalid-video case");

  console.log("PASS: YouTube live verification succeeded.");
  console.log("PASS: TED talk captions were extracted from the real handler path.");
  console.log("PASS: Whisper transcription was exercised on a live no-subtitles clip.");
  console.log("PASS: Invalid-video failure reporting remained intact.");
}

await main();
