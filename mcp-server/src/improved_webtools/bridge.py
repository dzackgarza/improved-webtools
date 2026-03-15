from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Literal

PACKAGE_DIR = Path(__file__).resolve().parent
VENDOR_DIR = PACKAGE_DIR / "vendor"
BRIDGE_BUNDLE = VENDOR_DIR / "improved-webtools-bridge.mjs"
WIKIPEDIA_CONVERTER = VENDOR_DIR / "wikipedia_html_to_markdown.py"

BridgeCommand = Literal["fetch", "search", "doctor"]


class BridgeCommandError(RuntimeError):
    """Raised when the canonical bridge cannot execute."""


def _bun_path() -> str:
    bun = shutil.which("bun")
    if bun:
        return bun
    raise BridgeCommandError("bun is required. Install Bun and ensure it is on PATH.")


def _bridge_paths() -> tuple[Path, Path]:
    if not BRIDGE_BUNDLE.exists():
        raise BridgeCommandError(
            f"Bridge bundle not found: {BRIDGE_BUNDLE}. "
            "Run `just --justfile justfile bundle-bridge` in the repo before local use."
        )
    if not WIKIPEDIA_CONVERTER.exists():
        raise BridgeCommandError(f"Wikipedia converter script not found: {WIKIPEDIA_CONVERTER}")
    return BRIDGE_BUNDLE, WIKIPEDIA_CONVERTER


def run_bridge(
    command: BridgeCommand,
    payload: dict[str, Any] | None = None,
    timeout_seconds: int = 60,
) -> dict[str, Any]:
    bun = _bun_path()
    bundle_path, converter_path = _bridge_paths()
    env = os.environ.copy()
    env["IMPROVED_WEBTOOLS_WIKIPEDIA_CONVERTER_SCRIPT"] = str(converter_path)

    result = subprocess.run(
        [bun, str(bundle_path), command, json.dumps(payload or {})],
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        env=env,
    )

    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    candidate = stdout.splitlines()[-1] if stdout else ""
    if not candidate:
        detail = stderr or "bridge produced no output"
        raise BridgeCommandError(f"Canonical bridge failed: {detail}")

    try:
        response = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise BridgeCommandError(f"Canonical bridge returned invalid JSON: {candidate}") from exc

    if result.returncode != 0:
        detail = response.get("text") or stderr or "bridge execution failed"
        raise BridgeCommandError(str(detail))

    return response
