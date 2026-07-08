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

type DependencyCheckResult = {
  name: string;
  missing: boolean;
};

type TimestampedCaptionLine = {
  start: string;
  text: string;
};

const VTT_TIMESTAMP_LINE = /^(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/;

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

function htmlEntityDecode(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripVttTags(text: string): string {
  return htmlEntityDecode(
    text
      .replaceAll(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, "")
      .replaceAll(/<\/?[^>]+>/g, "")
      .replace(/^\uFEFF/, "")
      .trim(),
  );
}

async function checkYouTubeDependencies(runCommand: RunCommand): Promise<string[]> {
  async function commandExists(command: string): Promise<boolean> {
    const result = await runCommand(["sh", "-lc", `command -v ${JSON.stringify(command)} >/dev/null 2>&1`]);
    return result.exitCode === 0;
  }

  const [hasUvx, hasFfmpeg, hasFfprobe, hasBun, hasNode, hasDeno] = await Promise.all([
    commandExists("uvx"),
    commandExists("ffmpeg"),
    commandExists("ffprobe"),
    commandExists("bun"),
    commandExists("node"),
    commandExists("deno"),
  ]);

  const checks: DependencyCheckResult[] = [
    { name: "uvx", missing: !hasUvx },
    { name: "ffmpeg", missing: !hasFfmpeg },
    { name: "ffprobe", missing: !hasFfprobe },
    {
      name: "bun | node | deno",
      missing: !(hasBun || hasNode || hasDeno),
    },
  ];

  return checks.filter((check) => check.missing).map((check) => check.name);
}

function vttToPlainText(vtt: string): string {
  const lines = vtt.replace(/\r/g, "").split("\n");
  const out: TimestampedCaptionLine[] = [];
  let currentStart: string | null = null;
  let currentLines: string[] = [];
  let hadTimestampLine = false;

  const flushCue = () => {
    if (!currentStart) {
      return;
    }
    const text = stripVttTags(currentLines.join(" "));
    if (!text) {
      return;
    }
    out.push({ start: currentStart, text });
    currentStart = null;
    currentLines = [];
  };

  const pushFallback = () => {
    // Backward compatible path for non-timestamped subtitle dumps.
    const fallback = lines
      .map((raw) => stripVttTags(raw))
      .filter(Boolean)
      .filter((line) => line !== "WEBVTT" && line !== "Kind: captions" && line !== "Language: en")
      .filter((line) => !/^NOTE\b/.test(line) && !/^\d+$/.test(line))
      .filter((line) => !VTT_TIMESTAMP_LINE.test(line));
    const normalized = fallback.map((line) => line.trim()).filter(Boolean);
    for (const line of normalized) {
      out.push({ start: "", text: line });
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (currentStart !== null) {
        flushCue();
      }
      continue;
    }

    if (line === "WEBVTT" || line === "Kind: captions" || line === "Language: en" || /^NOTE\b/.test(line)) {
      continue;
    }

    if (/^\d+$/.test(line)) {
      continue;
    }

    const match = line.match(VTT_TIMESTAMP_LINE);
    if (match) {
      flushCue();
      hadTimestampLine = true;
      currentStart = match[1]!.replace(",", ".");
      continue;
    }

    if (currentStart === null) {
      currentLines.push(raw);
    } else {
      currentLines.push(line);
    }
  }
  if (currentStart !== null) {
    flushCue();
  }

  if (out.length > 0) {
    const deduped: string[] = [];
    let prev = "";
    for (const cue of out) {
      if (cue.start) {
        const line = `${cue.start} ${cue.text}`;
        if (!line || line === prev) continue;
        deduped.push(line);
        prev = line;
      } else {
        const line = cue.text;
        if (!line || line === prev) continue;
        deduped.push(line);
        prev = line;
      }
    }
    return deduped.join("\n");
  }

  if (!hadTimestampLine) {
    pushFallback();
  }

  if (out.length > 0) {
    const deduped = [...new Set(out.map((cue) => cue.text))];
    return deduped.join("\n");
  }

  return "";
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
