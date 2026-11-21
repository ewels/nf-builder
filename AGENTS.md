# AGENTS.md

Browser-only visual builder for Nextflow pipelines (TypeScript, React). What it must do: `docs/spec/`. What's decided and why: `docs/adr/README.md`. Scope and status: `docs/plan/features.json`. Session log: `docs/plan/progress.md`.

**Autonomous mode is on** (ADR 0012). Work through the whole feature list without waiting for the maintainer: decide, record, merge, continue.

## Every session

1. Read the last three entries of `docs/plan/progress.md`, `git log --oneline -20`, and `docs/plan/features.json`.
2. Take the first feature, in file order, with `passes: false` whose `depends_on` all pass and that isn't blocked. Work on that one only.
3. Run `pnpm smoke` (from F-004 on). If it fails, fixing it is the next work.
4. Read only the spec IDs and ADRs the feature cites.
5. Branch `feat/<id>`. Commit in small steps.
6. To finish the feature:
   - run `pnpm check` and `pnpm test:e2e -- --grep <id>`;
   - set `passes: true` only if every step in the feature passed;
   - append to `progress.md`;
   - open a PR using the template;
   - when CI is green and the reviewer has nothing blocking, squash-merge it, delete the branch, update local `main`, and start again at step 1. Until F-003 adds CI, "CI green" means `pnpm check` passes in a fresh clone of the branch.

## Commands

These arrive with F-001 to F-004. Until then the repo is docs only.

| Command | When |
|---|---|
| `pnpm install` | First run, and after lockfile changes |
| `pnpm dev` | Local dev server (http://localhost:5173; no CSP, see ADR 0014) |
| `pnpm build` | Production build of `apps/web` into `apps/web/dist` (what Netlify runs) |
| `pnpm --filter <package> test` | While iterating on one package |
| `pnpm check` | Before every commit: typecheck, Biome, unit tests, dependency-cruiser |
| `pnpm smoke` | Session start: build plus one end-to-end test |
| `pnpm test:e2e -- --grep F-123` | The feature's end-to-end test |
| `pnpm corpus:fetch` then `pnpm test:corpus` | When touching the parser, model, projection or printer |
| `pnpm gen:grammar 26.10` | After changing vendored grammar files |

The catalogue (`pnpm gen:catalogue`, needs Java) and the Nextflow oracle tests run in CI only. Don't try to run them locally.

`pnpm test:e2e` builds the app and serves it with the `netlify.toml` headers. In the Claude Code cloud sandbox only an older Chromium is installed: export `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` first, and never run `playwright install`. The sandbox also can't reach `*.netlify.app`; the `deploy-check` workflow checks deployed headers instead.

## Boundaries

**Always:** run `pnpm check` before committing; add a test that fails without your change; cite requirement IDs in test names and PRs.

**Decide and record.** These used to need the maintainer. Now make the call, then record it: an ADR marked `Accepted (agent)` or a dated answer in `docs/plan/open-questions.md`, a line under Decisions in `progress.md`, and a mention in the PR:
- a new runtime dependency;
- a change to package boundaries or dependency-cruiser rules;
- a change to a persisted or exported format;
- edits to `.github/workflows/`;
- changes to `features.json` beyond `passes` and `notes` (adding or splitting features is fine; label the PR `scope-change`; never drop scope or weaken a step without an ADR);
- anything that contradicts an accepted ADR (supersede it) or depends on an open question in `docs/plan/open-questions.md` (answer it).

**Blocked.** If a feature needs something only the maintainer can provide (a secret, a GitHub or Netlify setting, an account), note it under Blockers in `progress.md`, open a GitHub issue labelled `maintainer`, and move to the next feature. Stop only when every feature passes or everything left is blocked.

**Never:**
- edit generated files (below);
- edit the body of an `Accepted` ADR, except to append a spike result (ADR 0001);
- delete, skip or weaken a test or approved visual baseline;
- push to `main` directly, or merge a PR before CI is green and the reviewer has nothing blocking;
- force-push or rewrite history on `main`;
- commit tokens or secrets;
- call a network host not on the ADR 0002 allow-list;
- write Nextflow syntax from memory without checking it.

## Generated files

Never edit these. Regenerate them.

- `packages/lang-*/src/generated/**`: `pnpm gen:grammar <version>`
- `packages/lang-*/catalogue/*.json`: CI job `catalogue`
- `apps/web/public/registry/**`: CI job `registry-snapshot`
- `.claude/skills/*/**` (vendored Nextflow skills): `.claude/skills/sync.sh`

## Decisions

If your change adds a dependency, moves a package boundary, changes a stored or exported format, changes user-visible behaviour in the spec, or conflicts with an ADR, add an ADR marked `Accepted (agent)` (from `docs/adr/template.md`) in the same PR and list it in `docs/adr/README.md`.

## Nextflow knowledge

- Check names and signatures in this order:
  1. the pack's `catalogue/*.json`;
  2. https://docs.seqera.io/nextflow;
  3. the syntax reference.
- Use the Nextflow agent skills:
  - Claude Code: eight skills from `seqeralabs/nextflow-plugin` are vendored in `.claude/skills/` (see its README), so cloud sessions get them too;
  - other agents: `npx skills add seqeralabs/nextflow-plugin`.
- Nextflow code in templates and fixtures must pass the CI oracle (`nextflow lint` on 26.10).

## Conventions that tools don't enforce

- UI copy and docs in British English, sentence case, no emoji.
- React Flow node components are presentational. Logic belongs in `packages/engine` (AR-31).
- Conventional Commits, with the package name as scope: `feat(engine): …`.

## Definition of done

- The feature's steps pass end to end.
- `pnpm check` is green.
- New behaviour has tests.
- Spec or ADRs are updated if behaviour or a decision changed.
- `features.json` and `progress.md` are updated.
- The PR template is complete.
