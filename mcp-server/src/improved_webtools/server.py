from __future__ import annotations

from typing import Annotated

from fastmcp import FastMCP
from pydantic import Field

from .bridge import BridgeCommandError, run_bridge

mcp = FastMCP(
    name="improved-webtools-mcp",
    instructions=(
        "Use when you need webfetch or websearch through the CLI-first improved-webtools adapter."
    ),
)


def _run(command: str, payload: dict[str, object]) -> str:
    try:
        response = run_bridge(command, payload)
    except BridgeCommandError as exc:
        return f"Error: {exc}"
    return str(response["text"])


@mcp.tool(
    annotations={
        "title": "Fetch Web Page",
        "readOnlyHint": True,
        "openWorldHint": True,
    }
)
async def webfetch(
    url: Annotated[str, Field(description="HTTP or HTTPS URL to fetch")],
    overwrite_cache: Annotated[
        bool, Field(description="Set true to bypass cached results")
    ] = False,
) -> str:
    """Use when you need readable text for a web page URL."""
    payload: dict[str, object] = {"url": url}
    if overwrite_cache:
        payload["overwrite_cache"] = True
    return _run("fetch", payload)


@mcp.tool(
    annotations={
        "title": "Search Web",
        "readOnlyHint": True,
        "openWorldHint": True,
    }
)
async def websearch(
    query: Annotated[str, Field(description="Search query string")],
    category: Annotated[str, Field(description="Optional narrowing category")] = "",
    num_results: Annotated[
        int, Field(description="Results per page (1-20)", ge=1, le=20)
    ] = 8,
    offset: Annotated[
        int, Field(description="Pagination offset (0-200)", ge=0, le=200)
    ] = 0,
    recency: Annotated[int, Field(description="Recency in days")] = 0,
    domains: Annotated[
        list[str] | None,
        Field(description="Specific domains to limit search to"),
    ] = None,
) -> str:
    """Use when you need web search results with optional category narrowing."""
    payload: dict[str, object] = {
        "query": query,
        "num_results": num_results,
        "offset": offset,
    }
    if category:
        payload["category"] = category
    if recency:
        payload["recency"] = recency
    if domains:
        payload["domains"] = domains
    return _run("search", payload)


def main() -> None:
    mcp.run()
