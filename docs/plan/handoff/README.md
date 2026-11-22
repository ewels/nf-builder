# Hand-off plans (session 2)

Plans written by the planner agent on 2026-11-22 for features not yet merged, kept here so the next session can resume without re-planning. They are inputs, not decisions of record: the open points are settled below and still have to be recorded (ADR, `open-questions.md`, `progress.md`) when each feature lands. Delete a plan in the PR that merges its feature. Paths under `/tmp/...scratchpad...` in the plans pointed at session scratch files and may be gone; where it matters, the files were copied into the repo or the worktree.

## State on 2026-11-22

| Feature | Branch | State |
|---|---|---|
| F-102 script AST | `feat/F-102` (pushed) | Tasks 1–4 committed (types, statements and expressions shared with configs, declarations, comment attachment matching nf-lang on 3,923/3,923 corpus comments). Tasks 5–6 (builder errors incl. the 31 F-101 cases; corpus property test, oracle trees, comment-dump oracle) were in progress; see the branch's last commit and `progress.md`. Then task 7 (records), merge `main` (F-204 changed `packages/lang-core/src/index.ts`), PR, review. |
| F-103 config AST | `feat/F-103` (pushed, stacked on `feat/F-102`) | Built and committed: config AST, 228 corpus snapshots, range property test, ConfigAstBuilder errors, oracle cases. After F-102 merges: merge `main`, fill comment slots with F-102's `attachComments`, drop `src/ast/config/literal-errors.ts` if F-102's shared builders now report escapes and number formats, records, PR. |
| F-104 round trip | not started | [plan](plan-F-104.md). Branch from `main` after F-102 (and F-103) merge. |
| F-110 printer | not started | [plan](plan-F-110.md). Branch from `main` after F-102 merges; can run alongside F-104. |

Next free ADR number: 0032.

## Decisions already taken on the plans' open points

### F-102 — [plan](plan-F-102.md)
- Conventions are ADR 0027 (on `feat/F-102`; flat ranges `{start, end, line, column, endLine, endColumn}`, nf-lang comment attachment, AR-02 amended).
- Report every ScriptAstBuilder error; `-1:-1` upstream errors at the real node; vendored nf-core/fastqc fixture module (MIT) allowed; oracle extended to lint the fixture and error trees (an AGENTS.md "Nextflow knowledge" line says the oracle reproduces `errors.json`); comment-dump oracle in `pnpm test:corpus`.
- Records at landing: `docs/licences.md` rows for the ported `ScriptAstBuilder`, `CommentAttacher`, `Comments`, `EscapeUtils`, Groovy `StringUtils`/`Numbers` logic, the syntax-reference snippets in fixtures (Apache-2.0) and the vendored fastqc module (MIT); notes from the plan's section 9.

### F-103 — [plan](plan-F-103.md)
- Reuses F-102's base types and expression/statement builders (the plan's tasks 1–2 are covered by F-102).
- Snapshots all 228 corpus configs (one line per statement); fixture configs are oracle cases; integer number-format errors ported; `parseConfig` off the pack entry.
- Records at landing: licences rows for ported `ConfigAstBuilder`, `EscapeUtils`, Groovy `Numbers` and the corpus-derived snapshots; AGENTS.md `pnpm test:corpus` row mentions `pnpm test:corpus config-ast -u`; F-112 notes for keyword checks, duplicate named arguments, decimal-number errors, selector placement and include resolution.

### F-104 — [plan](plan-F-104.md)
- Accept the plan's recommendations: a new ADR for `LanguagePack.loadParser()` (lazy, like ADR 0028's `loadCatalogue()`) replacing the synchronous parse methods in the architecture sketch; `Unparsed` joins the AST unions; the plan's isolation and verbatim rules; its reading of the glossary's "equivalent"; chunks parsed by slicing and shifting; `SourceFile` in memory only; `yaml` as a lang-2610 dev dependency and Node types for engine tests are fine.

### F-110 — [plan](plan-F-110.md)
- One new ADR listing the upstream formatter bugs as known differences (ADR 0005), `NO_RANGE` for new nodes (amending ADR 0027) and the blank-line layout for new declarations.
- Port legacy printing too; default formatter flags only; no pack loader in F-110 (the parser loader from F-104 or F-111 carries the printer); the plan's oracle extension; corpus parity in the `corpus-parse` job; reuse F-102's fixtures by path; statement-level printing left to F-111; no fast-check yet.
- Spec gap: also print feature flags, enums and agents if cheap; record what LA-45 formats.

## Process notes for the next session

- Docs-only changes go straight to `main` after `pnpm check` (ADR 0031); everything else through a PR.
- Wait for CI by polling the public check-runs API rather than subscribing to PRs (Netlify bot comments are noisy).
- After every merge to `main`, merge `main` into open feature branches: a PR that conflicts with `main` gets no CI run.
- Visual baselines: download the `playwright-chromium` artefact, view the `-actual.png`, commit it (ADR 0021).
- Local e2e: `export PW_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`; stale `vite preview` servers from other worktrees can hold ports 4173 and 5173. Spike ports: S5 4175, S3 4177 and 4178.
