"""
FastMCP wrapper for improved-webtools webfetch and websearch.

This server invokes the standalone webtools CLI via uvx.

Usage:
    uv run fastmcp run server.py
"""

import os
import subprocess
import sys
import urllib.request
from typing import Annotated

from fastmcp import FastMCP
from pydantic import Field

# Server metadata
mcp = FastMCP(
    name="improved-webtools-mcp",
    instructions="Web search and fetch via SearxNG. Read URLs or search web with category filters.",
)

MANAGER_REPO = os.environ.get(
    "WEBTOOLS_CLI_SPEC",
    "git+https://github.com/dzackgarza/webtools-manager.git",
)


def _run_tool(tool_name: str, args: dict) -> str:
    """Execute a tool via uvx and return result."""
    if tool_name == "websearch":
        cmd = [
            "uvx",
            "--from",
            MANAGER_REPO,
            "webtools",
            "websearch",
            str(args["query"]),
            *(["--category", str(args["category"])] if args.get("category") else []),
            *(
                ["--num-results", str(args["num_results"])]
                if args.get("num_results") is not None
                else []
            ),
            *(
                ["--offset", str(args["offset"])]
                if args.get("offset") is not None
                else []
            ),
            *(
                ["--recency", str(args["recency"])]
                if args.get("recency") is not None
                else []
            ),
            *sum((["--domains", domain] for domain in args.get("domains", [])), []),
        ]
    else:
        cmd = [
            "uvx",
            "--from",
            MANAGER_REPO,
            "webtools",
            "webfetch",
            str(args["url"]),
            *(["--overwrite-cache"] if args.get("overwrite_cache") else []),
        ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
    )

    if result.returncode != 0:
        return f"Error executing {tool_name}: {result.stderr or result.stdout}"

    return result.stdout


@mcp.tool(
    annotations={
        "title": "Fetch Web Page",
        "readOnlyHint": True,
        "openWorldHint": True,
    }
)
async def webfetch(
    url: Annotated[str, Field(description="URL to fetch (http/https only)")],
    overwrite_cache: Annotated[
        bool, Field(description="Set to true to bypass cached results")
    ] = False,
) -> str:
    """Use when you need to fetch a webpage URL as plain text. Handles GitHub, Reddit, YouTube, Wikipedia, and arXiv."""
    try:
        args = {"url": url}
        if overwrite_cache:
            args["overwrite_cache"] = True
        return _run_tool("webfetch", args)
    except subprocess.TimeoutExpired:
        return f"Error: webfetch timeout (>120s) for URL: {url}"
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool(
    annotations={
        "title": "Search Web",
        "readOnlyHint": True,
        "openWorldHint": True,
    }
)
async def websearch(
    query: Annotated[str, Field(description="Search query string")],
    category: Annotated[
        str,
        Field(description="Category: news, it, npm, pypi, gh, hf, science, arx, etc."),
    ] = "",
    num_results: Annotated[
        int, Field(description="Results per page (1-20)", ge=1, le=20)
    ] = 8,
    offset: Annotated[
        int, Field(description="Pagination offset (0-200)", ge=0, le=200)
    ] = 0,
    recency: Annotated[
        int, Field(description="Recency in days (1=day, 31=month, 365=year)")
    ] = 0,
    domains: Annotated[
        list[str] | None, Field(description="Specific domains to limit search to")
    ] = None,
) -> str:
    """Use when you need to search the web via SearxNG. Returns snippets with pagination support."""
    try:
        args: dict = {
            "query": query,
            "num_results": num_results,
            "offset": offset,
        }
        if category:
            args["category"] = category
        if recency:
            args["recency"] = recency
        if domains:
            args["domains"] = domains

        return _run_tool("websearch", args)
    except subprocess.TimeoutExpired:
        return f"Error: websearch timeout (>120s) for query: {query}"
    except Exception as e:
        return f"Error: {str(e)}"


def main() -> None:
    # 1. Check Env Var
    url = os.environ.get("SEARXNG_INSTANCE_URL")
    if not url:
        print(
            "CRITICAL: SEARXNG_INSTANCE_URL is not set. MCP server cannot start.",
            file=sys.stderr,
        )
        sys.exit(1)

    # 2. Blocking Health Check
    try:
        # Hard dependency check: ensure SearxNG is reachable before starting
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.getcode() >= 400:
                raise Exception(f"HTTP {response.getcode()}")
    except Exception as e:
        print(
            f"CRITICAL: SearxNG instance at {url} is unreachable: {e}",
            file=sys.stderr,
        )
        sys.exit(1)

    mcp.run()


if __name__ == "__main__":
    main()
