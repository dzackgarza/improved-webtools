The most pressing work is:

1. [#58: Diagnostic text looks like prompt injection](https://github.com/dzackgarza/improved-webtools/issues/58)

   This is the highest priority. It affects most tool responses. Agents can reject valid output or report false compromise warnings. Current source still emits credential-like “passphrase” text across both tools.

2. [#47: Search stability and transparency](https://github.com/dzackgarza/improved-webtools/issues/47)

   `websearch` can fail when SearXNG omits `number_of_results`. The source still throws instead of returning available rows. Upstream throttling and engine failures also remain hidden.

3. [#48: Robust web fetching and rendering](https://github.com/dzackgarza/improved-webtools/issues/48)

   Core extraction remains unreliable. A recent plain HTML forum page produced no readable content. This shows an extraction defect beyond JavaScript rendering.

4. [#57: Error output points to a removed ISSUES.md](https://github.com/dzackgarza/improved-webtools/issues/57)

   Current source contains both stale instructions. This compounds #58 because agents receive an unsafe-looking directive with no valid destination. Fix #57 and #58 together.

5. [PR #56 / Issue #49: Advanced handlers remain stranded](https://github.com/dzackgarza/improved-webtools/pull/56)

   The pull request has remained open since July. It has failed checks and unresolved correctness findings. These include wrong domain routes, stale PDF cache data, and possible error-detail exposure. Triage the branch before adding more handler work.

6. [#51: CLI-first architecture](https://github.com/dzackgarza/improved-webtools/issues/51)

   This is the largest structural issue. Package installation still depends on local source layout. It matters after the direct tool failures above.

Recommended order: combine #58 with #57, then complete #47, then #48. Triage PR #56 before resuming #49. Treat #46 as a ledger, not executable work.

---

# Repository issue recovery plan

> Tier: roadmap / strategic
> Parent plan: root / user-facing
> Durable record: `PLAN-IMPROVED-WEBTOOLS-PRIORITY-001`
> Externalized fit: existing ledger #46 and work units #47, #48, #49, and #51. No new GitHub objects are authorized.

## Purpose / Observable Result

Restore dependable `websearch` and `webfetch` behavior before the architectural migration begins.

Completion requires direct runtime evidence for each affected tool route. Issue state and review state do not prove behavior.

## Scope

Included work:

- Resolve #58 and #57 as one diagnostic-output problem.
- Resolve search correctness and degraded-state reporting under #47.
- Resolve static extraction, JavaScript rendering, and route classification under #48.
- Determine whether PR #56 can satisfy #49 without preserving its known defects.
- Start #51 only after the two shadowing tools have dependable behavior.

Excluded work:

- Changes to issue scope or acceptance criteria.
- New issue trees, milestones, or pull-request boundaries.
- Compatibility paths for obsolete tool names or local `git+` transport.

Preserved behavior:

- Normal mode exports `webfetch` and `websearch`.
- Debug mode exports only `webfetch_debug` and `websearch_debug`.
- Local development uses `file://` transport.
- Transport verification follows the repository test order.

## Invariants

- Tool-owned diagnostics identify their provenance without credential-like language.
- Search output never hides available rows because one total field is absent.
- Degraded search output identifies relevant engine failures and incomplete coverage.
- Web fetching distinguishes missing resources, extraction failure, and renderer requirements.
- A pull request closes only obligations proven by its delivered behavior.
- The CLI-first migration does not duplicate fetch or search behavior across adapters.

## Sources and Current State

Canonical sources:

- GitHub ledger #46.
- Work units #47, #48, #49, and #51.
- Bugs #57 and #58.
- Pull request #56 and its unresolved review findings.
- `AGENTS.md` shadowing mandate and transport order.

Current evidence:

- `src/index.ts` emits passphrase text and references removed `ISSUES.md` reporting.
- `src/index.ts` throws when `number_of_results` is missing.
- #48 contains a recent static HTML extraction failure.
- PR #56 remains open with failed checks and unresolved correctness claims.
- #51 documents isolated installation failure from repository-relative adapter paths.

## Execution Graph

Stacked order:

1. Repair diagnostic trust under #58 and #57.
2. Repair search correctness under #47.
3. Repair web fetching under #48.
4. Triage PR #56 against all #49 obligations.
5. Execute the CLI-first architecture work under #51.

PR #56 triage can inspect findings while #47 and #48 proceed. It must not merge before its claimed behaviors pass direct checks.

## Milestones

### Trusted diagnostic output

- Result: tool-owned metadata cannot be mistaken for fetched instructions or credentials.
- Dependencies: none.
- Acceptance: output has clear provenance, no passphrase vocabulary, and a valid GitHub reporting URL.
- Verification: inspect real debug and normal tool output through `file://` loading.
- Stop conditions: stop if the shadowing proof fails before diagnostic behavior can be observed.
- Spawns child plan: yes, `PLAN-IMPROVED-WEBTOOLS-DIAGNOSTICS-001`.

### Deterministic and transparent search

- Result: available search rows survive missing totals and upstream degradation remains visible.
- Dependencies: trusted diagnostic output.
- Acceptance: missing totals do not discard rows; shown counters remain consistent; engine failures are explicit.
- Verification: repeat the #47 failure query through the real shadowing tool and inspect returned rows and status.
- Stop conditions: stop if upstream output lacks enough status data to support the required engine report.
- Spawns child plan: yes, `PLAN-IMPROVED-WEBTOOLS-SEARCH-001`.

### Reliable web fetching

- Result: static pages, JavaScript pages, and GitHub routes produce content or exact route diagnostics.
- Dependencies: trusted diagnostic output.
- Acceptance: the #48 static forum specimen returns content; named JavaScript specimens use the intended renderer path.
- Verification: exercise the exact #48 URLs through the real shadowing tool and inspect the extracted result.
- Stop conditions: stop if an external site has changed enough to invalidate an issue specimen.
- Spawns child plan: yes, `PLAN-IMPROVED-WEBTOOLS-FETCH-001`.

### Disposition of advanced handlers

- Result: PR #56 is integrated only if it satisfies #49 without its confirmed defects.
- Dependencies: stable diagnostic and fetch boundaries.
- Acceptance: each review claim receives source and runtime validation; the final branch claims only proven behavior.
- Verification: run direct domain specimens for every claimed handler and inspect user-visible failure output.
- Stop conditions: stop for user choice if preserving PR #56 conflicts with a simpler replacement route.
- Spawns child plan: yes, after PR findings are validated.

### CLI-first architecture

- Result: CLI, MCP, and OpenCode adapters use one canonical fetch and search implementation.
- Dependencies: prior behavioral milestones.
- Acceptance: isolated installation needs no sibling checkout; each adapter exposes the same behavior.
- Verification: run the isolated CLI, MCP, and normal OpenCode installation contracts stated in #51.
- Stop conditions: stop before architecture work if materially different adapter designs remain viable.
- Spawns child plan: yes, `PLAN-IMPROVED-WEBTOOLS-CLI-FIRST-001`.

## Risks / Recovery / Stop Rules

- PR #56 overlaps core fetch code. Do not combine it blindly with #48 changes.
- External search engines and target sites can change. Preserve exact response evidence for each run.
- Do not change issue requirements to match an easier implementation.
- Stop for user review before any architectural choice under #51.

## Progress

- [ ] Trusted diagnostic output is proven in normal and debug modes.
- [ ] Search returns available rows and exact degraded-state information.
- [ ] Static and JavaScript fetch specimens return content or exact route diagnostics.
- [ ] PR #56 has a source-backed disposition against #49.
- [ ] The CLI-first architecture has an approved child plan.

## Decision Log

- Decision: fix direct tool failures before the CLI-first migration.
  Rationale: adapter migration must preserve a known correct behavior boundary.
  Date/author: 2026-08-14, OpenAI Codex.

- Decision: combine #58 and #57.
  Rationale: both defects arise from the same diagnostic-output text and reporting path.
  Date/author: 2026-08-14, OpenAI Codex.

## Revision Notes

- 2026-08-14: created from the ranked GitHub issue assessment.
