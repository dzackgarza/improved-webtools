import type { WebFetchHandlerResult } from "../types.ts";

export const NPM_DOMAINS = ["npmjs.com", "www.npmjs.com"] as const;
export const PYPI_DOMAINS = ["pypi.org", "pypi.python.org"] as const;
export const CRATES_DOMAINS = ["crates.io"] as const;

const MAX_DEPENDENCIES_TO_SHOW = 24;

type PackageRegistry = "npm" | "pypi" | "crates";

function assertRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

function formatDependenciesFromMap(dependencies: Record<string, unknown>): string[] {
  return Object.entries(dependencies)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .slice(0, MAX_DEPENDENCIES_TO_SHOW)
    .map(([name, version]) => `- ${name}: ${String(version)}`);
}

function formatDependenciesFromList(dependencies: unknown): string[] {
  if (!Array.isArray(dependencies)) return [];
  return dependencies
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .slice(0, MAX_DEPENDENCIES_TO_SHOW)
    .map((entry) => `- ${entry}`);
}

function formatCratesDeps(rawDependencies: unknown): string[] {
  if (!Array.isArray(rawDependencies)) return [];
  return rawDependencies
    .map((entry) => {
      if (!assertRecord(entry)) return "";
      const depName = cleanText(entry.name);
      const req = cleanText(entry.req);
      const optional = entry.optional === true ? " (optional)" : "";
      const kind = cleanText(entry.kind);
      if (!depName) return "";
      const suffix = kind ? ` [${kind}]` : "";
      return `- ${depName}: ${req || "unknown"}${suffix}${optional}`;
    })
    .filter(Boolean)
    .slice(0, MAX_DEPENDENCIES_TO_SHOW);
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "opencode-improved-webfetch/1.0" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${label} request failed (HTTP ${response.status}): ${body.trim().slice(0, 2000)}`);
  }
  return JSON.parse(body) as T;
}

function resolvePackageRegistry(url: URL): PackageRegistry | undefined {
  if (url.hostname === "npmjs.com" || url.hostname === "www.npmjs.com") return "npm";
  if (url.hostname === "pypi.org" || url.hostname === "pypi.python.org") return "pypi";
  if (url.hostname === "crates.io") return "crates";
  return undefined;
}

function extractNpmPackageName(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const marker = segments.findIndex((segment) => segment === "package");
  if (marker < 0 || marker + 1 >= segments.length) return undefined;
  return segments.slice(marker + 1).join("/").trim();
}

function extractPypiPackageName(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const marker = segments.findIndex((segment) => segment === "project");
  if (marker < 0 || marker + 1 >= segments.length) return undefined;
  return segments[marker + 1]!.trim();
}

function extractCratesPackageName(url: URL): string | undefined {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const marker = segments.findIndex((segment) => segment === "crates");
  if (marker < 0 || marker + 1 >= segments.length) return undefined;
  return segments[marker + 1]!.trim();
}

function parseNpmPackage(url: URL): {
  pkg: string;
  registry: PackageRegistry;
} | undefined {
  const registry = resolvePackageRegistry(url);
  if (!registry) return undefined;
  let pkg = "";
  if (registry === "npm") {
    pkg = extractNpmPackageName(url) ?? "";
  } else if (registry === "pypi") {
    pkg = extractPypiPackageName(url) ?? "";
  } else {
    pkg = extractCratesPackageName(url) ?? "";
  }
  if (!pkg) return undefined;
  return { pkg, registry };
}

function summarizeReadme(title: string, readme: string): string {
  const trimmed = readme.trim();
  if (!trimmed) return `## ${title}\n\nNo README available from registry API response.`;
  return `## ${title}\n\n${trimmed}`;
}

function summarizeNpm(payload: unknown): { content: string; version: string; packageName: string } {
  if (!assertRecord(payload)) {
    throw new Error("npm API response has unsupported schema.");
  }
  const distTags = assertRecord(payload["dist-tags"]) ? payload["dist-tags"] : {};
  const latest = cleanText(distTags.latest) || "";
  const versions = assertRecord(payload.versions) ? payload.versions : {};
  const latestVersionName = latest || Object.keys(versions).at(-1);
  const rawVersion = latestVersionName ? versions[latestVersionName] : undefined;
  if (!assertRecord(rawVersion)) {
    throw new Error("npm API response is missing version metadata.");
  }
  const packageName = cleanText(payload.name) || "unknown-package";
  const latestVersion = rawVersion;
  const release = cleanText(payload.description) || cleanText(latestVersion.description);
  const license = cleanText(payload.license) || cleanText(latestVersion.license);
  const publishDates = assertRecord(payload.time) ? payload.time : {};
  const publishDate = cleanText(publishDates[latest]);
  const dependencies = assertRecord(latestVersion.dependencies) ? latestVersion.dependencies : {};
  const readme = cleanText(latestVersion.readme) || cleanText(payload.readme) || "No README text in npm response.";
  const lines = [
    "# npm package",
    "",
    `- Package: ${packageName}`,
    `- Version: ${latest || "unknown"}`,
    `- Published: ${publishDate || "unknown"}`,
    `- License: ${license || "unknown"}`,
    `- Maintainer: ${cleanText(payload.author) || "unknown"}`,
    "",
    release ? `Summary: ${release}` : "Summary: unavailable",
    "",
    "## Dependencies",
  ];

  const deps = formatDependenciesFromMap(dependencies);
  if (deps.length === 0) {
    lines.push("- (none listed)");
  } else {
    lines.push(...deps);
  }
  lines.push("");
  lines.push(summarizeReadme("README", readme));
  return { content: lines.join("\n"), version: latest || "unknown", packageName };
}

function summarizePypi(payload: unknown): { content: string; version: string; packageName: string } {
  if (!assertRecord(payload)) throw new Error("PyPI API response has unsupported schema.");
  const info = assertRecord(payload.info) ? payload.info : {};
  const packageName = cleanText(info.name) || "unknown-package";
  const version = cleanText(info.version) || "unknown";
  const release = cleanText(info.summary) || cleanText(info.description) || "No description from API.";
  const dependencies = formatDependenciesFromList(info.requires_dist);
  const lines = [
    "# PyPI package",
    "",
    `- Package: ${packageName}`,
    `- Version: ${version}`,
    `- Python: ${cleanText(info.requires_python) || "unspecified"}`,
    `- License: ${cleanText(info.license) || "unspecified"}`,
    `- Maintainer: ${cleanText(info.maintainer) || cleanText(info.author) || "unknown"}`,
    `- Home page: ${cleanText(info.home_page) || "unspecified"}`,
    "",
    `Summary: ${release}`,
    "",
    "## Dependencies",
  ];
  if (dependencies.length === 0) {
    lines.push("- (none listed)");
  } else {
    lines.push(...dependencies);
  }
  lines.push("");
  lines.push(summarizeReadme("README / description", cleanText(info.description) || ""));
  return { content: lines.join("\n"), version, packageName };
}

function summarizeCrates(payload: unknown): { content: string; version: string; packageName: string } {
  if (!assertRecord(payload)) throw new Error("crates.io API response has unsupported schema.");
  const crate = assertRecord(payload.crate) ? payload.crate : {};
  const versions = Array.isArray(payload.versions) ? payload.versions : [];
  const packageName = cleanText(crate.name) || "unknown-crate";
  const version = cleanText(crate.max_stable_version) || cleanText(crate.max_version) || "unknown";
  const description = cleanText(crate.description) || "No description from API.";
  const license = cleanText(crate.license);
  const homepage = cleanText(crate.homepage);
  const repository = cleanText(crate.repository);
  const latestVersion = versions.find((entry) => assertRecord(entry) && cleanText(entry.num) === version) ?? versions.at(-1);
  const dependencies = formatCratesDeps(latestVersion && assertRecord(latestVersion) ? latestVersion.deps : undefined);
  const lines = [
    "# Cargo crate",
    "",
    `- Crate: ${packageName}`,
    `- Version: ${version}`,
    `- Latest update: ${cleanText(crate.updated_at) || "unspecified"}`,
    `- License: ${license || "unspecified"}`,
    `- Repository: ${repository || "unspecified"}`,
    `- Homepage: ${homepage || "unspecified"}`,
    "",
    `Summary: ${description}`,
    "",
    "## Dependencies",
  ];

  if (dependencies.length === 0) {
    lines.push("- (none listed)");
  } else {
    lines.push(...dependencies);
  }
  return {
    content: lines.join("\n"),
    version,
    packageName,
  };
}

export async function fetchPackageRegistryMarkdown(input: { url: URL }): Promise<WebFetchHandlerResult> {
  const target = parseNpmPackage(input.url);
  if (!target) {
    throw new Error(
      "unsupported package registry URL shape: expected npm package, PyPI project, or crates.io crate routes.",
    );
  }

  if (target.registry === "npm") {
    const response = await fetchJson<Record<string, unknown>>(
      `https://registry.npmjs.org/${encodeURIComponent(target.pkg)}`,
      "npm API",
    );
    const summarized = summarizeNpm(response);
    return {
      routeName: "npm",
      sourceUrl: `https://www.npmjs.com/package/${target.pkg}`,
      content: [
        summarized.content,
        "",
        "API source: https://registry.npmjs.org",
        `Resolved package version: ${summarized.version}`,
      ].join("\n"),
    };
  }

  if (target.registry === "pypi") {
    const response = await fetchJson<Record<string, unknown>>(
      `https://pypi.org/pypi/${encodeURIComponent(target.pkg)}/json`,
      "PyPI API",
    );
    const summarized = summarizePypi(response);
    return {
      routeName: "pypi",
      sourceUrl: `https://pypi.org/project/${target.pkg}/`,
      content: [
        summarized.content,
        "",
        "API source: https://pypi.org/pypi/{package}/json",
        `Resolved package version: ${summarized.version}`,
      ].join("\n"),
    };
  }

  const response = await fetchJson<Record<string, unknown>>(
    `https://crates.io/api/v1/crates/${encodeURIComponent(target.pkg)}`,
    "crates.io API",
  );
  const summarized = summarizeCrates(response);
  return {
    routeName: "crates",
    sourceUrl: `https://crates.io/crates/${target.pkg}`,
    content: [
      summarized.content,
      "",
      "API source: https://crates.io/api/v1/crates/{crate}",
      `Resolved crate version: ${summarized.version}`,
    ].join("\n"),
  };
}
