#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path

from bs4 import BeautifulSoup
from markdownify import markdownify as md


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: wikipedia_html_to_markdown.py <html_path> <source_url> <page_title>",
            file=sys.stderr,
        )
        return 2

    html_path = Path(sys.argv[1])
    source_url = sys.argv[2].strip()
    page_title = sys.argv[3].strip() or "Wikipedia"

    soup = BeautifulSoup(html_path.read_text(encoding="utf-8"), "html.parser")

    for selector in [
        "style",
        "script",
        "noscript",
        "sup.reference",
        ".mw-editsection",
        ".shortdescription",
        ".hatnote",
        ".navbox",
        ".toc",
    ]:
        for node in soup.select(selector):
            node.decompose()

    body = soup.body or soup
    markdown = md(str(body), heading_style="ATX").strip()

    print(f"# {page_title}\n")
    print(f"Source: {source_url}\n")
    print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
