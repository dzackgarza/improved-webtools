from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastmcp import Client

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from improved_webtools.server import mcp


@pytest.fixture
async def mcp_client() -> Client:
    async with Client(mcp) as client:
        yield client


async def test_list_tools_exposes_fetch_and_search(mcp_client: Client) -> None:
    tools = await mcp_client.list_tools()
    tool_names = {tool.name for tool in tools}
    assert tool_names == {"webfetch", "websearch"}


async def test_webfetch_invalid_url_returns_validation_report(mcp_client: Client) -> None:
    result = await mcp_client.call_tool(
        name="webfetch",
        arguments={"url": "not-a-valid-url"},
    )
    rendered = str(result)
    assert "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2" in rendered
    assert 'Invalid URL: "not-a-valid-url".' in rendered


async def test_websearch_missing_config_returns_setup_message(mcp_client: Client) -> None:
    original = os.environ.pop("SEARXNG_INSTANCE_URL", None)
    try:
        result = await mcp_client.call_tool(
            name="websearch",
            arguments={"query": "openai", "num_results": 3},
        )
    finally:
        if original is not None:
            os.environ["SEARXNG_INSTANCE_URL"] = original

    rendered = str(result)
    assert "Tool passphrase: PASS_WEB_SEARCH_SHADOW_20260305_6A9F" in rendered
    assert "set SEARXNG_INSTANCE_URL" in rendered
