# AGENTS.md

Browser-only visual builder for Nextflow pipelines (TypeScript, React). What it must do: `docs/spec/`. What's decided and why: `docs/adr/README.md`. Scope and status: `docs/plan/features.json`. Session log: `docs/plan/progress.md`.

**Autonomous mode is on** (ADR 0012). Work through the whole feature list without waiting for the maintainer: decide, record, merge, continue.

## Every session

1. Read the last three entries of `docs/plan/progress.md`, `git log --oneline -20`, and `docs/plan/features.json`.
2. Take the first feature, in file order, with `passes: false` whose `depends_on` all pass and that isn't blocked. Up to three such features may be worked on at once, each on its own branch and git worktree, when none depends on another (ADR 0018).
3. Run `pnpm smoke`. If it fails, fixing it is the next work.
4. Read only the spec IDs and ADRs the feature cites.
5. Branch `feat/<id>`. Commit in small steps.
6. To finish the feature:
   - run `pnpm check` and `pnpm test:e2e -- --grep <id>`;
   - set `passes: true` only if every step in the feature passed;
   - append to `progress.md`;
   - open a PR using the template;
   - when CI is green and the reviewer has nothing blocking, squash-merge it, delete the branch, update local `main`, and start again at step 1. "CI green" means every job of the `CI`, `Deploy check` and `Scope guard` workflows passed on the PR head (ADRs 0015, 0016). The `Registry snapshot` workflow depends on a third party and is not a merge gate (ADR 0035).

## Commands

This table lists every root `package.json` script that `pnpm check` doesn't already run, and nothing that doesn't exist yet; `test/agents-md.test.ts` checks both. A feature that adds a script adds its row.

| Command | When |
|---|---|
| `pnpm install` | First run, and after lockfile changes |
| `pnpm smoke` | Session start: a fresh build plus the `@smoke` end-to-end test on Chromium; fails unless it finishes in under 60 s |
| `pnpm dev` | Local dev server (http://localhost:5173; no CSP, see ADR 0014) |
| `pnpm build` | Production build of `apps/web` into `apps/web/dist` (what Netlify runs) |
| `pnpm preview` | After `pnpm build`: serve `apps/web/dist` with the `netlify.toml` headers on http://localhost:4173, as the end-to-end tests do |
| `pnpm --filter <package> test` | While iterating on one package |
| `pnpm format` | Before `pnpm check`: apply Biome's formatting and safe fixes |
| `pnpm check` | Before every commit: typecheck, Biome, unit tests, dependency-cruiser, ADR lint, `features.json` validation |
| `pnpm check:budget` and `pnpm check:hosts` | After `pnpm build`: QA-01 bundle budget and IO-41 host allow-list (ADR 0015) |
| `pnpm test:e2e -- --grep F-123` | The feature's end-to-end test |
| `pnpm bench` | After `pnpm corpus:fetch`: sarek open time (QA-03) and edit p95 (QA-04) in the engine worker on Chromium; report in `.cache/reports/bench.{json,md}`; CI job `bench`, reported not gated |
| `pnpm corpus:fetch` | Fetch the pinned pipeline corpus into `.cache/corpus/` (git over github.com; second run is a no-op) |
| `pnpm spike:s5` | Spike S5 (F-010): fetch the pinned Pyodide and nf-metro files, render the CLI references, then serve the test page on http://localhost:4175 (needs Python 3.11+) |
| `pnpm nextflow -- <args>` | Run the pinned Nextflow (`packages/lang-2610/upstream.json`, Java 17 to 26): downloads the release once into `.cache/nextflow/`, checks its SHA-256, runs offline |
| `pnpm oracle` | After changing Nextflow fixtures, templates or the printer: `nextflow lint` and `nextflow run -stub` on every case in `tools/oracle/cases/cases.yaml`, and `nextflow lint -format` on the printer fixtures (`packages/lang-2610/test/printer/fixtures.json`); `--write-format` regenerates their `formatted*/` goldens; report in `.cache/oracle/report.md` (CI job `oracle`) |
| `pnpm gen:grammar 26.10` | After changing `packages/lang-2610/grammar/` (vendored `.g4` or `port.ts`): regenerate `src/generated/`; `--check` only compares |
| `pnpm gen:catalogue 26.10` | Regenerate `packages/lang-2610/catalogue/*.json` from the pinned language server jar (needs a JDK 17+); `--check` compares; CI job `catalogue` runs it on every PR |
| `pnpm gen:palette 26.10` | After editing `packages/lang-2610/palette.yaml`: regenerate `palette.json`; `--check` compares (a unit test runs it in `pnpm check`) |
| `pnpm corpus:lint` | After `pnpm corpus:fetch`: `nextflow lint -o json` on each pinned pipeline and the malformed fixtures into `.cache/corpus-lint/` (needs Java; cached per pin and Nextflow version). The launcher is `--nextflow <path>`, else `NXF_LAUNCHER`, else the pinned dist at `.cache/nextflow/<version>/nextflow-<version>-dist` (version from `packages/lang-2610/upstream.json`). The comment dump `pnpm test:corpus` needs (`<id>.comments.json`) is written only with the pinned dist |
| `pnpm test:corpus` | After `corpus:lint`, and when touching the parser, model, projection or printer: parse every corpus file, compare with lint, compare comment attachment with nf-lang, write `.cache/reports/parse-corpus.{json,md}`, `ast-corpus.{json,md}` and `round-trip.md` (lossless round trip, F-104), `model-corpus.md` (include resolution, F-105), `projection-corpus.md` (projection, F-106), `code-nodes-corpus.md` (code nodes, F-108), `legacy-projection.md` (legacy projection share, F-107), and check the config AST snapshots and ranges; `pnpm test:corpus config-ast -u` rewrites the snapshots after an intended AST change or a pin bump (about 4 minutes) |
| `pnpm registry:snapshot` | Build the registry snapshot (F-501, IO-31) into `.cache/registry/out` with the 26.10 pack: `--out`, `--previous`, `--report`, `--only <names>` and `--plugins <ids>` for a few items, `--record <dir>` or `--replay <dir>` for fixtures. Live runs from the sandbox need `NODE_USE_ENV_PROXY=1`; a full run takes about 45 min |
| `pnpm check:registry <dir>` | After `pnpm registry:snapshot`: QA-06 index size and snapshot integrity; `--url <site> --generated-at <iso>` polls a deployed site instead |

Run `pnpm test:corpus` when touching the parser, model, projection or printer. The catalogue (`catalogue` job), the corpus parse (`corpus-parse` job) and the Nextflow oracle (`oracle` job) always run in CI. Running Nextflow locally as well is allowed for a faster loop (ADR 0018): use `pnpm nextflow` and `pnpm oracle`, which run the version pinned in `packages/lang-2610/upstream.json` (Java 17 to 26; ADR 0019); CI stays the authority.

`pnpm test:e2e` and `pnpm smoke` build the app and serve it with the `netlify.toml` headers. In the Claude Code cloud sandbox only an older Chromium is installed: export `PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` first, and never run `playwright install`. An unfiltered Chromium `pnpm test:e2e` also runs spike S5, which needs network access to its recorded hosts and Python 3.11+ on first run. Some sandboxes can't reach `*.netlify.app`; the `deploy-check` workflow checks deployed headers either way. Visual baselines in `e2e/__screenshots__/` come only from CI (ADR 0021): when a `@visual` test fails, download the `playwright-chromium` artifact, view the `-actual.png` and commit it at the expected path; never run `--update-snapshots` locally.

## Boundaries

**Always:** run `pnpm check` before committing; add a test that fails without your change; cite requirement IDs in test names and PRs.

**Decide and record.** These used to need the maintainer. Now make the call, then record it: an ADR marked `Accepted (agent)` or a dated answer in `docs/plan/open-questions.md`, a line under Decisions in `progress.md`, and a mention in the PR:
- a new runtime dependency;
- a change to package boundaries or dependency-cruiser rules;
- a change to a persisted or exported format;
- edits to `.github/workflows/`;
- changes to `features.json` beyond setting `passes` and appending to `notes` (the Scope guard fails without the `scope-change` label; adding or splitting features is fine; never drop scope or weaken a step without an ADR);
- anything that contradicts an accepted ADR (supersede it) or depends on an open question in `docs/plan/open-questions.md` (answer it).

**Blocked.** If a feature needs something only the maintainer can provide (a secret, a GitHub or Netlify setting, an account), note it under Blockers in `progress.md`, open a GitHub issue labelled `maintainer`, and move to the next feature. Stop only when every feature passes or everything left is blocked. Features in milestone M8 are deferred past v0.1 (ADR 0030) and don't count.

**Never:**
- edit generated files (below);
- edit the body of an `Accepted` ADR, except to append a spike result (ADR 0001);
- delete, skip or weaken a test or approved visual baseline;
- push code, tests, workflows, configuration, dependencies, generated files or `features.json` to `main` directly, or merge a PR before CI is green and the reviewer has nothing blocking (docs-only changes may go straight to `main` after `pnpm check`, ADR 0031);
- force-push or rewrite history on `main`;
- commit tokens or secrets;
- call a network host not on the ADR 0002 allow-list from app code (build-time tools may use the hosts their ADR records, ADR 0017);
- write Nextflow syntax from memory without checking it.

## Generated files

Never edit these. Regenerate them.

- `packages/lang-*/src/generated/**`: `pnpm gen:grammar <version>`
- `packages/lang-*/catalogue/*.json`: `pnpm gen:catalogue <version>` (CI job `catalogue` checks it)
- `packages/lang-*/palette.json`: `pnpm gen:palette <version>` from the hand-edited `palette.yaml`
- `packages/lang-*/test/printer/formatted*/**`: `pnpm oracle --write-format`
- the registry snapshot (branch `registry-snapshot`, served at `/registry/`): workflow `Registry snapshot`; never commit it
- `.claude/skills/*/**` (vendored Nextflow skills): `.claude/skills/sync.sh`

## Decisions

If your change adds a dependency, moves a package boundary, changes a stored or exported format, changes user-visible behaviour in the spec, or conflicts with an ADR, add an ADR marked `Accepted (agent)` (from `docs/adr/template.md`) in the same PR and list it in `docs/adr/README.md`.

## Nextflow knowledge

- Check names and signatures in this order:
  1. the pack's `catalogue/*.json`;
  2. https://docs.seqera.io/nextflow;
  3. the syntax reference.
- Record every bug or doc gap found in Nextflow, nf-lang, the language server or the Nextflow docs in `docs/research/upstream-bugs.md`, with a minimal reproducer checked against the pinned release, so the maintainer can file it upstream.
- Use the Nextflow agent skills:
  - Claude Code: eight skills from `seqeralabs/nextflow-plugin` are vendored in `.claude/skills/` (see its README), so cloud sessions get them too;
  - other agents: `npx skills add seqeralabs/nextflow-plugin`.
- Nextflow code in templates and fixtures must pass the oracle (`pnpm oracle`, CI job `oracle`: `nextflow lint` and `nextflow run -stub` on 26.10). In typed code, build a legacy `tuple` input with `tuple(...)`, never a mixed list literal (spike S1). The exceptions are malformed on purpose: in `tools/corpus/fixtures/` the oracle must reproduce the `lint` result recorded in `fixtures.yaml` (ADR 0017), and an oracle case marked `expect: error` in `tools/oracle/cases/cases.yaml` must fail as recorded (ADR 0019). The upstream test inputs in `packages/lang-*/test/ported/` are kept as nf-lang wrote them; their recorded `lint` results are checked for consistency, not re-run (F-101). The AST fixtures and error inputs in `packages/lang-*/test/ast/` and `packages/lang-*/test/config-ast/errors/` are linted by the oracle, which must reproduce the `lint` lists recorded in `fixtures.json` (empty) and `errors.json` (F-102, F-103). Printer fixtures must be lint-clean and their printed form a lint-clean fixed point under `nextflow lint -format`, apart from the known differences in ADR 0032.

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
