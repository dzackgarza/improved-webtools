import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { ResourceNotFoundError, hostMatchesDomain, type CommandExecutionResult, type RunCommand, type WebFetchHandlerResult } from "../types.ts";

export const ARXIV_DOMAINS = ["arxiv.org", "www.arxiv.org"] as const;

const ARXIV_ID_PATTERN = /^(?:[a-z.-]+\/\d{7}|\d{4}\.\d{4,5})$/i;

type ArxivMetadata = {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  primaryCategory: string;
  publishedDate: string;
  updatedDate: string;
  doi: string;
  journalRef: string;
  abstractUrl: string;
  pdfUrl: string;
  sourceUrl: string;
};

type ArxivLibraryArtifacts = {
  paperDir: string;
  metadataPath: string;
  summaryPath: string;
  bibtexPath: string;
  pdfPath: string;
  sourceArchivePath: string;
  sourceDir: string;
  markdownPath?: string;
  htmlPath?: string;
};

type FetchImpl = typeof fetch;

type FetchArxivLibraryContentInput = {
  url: URL;
  libraryDir?: string;
  fetchImpl?: FetchImpl;
  runCommand?: RunCommand;
  now?: Date;
  overwriteCache?: boolean;
};

type ArxivLibraryStatus = "built" | "hit" | "refreshed";
type ArxivStoredRecord = {
  metadata: ArxivMetadata;
  markdownPath?: string;
  htmlPath?: string;
  processedAt: string;
  lastAccessedAt: string;
  processingNotes: string[];
};

function xmlEntityDecode(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function cleanupXmlText(text: string | undefined): string {
  return xmlEntityDecode((text ?? "").replaceAll(/\s+/g, " ").trim());
}

function extractEntryXml(feedXml: string): string {
  const match = feedXml.match(/<entry>([\s\S]*?)<\/entry>/i);
  return match?.[1] ?? "";
}

function extractFirstTag(entryXml: string, tagName: string): string {
  const match = entryXml.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return cleanupXmlText(match?.[1]);
}

function extractAllAuthors(entryXml: string): string[] {
  return [...entryXml.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi)]
    .map((match) => cleanupXmlText(match[1]))
    .filter((author) => author.length > 0);
}

function extractAllCategories(entryXml: string): string[] {
  return [...entryXml.matchAll(/<category[^>]*term="([^"]+)"/gi)]
    .map((match) => cleanupXmlText(match[1]))
    .filter((category) => category.length > 0);
}

function metadataFromApiXml(arxivId: string, feedXml: string): ArxivMetadata {
  const entryXml = extractEntryXml(feedXml);
  const categories = extractAllCategories(entryXml);
  return {
    arxivId,
    title: extractFirstTag(entryXml, "title"),
    authors: extractAllAuthors(entryXml),
    abstract: extractFirstTag(entryXml, "summary"),
    categories,
    primaryCategory: categories[0] ?? "",
    publishedDate: extractFirstTag(entryXml, "published"),
    updatedDate: extractFirstTag(entryXml, "updated"),
    doi: extractFirstTag(entryXml, "arxiv:doi"),
    journalRef: extractFirstTag(entryXml, "arxiv:journal_ref"),
    abstractUrl: `https://arxiv.org/abs/${arxivId}`,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    sourceUrl: `https://arxiv.org/e-print/${arxivId}`,
  };
}

function yamlString(text: string): string {
  return JSON.stringify(text);
}

function parseYamlJsonString(label: string, contents: string | undefined): string {
  if (!contents) return "";
  const match = contents.match(new RegExp(`^${label}:\\s+(".*")$`, "m"));
  if (!match) return "";
  try {
    return JSON.parse(match[1]!);
  } catch {
    return "";
  }
}

function parseYamlList(label: string, contents: string | undefined): string[] {
  if (!contents) return [];
  const lines = contents.split(/\r?\n/g);
  const startIndex = lines.findIndex((line) => line === `${label}:`);
  if (startIndex < 0) return [];

  const values: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (!line.startsWith("  ")) break;
    const match = line.match(/^  -\s+(".*")$/);
    if (!match) continue;
    try {
      values.push(JSON.parse(match[1]!));
    } catch {
      continue;
    }
  }
  return values;
}

async function updateYamlTimestamp(path: string, label: string, value: string): Promise<void> {
  const existing = await readMaybe(path);
  if (!existing) return;
  const line = `${label}: ${yamlString(value)}`;
  const next = existing.match(new RegExp(`^${label}:\\s+.*$`, "m"))
    ? existing.replace(new RegExp(`^${label}:\\s+.*$`, "m"), line)
    : `${existing.trimEnd()}\n${line}\n`;
  await writeFile(path, next);
}

function parseStoredArxivRecord(arxivId: string, contents: string | undefined): ArxivStoredRecord {
  return {
    metadata: {
      arxivId,
      title: parseYamlJsonString("title", contents),
      authors: parseYamlList("authors", contents),
      abstract: parseYamlJsonString("abstract", contents),
      categories: parseYamlList("categories", contents),
      primaryCategory: parseYamlJsonString("primary_category", contents),
      publishedDate: parseYamlJsonString("published_date", contents),
      updatedDate: parseYamlJsonString("updated_date", contents),
      doi: parseYamlJsonString("doi", contents),
      journalRef: parseYamlJsonString("journal_ref", contents),
      abstractUrl: parseYamlJsonString("abstract_url", contents) || `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: parseYamlJsonString("pdf_url", contents) || `https://arxiv.org/pdf/${arxivId}.pdf`,
      sourceUrl: parseYamlJsonString("source_url", contents) || `https://arxiv.org/e-print/${arxivId}`,
    },
    markdownPath: parseYamlJsonString("markdown_path", contents) || undefined,
    htmlPath: parseYamlJsonString("html_path", contents) || undefined,
    processedAt: parseYamlJsonString("processed_at", contents),
    lastAccessedAt: parseYamlJsonString("last_accessed_at", contents),
    processingNotes: parseYamlList("processing_notes", contents),
  };
}

function yamlList(values: string[], indent = 0): string[] {
  const prefix = " ".repeat(indent);
  if (values.length === 0) return [`${prefix}[]`];
  return values.map((value) => `${prefix}- ${yamlString(value)}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readMaybe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function collectTexFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTexFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".tex")) {
      files.push(path);
    }
  }
  return files;
}

async function findMainTexFile(sourceDir: string): Promise<string | undefined> {
  if (!(await fileExists(sourceDir))) return undefined;
  const texFiles = await collectTexFiles(sourceDir);
  const preferred = texFiles.find((path) => /(?:^|\/)(main|paper|article|ms)\.tex$/i.test(path));
  if (preferred) return preferred;

  for (const texFile of texFiles) {
    const snippet = await readMaybe(texFile);
    if (snippet?.includes("\\documentclass")) {
      return texFile;
    }
  }
  return texFiles[0];
}

async function runLocalCommand(args: string[], timeoutMs = 60_000): Promise<CommandExecutionResult> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);

  return {
    stdoutText: stdout,
    stderrText: stderr,
    exitCode,
  };
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function buildArtifacts(libraryDir: string, arxivId: string): ArxivLibraryArtifacts {
  const paperDir = join(libraryDir, arxivId);
  return {
    paperDir,
    metadataPath: join(paperDir, "metadata.yaml"),
    summaryPath: join(paperDir, "SUMMARY.md"),
    bibtexPath: join(paperDir, `${basename(arxivId)}.bib`),
    pdfPath: join(paperDir, `${basename(arxivId)}.pdf`),
    sourceArchivePath: join(paperDir, `${basename(arxivId)}_source.tar.gz`),
    sourceDir: join(paperDir, "source"),
  };
}

function stripVersionSuffix(arxivId: string): string {
  return arxivId.replace(/v\d+$/i, "");
}

function isArxivHost(url: URL): boolean {
  return ARXIV_DOMAINS.some((domain) => hostMatchesDomain(url.hostname, domain));
}

function normalizeArxivId(candidate: string): string | undefined {
  const normalized = stripVersionSuffix(candidate.replace(/\/+$/g, "").trim());
  if (!ARXIV_ID_PATTERN.test(normalized)) return undefined;
  return normalized;
}

export function extractArxivIdFromUrl(url: URL): string | undefined {
  if (!isArxivHost(url)) return undefined;
  const decodedPath = decodeURIComponent(url.pathname);
  const matchers = [
    /^\/abs\/(.+)$/i,
    /^\/pdf\/(.+?)(?:\.pdf)?$/i,
    /^\/src\/(.+)$/i,
    /^\/html\/(.+)$/i,
  ];

  for (const matcher of matchers) {
    const match = decodedPath.match(matcher);
    if (!match) continue;
    const candidate = normalizeArxivId(match[1]!);
    if (candidate) return candidate;
  }

  const direct = decodedPath.replace(/^\/+/, "").trim();
  const normalizedDirect = normalizeArxivId(direct);
  if (normalizedDirect) return normalizedDirect;

  return undefined;
}

export function isArxivLibraryUrl(url: URL): boolean {
  return extractArxivIdFromUrl(url) !== undefined;
}

async function fetchTextOrThrow(fetchImpl: FetchImpl, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new ResourceNotFoundError("URL returned 404 — the resource does not exist, verify the URL is correct");
    }
    throw new Error(`arXiv request failed (${response.status} ${response.statusText}) for ${url}`);
  }
  return await response.text();
}

async function fetchBytesOrThrow(fetchImpl: FetchImpl, url: string): Promise<Uint8Array> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new ResourceNotFoundError("URL returned 404 — the resource does not exist, verify the URL is correct");
    }
    throw new Error(`arXiv request failed (${response.status} ${response.statusText}) for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function maybeExtractSourceArchive(
  artifacts: ArxivLibraryArtifacts,
  archiveBytes: Uint8Array,
  runCommand: RunCommand,
  arxivId: string,
): Promise<"validated-tar" | "raw-tex"> {
  await ensureDir(artifacts.sourceDir);
  const listing = await runCommand(["tar", "-tzf", artifacts.sourceArchivePath]);
  if (listing.exitCode !== 0) {
    const fallbackTex = join(artifacts.sourceDir, `${basename(arxivId)}.tex`);
    await writeFile(fallbackTex, archiveBytes);
    return "raw-tex";
  }

  const unsafeEntry = listing.stdoutText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((entry) => {
      if (entry.startsWith("/")) return true;
      const normalized = entry.replaceAll("\\", "/");
      return normalized.split("/").some((part) => part === "..");
    });
  if (unsafeEntry) {
    throw new Error(`unsafe arXiv source archive entry: ${unsafeEntry}`);
  }

  const extract = await runCommand([
    "tar",
    "-xzf",
    artifacts.sourceArchivePath,
    "-C",
    artifacts.sourceDir,
  ]);
  if (extract.exitCode === 0) return "validated-tar";
  throw new Error(`failed to extract arXiv source archive: ${extract.stderrText.trim()}`);
}

async function maybeConvertTex(mainTexPath: string, outputPath: string, to: "markdown" | "html", runCommand: RunCommand): Promise<boolean> {
  const args =
    to === "markdown"
      ? ["pandoc", mainTexPath, "--from=latex", "--to=gfm", "--output", outputPath, "--wrap=none"]
      : ["pandoc", mainTexPath, "--from=latex", "--to=html5", "--output", outputPath, "--standalone", "--mathjax"];
  const result = await runCommand(args);
  return result.exitCode === 0 && (await fileExists(outputPath));
}

function buildBibtex(metadata: ArxivMetadata): string {
  const firstAuthor = metadata.authors[0]?.split(/\s+/).at(-1) ?? "arxiv";
  const year = metadata.publishedDate.slice(0, 4) || "n.d.";
  const citeKey = `${firstAuthor}${year}${metadata.arxivId.replaceAll("/", "").replaceAll(".", "")}`.replaceAll(/[^A-Za-z0-9]/g, "");
  const lines = [
    `@article{${citeKey},`,
    `  title = {${metadata.title}},`,
    `  author = {${metadata.authors.join(" and ")}},`,
    metadata.journalRef
      ? `  journal = {${metadata.journalRef}},`
      : `  journal = {arXiv preprint arXiv:${metadata.arxivId}},`,
    `  year = {${year}},`,
    `  eprint = {${metadata.arxivId}},`,
    `  archivePrefix = {arXiv},`,
  ];
  if (metadata.primaryCategory) {
    lines.push(`  primaryClass = {${metadata.primaryCategory}},`);
  }
  if (metadata.doi) {
    lines.push(`  doi = {${metadata.doi}},`);
  }
  lines.push(`  url = {${metadata.abstractUrl}},`);
  lines.push("}");
  return lines.join("\n");
}

function buildMetadataYaml(input: {
  metadata: ArxivMetadata;
  artifacts: ArxivLibraryArtifacts;
  pdfSizeBytes?: number;
  sourceSizeBytes?: number;
  cacheStatus: ArxivLibraryStatus;
  processedAt: string;
  lastAccessedAt: string;
  processingNotes: string[];
  markdownPath?: string;
  htmlPath?: string;
}): string {
  const { metadata, artifacts } = input;
  const lines = [
    `arxiv_id: ${yamlString(metadata.arxivId)}`,
    `title: ${yamlString(metadata.title)}`,
    "authors:",
    ...yamlList(metadata.authors, 2),
    `abstract: ${yamlString(metadata.abstract)}`,
    "categories:",
    ...yamlList(metadata.categories, 2),
    `primary_category: ${yamlString(metadata.primaryCategory)}`,
    `published_date: ${yamlString(metadata.publishedDate)}`,
    `updated_date: ${yamlString(metadata.updatedDate)}`,
    `doi: ${yamlString(metadata.doi)}`,
    `journal_ref: ${yamlString(metadata.journalRef)}`,
    `abstract_url: ${yamlString(metadata.abstractUrl)}`,
    `pdf_url: ${yamlString(metadata.pdfUrl)}`,
    `source_url: ${yamlString(metadata.sourceUrl)}`,
    `artifact_dir: ${yamlString(artifacts.paperDir)}`,
    `pdf_path: ${yamlString(artifacts.pdfPath)}`,
    `source_archive_path: ${yamlString(artifacts.sourceArchivePath)}`,
    `source_dir: ${yamlString(artifacts.sourceDir)}`,
    `bibtex_path: ${yamlString(artifacts.bibtexPath)}`,
    `summary_path: ${yamlString(artifacts.summaryPath)}`,
    `metadata_path: ${yamlString(artifacts.metadataPath)}`,
    `markdown_path: ${yamlString(input.markdownPath ?? "")}`,
    `html_path: ${yamlString(input.htmlPath ?? "")}`,
    `pdf_size_bytes: ${input.pdfSizeBytes ?? 0}`,
    `source_size_bytes: ${input.sourceSizeBytes ?? 0}`,
    `cache_status: ${yamlString(input.cacheStatus)}`,
    `processed_at: ${yamlString(input.processedAt)}`,
    `last_accessed_at: ${yamlString(input.lastAccessedAt)}`,
    "processing_notes:",
    ...yamlList(input.processingNotes, 2),
  ];
  return `${lines.join("\n")}\n`;
}

function buildSummaryMarkdown(input: {
  metadata: ArxivMetadata;
  artifacts: ArxivLibraryArtifacts;
  cacheStatus: ArxivLibraryStatus;
  lastAccessedAt: string;
  markdownPath?: string;
  htmlPath?: string;
}): string {
  const { metadata, artifacts } = input;
  const artifactLines = [
    `- PDF: \`${artifacts.pdfPath}\``,
    `- Source archive: \`${artifacts.sourceArchivePath}\``,
    `- Source directory: \`${artifacts.sourceDir}\``,
    `- BibTeX: \`${artifacts.bibtexPath}\``,
    `- Metadata: \`${artifacts.metadataPath}\``,
    `- Summary: \`${artifacts.summaryPath}\``,
  ];
  if (input.markdownPath) artifactLines.push(`- Markdown: \`${input.markdownPath}\``);
  if (input.htmlPath) artifactLines.push(`- HTML: \`${input.htmlPath}\``);

  return [
    `# ${metadata.title || metadata.arxivId}`,
    "",
    `- ArXiv ID: \`${metadata.arxivId}\``,
    `- Cache status: ${input.cacheStatus}`,
    `- Last accessed: ${input.lastAccessedAt}`,
    metadata.authors.length > 0 ? `- Authors: ${metadata.authors.join(", ")}` : "",
    metadata.primaryCategory ? `- Primary category: ${metadata.primaryCategory}` : "",
    metadata.publishedDate ? `- Published: ${metadata.publishedDate}` : "",
    `- Abstract URL: ${metadata.abstractUrl}`,
    "",
    "## Abstract",
    metadata.abstract || "No abstract available.",
    "",
    "## Local artifacts",
    ...artifactLines,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

async function ensureArxivArtifacts(input: {
  arxivId: string;
  artifacts: ArxivLibraryArtifacts;
  fetchImpl: FetchImpl;
  runCommand: RunCommand;
  now: Date;
  overwriteCache: boolean;
}): Promise<{
  cacheStatus: ArxivLibraryStatus;
  record: ArxivStoredRecord;
}> {
  const { arxivId, artifacts, fetchImpl, runCommand, now, overwriteCache } = input;
  if (overwriteCache) {
    await rm(artifacts.paperDir, { recursive: true, force: true });
  }
  await ensureDir(artifacts.paperDir);

  const alreadyCached =
    (await fileExists(artifacts.metadataPath)) &&
    (await fileExists(artifacts.summaryPath)) &&
    (await fileExists(artifacts.pdfPath));

  if (alreadyCached && !overwriteCache) {
    await updateYamlTimestamp(artifacts.metadataPath, "last_accessed_at", now.toISOString());
    const record = parseStoredArxivRecord(arxivId, await readMaybe(artifacts.metadataPath));
    return {
      cacheStatus: "hit",
      record: {
        ...record,
        lastAccessedAt: now.toISOString(),
      },
    };
  }

  const apiXml = await fetchTextOrThrow(
    fetchImpl,
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`,
  );
  const metadata = metadataFromApiXml(arxivId, apiXml);
  const processingNotes = ["Metadata fetched from arXiv API", "PDF downloaded from arXiv"];

  const pdfBytes = await fetchBytesOrThrow(fetchImpl, metadata.pdfUrl);
  await writeFile(artifacts.pdfPath, pdfBytes);

  const sourceBytes = await fetchBytesOrThrow(fetchImpl, metadata.sourceUrl);
  await writeFile(artifacts.sourceArchivePath, sourceBytes);
  processingNotes.push("Source archive downloaded from arXiv");
  const extractionMode = await maybeExtractSourceArchive(artifacts, sourceBytes, runCommand, arxivId);
  processingNotes.push(
    extractionMode === "validated-tar"
      ? "Source archive extracted with validated tar paths"
      : "Source payload was not a tar archive; wrote raw source bytes to a .tex fallback",
  );

  let markdownPath: string | undefined;
  let htmlPath: string | undefined;
  const mainTexPath = await findMainTexFile(artifacts.sourceDir);
  if (mainTexPath) {
    const candidateMarkdownPath = join(artifacts.paperDir, `${basename(arxivId)}.md`);
    const candidateHtmlPath = join(artifacts.paperDir, `${basename(arxivId)}.html`);
    if (await maybeConvertTex(mainTexPath, candidateMarkdownPath, "markdown", runCommand)) {
      markdownPath = candidateMarkdownPath;
      processingNotes.push("Pandoc markdown conversion completed");
    }
    if (await maybeConvertTex(mainTexPath, candidateHtmlPath, "html", runCommand)) {
      htmlPath = candidateHtmlPath;
      processingNotes.push("Pandoc HTML conversion completed");
    }
  }
  if (!mainTexPath) {
    processingNotes.push("No main LaTeX file found in extracted source");
  }

  await writeFile(artifacts.bibtexPath, buildBibtex(metadata));
  await writeFile(
    artifacts.metadataPath,
    buildMetadataYaml({
      metadata,
      artifacts,
      pdfSizeBytes: pdfBytes.byteLength,
      sourceSizeBytes: sourceBytes.byteLength,
      cacheStatus: overwriteCache ? "refreshed" : "built",
      processedAt: now.toISOString(),
      lastAccessedAt: now.toISOString(),
      processingNotes,
      markdownPath,
      htmlPath,
    }),
  );
  await writeFile(
    artifacts.summaryPath,
    buildSummaryMarkdown({
      metadata,
      artifacts,
      cacheStatus: overwriteCache ? "refreshed" : "built",
      lastAccessedAt: now.toISOString(),
      markdownPath,
      htmlPath,
    }),
  );

  return {
    cacheStatus: overwriteCache ? "refreshed" : "built",
    record: {
      metadata,
      markdownPath,
      htmlPath,
      processedAt: now.toISOString(),
      lastAccessedAt: now.toISOString(),
      processingNotes,
    },
  };
}

function formatArxivLibraryOutput(input: {
  cacheStatus: ArxivLibraryStatus;
  artifacts: ArxivLibraryArtifacts;
  record: ArxivStoredRecord;
}): string {
  const { metadata } = input.record;
  const summary = [
    `Local arXiv library status: ${input.cacheStatus}`,
    `ArXiv ID: ${metadata.arxivId}`,
    `Title: ${metadata.title || "(unavailable)"}`,
    `Authors: ${metadata.authors.length > 0 ? metadata.authors.join(", ") : "(unavailable)"}`,
    `Primary category: ${metadata.primaryCategory || "(unavailable)"}`,
    `Published: ${metadata.publishedDate || "(unavailable)"}`,
    `Updated: ${metadata.updatedDate || "(unavailable)"}`,
    `DOI: ${metadata.doi || "(unavailable)"}`,
    `Journal reference: ${metadata.journalRef || "(unavailable)"}`,
    `Processed at: ${input.record.processedAt || "(unavailable)"}`,
    `Last accessed: ${input.record.lastAccessedAt || "(unavailable)"}`,
    `Artifact directory: ${input.artifacts.paperDir}`,
    `Summary file: ${input.artifacts.summaryPath}`,
    `Metadata file: ${input.artifacts.metadataPath}`,
    `PDF file: ${input.artifacts.pdfPath}`,
    `Source archive file: ${input.artifacts.sourceArchivePath}`,
    `Source directory: ${input.artifacts.sourceDir}`,
    `BibTeX file: ${input.artifacts.bibtexPath}`,
    `Markdown file: ${input.record.markdownPath ?? "(not generated)"}`,
    `HTML file: ${input.record.htmlPath ?? "(not generated)"}`,
  ];
  if (input.record.processingNotes.length > 0) {
    summary.push("Processing notes:");
    for (const note of input.record.processingNotes) {
      summary.push(`- ${note}`);
    }
  }
  if (metadata.abstract) {
    summary.push("");
    summary.push("Abstract:");
    summary.push(metadata.abstract);
  }
  return `${summary.join("\n")}\n`;
}

export async function fetchArxivLibraryContent(
  input: FetchArxivLibraryContentInput,
): Promise<WebFetchHandlerResult> {
  const arxivId = extractArxivIdFromUrl(input.url);
  if (!arxivId) {
    throw new Error("unsupported arXiv URL shape for local-library handling");
  }

  const libraryDir = resolveArxivLibraryDir(input.libraryDir);
  const artifacts = buildArtifacts(libraryDir, arxivId);
  const runCommand = input.runCommand ?? runLocalCommand;
  const now = input.now ?? new Date();
  const { cacheStatus, record } = await ensureArxivArtifacts({
    arxivId,
    artifacts,
    fetchImpl: input.fetchImpl ?? fetch,
    runCommand,
    now,
    overwriteCache: !!input.overwriteCache,
  });

  return {
    routeName: "arxiv/library",
    sourceUrl: `https://arxiv.org/abs/${arxivId}`,
    content: formatArxivLibraryOutput({
      cacheStatus,
      artifacts,
      record,
    }),
  };
}
function resolveArxivLibraryDir(override?: string): string {
  return (
    override ??
    process.env.WEBFETCH_ARXIV_LIBRARY_DIR ??
    `${process.env.HOME ?? "/tmp"}/.cache/opencode-arxiv-library`
  ).trim();
}
