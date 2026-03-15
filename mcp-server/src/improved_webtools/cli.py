from __future__ import annotations

import json

import typer

from .bridge import BridgeCommandError, run_bridge

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="CLI-first interface for improved web tools.",
)


def _print_response(response: dict[str, object], json_output: bool) -> None:
    if json_output:
        typer.echo(json.dumps(response, indent=2, sort_keys=True))
    else:
        typer.echo(str(response["text"]))

    if response["status"] in {"action_required", "error"}:
        raise typer.Exit(1)


def _run(command: str, payload: dict[str, object], json_output: bool) -> None:
    try:
        response = run_bridge(command, payload)
    except BridgeCommandError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(2) from exc
    _print_response(response, json_output)


@app.command("fetch", help="Fetch a URL through the canonical webfetch implementation.")
def fetch(
    url: str = typer.Argument(..., help="HTTP or HTTPS URL to fetch."),
    overwrite_cache: bool = typer.Option(
        False,
        "--overwrite-cache",
        help="Bypass cached webfetch content and force a fresh fetch.",
    ),
    json_output: bool = typer.Option(False, "--json", help="Emit structured bridge JSON."),
) -> None:
    payload: dict[str, object] = {"url": url}
    if overwrite_cache:
        payload["overwrite_cache"] = True
    _run("fetch", payload, json_output)


@app.command("search", help="Search through the canonical SearXNG-backed websearch implementation.")
def search(
    query: str = typer.Argument(..., help="Search query."),
    category: str = typer.Option("", "--category", help="Optional narrowing category."),
    num_results: int = typer.Option(8, "--num-results", min=1, max=20, help="Results to return."),
    offset: int = typer.Option(0, "--offset", min=0, max=200, help="Pagination offset."),
    recency: int = typer.Option(0, "--recency", min=0, help="Recency in days."),
    domains: list[str] | None = typer.Option(
        None,
        "--domain",
        help="Limit search to a specific domain. Repeat the flag to add more domains.",
    ),
    json_output: bool = typer.Option(False, "--json", help="Emit structured bridge JSON."),
) -> None:
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
    _run("search", payload, json_output)


@app.command("doctor", help="Check local config and runtime prerequisites.")
def doctor(
    json_output: bool = typer.Option(False, "--json", help="Emit structured bridge JSON."),
) -> None:
    _run("doctor", {}, json_output)


def main() -> None:
    app()
