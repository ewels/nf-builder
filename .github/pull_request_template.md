## Feature

F-___: <!-- description from features.json -->

Spec IDs: <!-- e.g. UX-25, LA-29 -->

## What changed

<!-- A few lines. Link any new or changed ADR. -->

## Definition of done

<!-- The AGENTS.md list, item for item (test/agents-md.test.ts keeps them in step). Say below if an item doesn't apply. -->

- [ ] The feature's steps pass end to end: `pnpm test:e2e -- --grep F-___`, and every step in `features.json` is verified
- [ ] `pnpm check` is green
- [ ] New behaviour has tests that fail without the change, with requirement IDs in their names
- [ ] Spec or ADRs are updated if behaviour or a decision changed: an `Accepted (agent)` ADR for each ADR 0001 trigger
- [ ] `features.json` and `progress.md` are updated
- [ ] The PR template is complete

## Checks

- [ ] CI is green: every job of the CI and Scope guard workflows
- [ ] `features.json`: only `passes` set and `notes` appended (the Scope guard job checks this), or the PR has the `scope-change` label and the decision is recorded
- [ ] Budgets unchanged, or the raise and its reason are in `scripts/budgets.json` and below
- [ ] No tests or visual baselines deleted, skipped or weakened
- [ ] Fresh-context review done; findings addressed or answered below

## Decisions made for the maintainer

<!-- Each call with its ADR or open-question link, or "none". -->

## Screenshots

<!-- For UI changes: before and after. -->
