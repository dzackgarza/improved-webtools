from __future__ import annotations

import json
import sys
from pathlib import Path

from typer.testing import CliRunner

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from improved_webtools.cli import app

runner = CliRunner()


def test_fetch_invalid_url_reports_validation_failure() -> None:
    result = runner.invoke(app, ["fetch", "not-a-valid-url"])
    assert result.exit_code == 0
    assert "Tool passphrase: PASS_WEBFETCH_SHADOW_20260305_C3D2" in result.stdout
    assert 'Invalid URL: "not-a-valid-url".' in result.stdout


def test_doctor_json_reports_required_setup() -> None:
    result = runner.invoke(app, ["doctor", "--json"])
    assert result.exit_code in {0, 1}

    payload = json.loads(result.stdout)
    assert payload["command"] == "doctor"
    assert payload["status"] in {"ok", "action_required"}
    checks = {check["name"]: check for check in payload["doctor"]["checks"]}
    assert "SEARXNG_INSTANCE_URL" in checks
    assert checks["SEARXNG_INSTANCE_URL"]["status"] in {"ok", "error"}
