# 0016. Guard features.json scope in CI and keep a one-minute smoke run

- Status: Accepted (agent)
- Date: 2026-11-21

## Context

ADR 0012 lets agents change only `passes` and `notes` in `docs/plan/features.json`; anything else needs the `scope-change` label. Until now that rule lived in prose. Each session also starts with `pnpm smoke` (AGENTS.md), which must be quick enough to run every time.

## Decision

- **Scope guard:** `.github/workflows/scope-guard.yml` (workflow and job `Scope guard`) runs `scripts/check-features-scope.ts` on every pull request, and again when labels change. It compares `features.json` in the PR's merge commit with its first parent, so a stale base never causes a false failure.
  - Allowed without the label: `passes` changing either way, and text appended to `notes` (existing notes stay a prefix).
  - Everything else needs `scope-change`: other fields, features added, removed or reordered, and the `$comment`.
  - The label only opens the gate. The change must still be recorded (AGENTS.md "Decide and record") and must never drop scope or weaken a step without an ADR.
  - It is a separate workflow, a deliberate exception to ADR 0015's single CI workflow (like `Deploy check`), so a label change re-runs only this check.
  - The guard runs the PR's own copy of its script, so a PR that changes the guard deserves the same scrutiny as one that changes scope; the reviewer checks both.
- **Smoke:** `pnpm smoke` builds the app and runs the `@smoke` end-to-end tests on Chromium (F-004's "one e2e test" read as at least one: `@smoke` also selects the QA-20 Firefox and WebKit set, which later features may grow), failing if the whole run takes 60 s or more. CI runs it on the Chromium leg. The `@smoke` tag also selects the Firefox and WebKit tests (ADR 0015).
- AGENTS.md's Commands section lists only commands that exist; a test checks it against `package.json`, and the PR template's definition of done against AGENTS.md.

## Consequences

- Scope edits are visible and labelled; an unlabelled rewording fails CI.
- Commands that later features add (corpus, grammar, catalogue) join AGENTS.md when they land.

## Alternatives

- A required review from the maintainer on `features.json` (CODEOWNERS): contradicts autonomous mode (ADR 0012).
- Folding the guard into `ci.yml`: a label change would re-run every job.
