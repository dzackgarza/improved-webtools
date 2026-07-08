#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert a PDF to Markdown using docling.")
    parser.add_argument("pdf_path", help="Path to the input PDF file.")
    return parser.parse_args()


def exit_with_error(message: str, code: int) -> int:
    print(message, file=sys.stderr)
    return code


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf_path).expanduser().resolve()

    if not pdf_path.exists():
        return exit_with_error(f"PDF file not found: {args.pdf_path}", 1)

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption
    except Exception as exc:  # pragma: no cover - behavior exercised by command runner.
        return exit_with_error(f"docling dependency is unavailable: {exc}", 2)

    options = PdfPipelineOptions()
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )

    try:
        result = converter.convert(str(pdf_path))
        markdown = result.document.export_to_markdown()
    except Exception as exc:
        return exit_with_error(f"docling conversion failed: {exc}", 3)

    if not markdown.strip():
        return exit_with_error(
            "docling conversion completed but produced empty output.",
            4,
        )

    print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
