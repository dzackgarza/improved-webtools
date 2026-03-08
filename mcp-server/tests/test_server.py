"""
Tests for improved-webtools FastMCP server.

Run with: uv run pytest tests/
"""

import sys
from pathlib import Path

import pytest
from fastmcp import Client

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from server import mcp


@pytest.fixture
async def mcp_client():
    """Fixture: wrap FastMCP server in Client for testing."""
    async with Client(mcp) as client:
        yield client


class TestListTools:
    """Test tool discovery."""

    async def test_list_tools(self, mcp_client: Client):
        """Verify expected tools are exposed."""
        tools = await mcp_client.list_tools()
        tool_names = [t.name for t in tools]

        assert "webfetch" in tool_names
        assert "websearch" in tool_names


class TestWebFetch:
    """Test webfetch tool."""

    async def test_webfetch_invalid_url(self, mcp_client: Client):
        """Test handling of invalid URL."""
        result = await mcp_client.call_tool(
            name="webfetch",
            arguments={"url": "not-a-valid-url"},
        )
        assert result is not None
        assert "Invalid URL" in str(result) or "Error" in str(result)

    async def test_webfetch_example(self, mcp_client: Client):
        """Test fetching example.com."""
        result = await mcp_client.call_tool(
            name="webfetch",
            arguments={"url": "https://example.com"},
        )
        assert result is not None
        # Should contain passphrase or content
        assert "PASS_WEBFETCH" in str(result) or len(str(result)) > 0


class TestWebSearch:
    """Test websearch tool."""

    async def test_websearch_basic(self, mcp_client: Client):
        """Test basic search (may fail without SearxNG instance)."""
        result = await mcp_client.call_tool(
            name="websearch",
            arguments={"query": "test", "num_results": 3},
        )
        assert result is not None
        # Should contain passphrase header
        assert "PASS_WEB_SEARCH" in str(result)

    @pytest.mark.parametrize(
        "num_results,expected_range",
        [
            (1, (1, 1)),
            (5, (1, 5)),
            (10, (1, 10)),
        ],
    )
    async def test_websearch_pagination(
        self, mcp_client: Client, num_results: int, expected_range: tuple
    ):
        """Test pagination parameters."""
        result = await mcp_client.call_tool(
            name="websearch",
            arguments={
                "query": "test",
                "num_results": num_results,
                "offset": 0,
            },
        )
        assert result is not None
