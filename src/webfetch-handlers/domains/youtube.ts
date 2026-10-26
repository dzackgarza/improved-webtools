import { hostMatchesDomain, type RunCommand, type WebFetchHandlerResult } from "../types.ts";
import { WebVTTParser, type TreeNode, type VTTData } from "webvtt-parser";

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

type DependencyCheckResult = {
  name: string;
  missing: boolean;
};

type TimestampedCaptionLine = {
  start: string;
  text: string;
};

function buildYtDlpCommand(extraArgs: string[]): string[] {
  const cookiesFile = (process.env.YTDLP_COOKIES_FILE ?? "").trim();
  return [
    ...YTDLP_ARGS,
    ...(cookiesFile ? ["--cookies", cookiesFile] : []),
    ...extraArgs,
  ];
}

function redactCookiesPath(text: string, cookiesFile: string): string {
  if (!cookiesFile) return text;
  const replacement = "[redacted-cookies-file]";
  const normalized = text.replaceAll(cookiesFile, replacement);
  const encoded = encodeURIComponent(cookiesFile);
  if (encoded !== cookiesFile) {
    return normalized.replaceAll(encoded, replacement);
  }
  return normalized;
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

function formatVttTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const millis = String(ms % 1000).padStart(3, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${millis}`;
}

function cueTreeToText(node: TreeNode): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type === "timestamp") {
    return "";
  }
  return node.children.map((child) => cueTreeToText(child)).join("");
}

function normalizeCueText(rawText: string): string {
  const tokens = rawText
    .split("\n")
    .flatMap((line) =>
      line
        .replaceAll("\r", "")
        .replaceAll("\t", " ")
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length > 0),
    );
  return tokens.join(" ");
}

function parseWebVtt(vtt: string): VTTData {
  return new WebVTTParser().parse(vtt, "metadata");
}

async function checkYouTubeDependencies(runCommand: RunCommand): Promise<string[]> {
  const commands = ["uvx", "ffmpeg", "ffprobe", "bun", "node", "deno"];
  const checkScript = (command: string) =>
    `command -v ${JSON.stringify(command)} >/dev/null 2>&1 && echo "DEP_CHECK:${command}:1" || echo "DEP_CHECK:${command}:0"`;

  const checkPromises = commands.map(async (command) => {
    try {
      const checkResult = await runCommand(["sh", "-lc", checkScript(command)]);
      const match = checkResult.stdoutText
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith(`DEP_CHECK:${command}:`));
      if (match) {
        const payload = match.slice("DEP_CHECK:".length);
        const parts = payload.split(":");
        if (parts.length === 2 && parts[1] === "1") {
          return { name: command, available: true };
        }
      }
      return { name: command, available: false };
    } catch {
      return { name: command, available: false };
    }
  });

  const results = await Promise.all(checkPromises);
  const available = new Map<string, boolean>();
  for (const result of results) {
    available.set(result.name, result.available);
  }

  const hasUvx = available.get("uvx") ?? false;
  const hasFfmpeg = available.get("ffmpeg") ?? false;
  const hasFfprobe = available.get("ffprobe") ?? false;
  const hasBun = available.get("bun") ?? false;
  const hasNode = available.get("node") ?? false;
  const hasDeno = available.get("deno") ?? false;

  const checks: DependencyCheckResult[] = [
    { name: "uvx", missing: !hasUvx },
    {
      name: "bun | node | deno",
      missing: !(hasBun || hasNode || hasDeno),
    },
    { name: "ffmpeg", missing: !hasFfmpeg },
    { name: "ffprobe", missing: !hasFfprobe },
  ];

  return checks.filter((check) => check.missing).map((check) => check.name);
}

function vttToPlainText(vtt: string): string {
  const parsed = parseWebVtt(vtt);
  const out: TimestampedCaptionLine[] = [];

  for (const cue of parsed.cues) {
    const text = normalizeCueText(cueTreeToText(cue.tree));
    if (!text) {
      continue;
    }
    out.push({
      start: formatVttTimestamp(cue.startTime),
      text,
    });
  }

  if (out.length === 0) {
    return "";
  }

  return out.map((cue) => `${cue.start} ${cue.text}`).join("\n");
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

export async function fetchYoutubeTranscriptMarkdown(input: {
  url: URL;
  runCommand: RunCommand;
}): Promise<WebFetchHandlerResult> {
  const missingDependencies = await checkYouTubeDependencies(input.runCommand);
  if (missingDependencies.length > 0) {
    return {
      routeName: "youtube",
      sourceUrl: input.url.toString(),
      content: [
        "# YouTube Transcript",
        "",
        "Transcript extraction could not start.",
        "Missing required dependencies:",
        ...missingDependencies.map((name) => `- ${name}`),
        "",
        "Install these requirements and retry.",
      ].join("\n"),
    };
  }

  const sourceUrl = normalizeYoutubeUrl(input.url);
  const tempDir = (await Bun.$`mktemp -d /tmp/webfetch-youtube-XXXXXX`.text()).trim();
  const cookiesFile = (process.env.YTDLP_COOKIES_FILE ?? "").trim();
  try {
    const listSubs = await input.runCommand(buildYtDlpCommand(["--list-subs", sourceUrl.toString()]));
    if (listSubs.exitCode !== 0) {
      const reason = redactCookiesPath(listSubs.stderrText.trim(), cookiesFile);
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Transcript extraction failed at subtitle discovery.",
          `Reason: ${reason || `yt-dlp exited ${listSubs.exitCode}`}`,
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
      const reason = redactCookiesPath(audioDownload.stderrText.trim(), cookiesFile);
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Transcript extraction failed at audio download stage.",
          `Reason: ${reason || `yt-dlp exited ${audioDownload.exitCode}`}`,
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
      const reason = redactCookiesPath(whisper.stderrText.trim(), cookiesFile);
      return {
        routeName: "youtube",
        sourceUrl: sourceUrl.toString(),
        content: [
          "# YouTube Transcript",
          "",
          "Whisper transcription stage failed.",
          `Reason: ${reason || `whisper exited ${whisper.exitCode}`}`,
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
