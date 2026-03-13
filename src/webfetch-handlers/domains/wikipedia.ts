import type { RunCommand, WebFetchHandlerResult } from "../types.ts";

export const WIKIPEDIA_DOMAINS = ["wikipedia.org"] as const;

function extractWikipediaTitle(url: URL): string | undefined {
  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (parts[0] === "wiki" && parts.length >= 2) {
    return parts.slice(1).join("/").trim();
  }

  if (parts[0] === "w" && parts[1] === "index.php") {
    const title = (url.searchParams.get("title") ?? "").trim();
    if (title) return decodeURIComponent(title);
  }

  return undefined;
}

function normalizeWikipediaSourceUrl(url: URL, title: string): string {
  const normalizedTitle = title.replaceAll(" ", "_");
  const encodedTitle = encodeURIComponent(normalizedTitle).replaceAll("%2F", "/");
  return `${url.protocol}//${url.host}/wiki/${encodedTitle}`;
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function parseWikipediaDisplayTitle(input: { displayTitle?: string; fallbackTitle: string }): string {
  const candidate = (input.displayTitle ?? "").trim() || input.fallbackTitle;
  const noTags = candidate.replaceAll(/<[^>]+>/g, "");
  const decoded = decodeBasicHtmlEntities(noTags);
  return decoded.trim() || input.fallbackTitle;
}

type WikipediaParseApiResponse = {
  parse?: {
    title?: string;
    displaytitle?: string;
    text?: string;
  };
  error?: {
    code?: string;
    info?: string;
  };
};

/**
 * Strips common Wikipedia UI clutter from HTML using Bun's HTMLRewriter.
 * Also converts relative URLs to absolute.
 */
function cleanWikipediaHtml(html: string, baseUrl: URL): string {
  const clutterSelectors = [
    ".infobox",
    ".sidebar",
    ".navbox",
    ".mw-editsection",
    ".reflist",
    ".metadata",
    ".ambox",
    ".asbox",
    ".catlinks",
    "style",
    "script",
    ".hatnote",
    ".noprint",
    ".navigation-not-searchable",
    "figure",
    "img",
    "table.sidebar",
    ".reference", // Strip citation numbers [1][2]
    "sup.reference"
  ];

  let rewriter = new HTMLRewriter();
  for (const selector of clutterSelectors) {
    rewriter = rewriter.on(selector, {
      element(element) {
        element.remove();
      },
    });
  }

  // Convert relative links to absolute
  rewriter = rewriter.on("a[href]", {
    element(element) {
      const href = element.getAttribute("href");
      if (href && (href.startsWith("/") || href.startsWith("#"))) {
        try {
          element.setAttribute("href", new URL(href, baseUrl).toString());
        } catch {
          // Ignore invalid URL parts
        }
      }
    },
  });

  return rewriter.transform(html);
}

/**
 * Converts Wikipedia HTML to Markdown using pandoc.
 */
async function convertWikipediaHtmlToMarkdown(input: {
  html: string;
  sourceUrl: string;
  pageTitle: string;
  runCommand: RunCommand;
  convertTimeoutMs: number;
}): Promise<string> {
  const tempDir = (await Bun.$`mktemp -d /tmp/webfetch-wikipedia-XXXXXX`.text()).trim();
  const htmlPath = `${tempDir}/article.html`;
  try {
    const cleanedHtml = cleanWikipediaHtml(input.html, new URL(input.sourceUrl));
    await Bun.write(htmlPath, cleanedHtml);
    
    // We use pandoc to convert the HTML article to markdown.
    // We disable raw_html to force pandoc to strip or convert all HTML tags.
    const convert = await input.runCommand(
      [
        "pandoc",
        "--from", "html",
        "--to", "markdown-raw_html",
        "--strip-comments",
        "--reference-links", // Use reference links for a cleaner look
        htmlPath
      ],
      input.convertTimeoutMs,
    );
    
    if (convert.exitCode !== 0) {
      throw new Error(`wikipedia markdown conversion via pandoc failed (exit ${convert.exitCode}): ${convert.stderrText.trim()}`);
    }
    
    const markdown = convert.stdoutText.trim();
    if (!markdown) {
      throw new Error("wikipedia markdown conversion via pandoc returned empty content.");
    }
    
    return `# ${input.pageTitle}\n\nSource: ${input.sourceUrl}\n\n---\n\n${markdown}`;
  } finally {
    await Bun.$`rm -rf ${tempDir}`.quiet();
  }
}

export async function fetchWikipediaMarkdown(input: {
  url: URL;
  runCommand: RunCommand;
  userAgent: string;
  convertTimeoutMs: number;
}): Promise<WebFetchHandlerResult> {
  const title = extractWikipediaTitle(input.url);
  if (!title) {
    throw new Error("unsupported wikipedia URL shape: expected /wiki/<title> or /w/index.php?title=<title>");
  }

  const apiUrl = new URL(`${input.url.protocol}//${input.url.host}/w/api.php`);
  apiUrl.searchParams.set("action", "parse");
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("formatversion", "2");
  apiUrl.searchParams.set("prop", "displaytitle|text");
  apiUrl.searchParams.set("page", title);

  const response = await fetch(apiUrl.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": input.userAgent,
    },
  });
  if (!response.ok) {
    throw new Error(`wikipedia parse API failed (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as WikipediaParseApiResponse;
  if (payload.error) {
    throw new Error(`wikipedia parse API error (${payload.error.code ?? "unknown"}): ${payload.error.info ?? "unknown error"}`);
  }

  const html = payload.parse?.text;
  if (typeof html !== "string" || !html.trim()) {
    throw new Error("wikipedia parse API returned no article HTML.");
  }

  const sourceUrl = normalizeWikipediaSourceUrl(input.url, title);
  const normalizedTitle = parseWikipediaDisplayTitle({
    displayTitle: payload.parse?.displaytitle,
    fallbackTitle: payload.parse?.title?.trim() || title.replaceAll("_", " "),
  });
  
  const markdown = await convertWikipediaHtmlToMarkdown({
    html,
    sourceUrl,
    pageTitle: normalizedTitle,
    runCommand: input.runCommand,
    convertTimeoutMs: input.convertTimeoutMs,
  });

  return {
    routeName: "wikipedia",
    sourceUrl,
    content: markdown,
  };
}
