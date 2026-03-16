import { hostMatchesDomain, type RunCommand, type WebFetchHandlerResult } from "../types.ts";

export const YOUTUBE_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
] as const;

export const YTDLP_ARGS = [
  "uvx",
  "--from",
  "yt-dlp[default,curl-cffi]",
  "yt-dlp",
  "--remote-components",
  "ejs:github",
  "--js-runtimes",
  "bun",
  "--js-runtimes",
  "node",
] as const;

function buildYtDlpCommand(extraArgs: string[]): string[] {
  const cookiesFile = (process.env.YTDLP_COOKIES_FILE ?? "").trim();
  return [
    ...YTDLP_ARGS,
    ...(cookiesFile ? ["--cookies", cookiesFile] : []),
    ...extraArgs,
  ];
}

function normalizeYoutubeUrl(url: URL): URL {
  if (hostMatchesDomain(url.hostname, "youtu.be")) {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    if (videoId) {
      const normalized = new URL("https://www.youtube.com/watch");
      normalized.searchParams.set("v", decodeURIComponent(videoId));
      const t = url.searchParams.get("t");
      if (t) normalized.searchParams.set("t", t);
      return normalized;
    }
  }
  return new URL(url.toString());
}

function htmlEntityDecode(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function vttToPlainText(vtt: string): string {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let prev = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "WEBVTT") continue;
    if (/^\d+$/.test(line)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(line)) continue;
    if (/^NOTE\b/.test(line)) continue;
    const clean = htmlEntityDecode(line.replaceAll(/<[^>]+>/g, "").trim());
    if (!clean) continue;
    if (clean === prev) continue;
    out.push(clean);
    prev = clean;
  }
  return out.join("\n");
}

async function pickTranscriptFile(tempDir: string): Promise<string | undefined> {
  const files = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: tempDir }));
  const prioritized = [
    files.find((name) => name.endsWith(".en.vtt")),
    files.find((name) => name.endsWith(".en-orig.vtt")),
    files.find((name) => name.endsWith(".vtt")),
    files.find((name) => name.endsWith(".txt")),
  ].filter(Boolean) as string[];
  const first = prioritized[0];
  if (!first) return undefined;
  return `${tempDir}/${first}`;
}

function sanitizeStderr(stderr: string): string {
  let clean = stderr;
  const cookiesFile = (process.env.YTDLP_COOKIES_FILE ?? "").trim();
  if (cookiesFile) {
    clean = clean.replaceAll(cookiesFile, "[REDACTED_COOKIES_PATH]");
  }
  // Redact any absolute paths that look like config/credential files
  const sensitivePathRegex = /(?:^|\s)(\/(?:[\w.-]+\/)*[\w.-]*(?:cookie|config|cred|secret|auth|netrc|token|key)[\w.-]*)(?:\s|$)/gi;
  clean = clean.replaceAll(sensitivePathRegex, " [REDACTED_PATH] ");
  return clean.trim();
}

export async function fetchYoutubeTranscriptMarkdown(input: {
  url: URL;
  runCommand: RunCommand;
}): Promise<WebFetchHandlerResult> {
  const sourceUrl = normalizeYoutubeUrl(input.url);
  const tempDir = (await Bun.$`mktemp -d /tmp/webfetch-youtube-XXXXXX`.text()).trim();
  try {
    const listSubs = await input.runCommand(buildYtDlpCommand(["--list-subs", sourceUrl.toString()]));
    if (listSubs.exitCode !== 0) {
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Transcript extraction failed at subtitle discovery.",
          `Reason: ${sanitizeStderr(listSubs.stderrText) || `yt-dlp exited ${listSubs.exitCode}`}`,
          "",
          "Pipeline requirements:",
          "- yt-dlp with curl-cffi impersonation support.",
          "- yt-dlp remote components (ejs:github) and a JS runtime (bun/node/deno).",
          "- ffmpeg + ffprobe for audio processing.",
          "- openai-whisper for speech transcription when subtitles are unavailable.",
        ].join("\n"),
      };
    }

    const outputTemplate = `${tempDir}/%(id)s.%(ext)s`;
    const subtitleDownload = await input.runCommand(buildYtDlpCommand([
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      "en,en-orig",
      "--sub-format",
      "vtt",
      "-o",
      outputTemplate,
      sourceUrl.toString(),
    ]));

    const subtitlePath = subtitleDownload.exitCode === 0 ? await pickTranscriptFile(tempDir) : undefined;
    if (subtitlePath && subtitlePath.endsWith(".vtt")) {
      const subtitleRaw = await Bun.file(subtitlePath).text();
      const transcript = vttToPlainText(subtitleRaw).trim();
      if (transcript) {
        return {
          routeName: "youtube",
          sourceUrl: sourceUrl.toString(),
          content: [
            "# YouTube Transcript",
            "",
            `- URL: ${sourceUrl.toString()}`,
            "- Source: English captions (yt-dlp)",
            "",
            "## Transcript",
            "",
            transcript,
          ].join("\n"),
        };
      }
    }

    const audioDownload = await input.runCommand(buildYtDlpCommand([
      "-x",
      "--audio-format",
      "mp3",
      "-o",
      outputTemplate,
      sourceUrl.toString(),
    ]));
    if (audioDownload.exitCode !== 0) {
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Transcript extraction failed at audio download stage.",
          `Reason: ${sanitizeStderr(audioDownload.stderrText) || `yt-dlp exited ${audioDownload.exitCode}`}`,
          "",
          "Check that YouTube access is available from this environment and bot-check/cookies requirements are satisfied.",
        ].join("\n"),
      };
    }

    const files = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: tempDir }));
    const audioFile = files.find((name) => name.endsWith(".mp3"));
    if (!audioFile) {
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Audio download succeeded but no MP3 artifact was found for Whisper transcription.",
        ].join("\n"),
      };
    }

    const audioPath = `${tempDir}/${audioFile}`;
    const whisper = await input.runCommand([
      "uvx",
      "--from",
      "openai-whisper",
      "whisper",
      "--model",
      "tiny",
      "--language",
      "en",
      "--task",
      "transcribe",
      "--output_format",
      "txt",
      "--output_dir",
      tempDir,
      audioPath,
    ]);
    if (whisper.exitCode !== 0) {
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Whisper transcription stage failed.",
          `Reason: ${sanitizeStderr(whisper.stderrText) || `whisper exited ${whisper.exitCode}`}`,
        ].join("\n"),
      };
    }

    const whisperPath = await pickTranscriptFile(tempDir);
    if (!whisperPath || !whisperPath.endsWith(".txt")) {
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Whisper stage completed but no transcript text file was found.",
        ].join("\n"),
      };
    }

    const transcript = (await Bun.file(whisperPath).text()).trim();
    return {
      routeName: "youtube",
      sourceUrl: sourceUrl.toString(),
      content: [
        "# YouTube Transcript",
        "",
        `- URL: ${sourceUrl.toString()}`,
        "- Source: Whisper transcription (English)",
        "",
        "## Transcript",
        "",
        transcript || "[empty transcript]",
      ].join("\n"),
    };
  } finally {
    await Bun.$`rm -rf ${tempDir}`.quiet();
  }
}
