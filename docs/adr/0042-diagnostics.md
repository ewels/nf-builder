# 0042. Diagnose with pack lint rules that match nextflow lint, with advice and text-edit quick fixes

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

LA-29 to LA-36 and AR-05 list the diagnostics the app shows. ADR 0005 makes `nextflow lint` the reference for what is valid, and LA-02 and ADR 0006 keep version-specific behaviour in the language pack. The architecture sketch had `lints: LintRule[]` on the pack, loaded eagerly. `nextflow lint` 26.10.7 reports some checks only as warnings and hides others: nf-lang's paranoid checks (`storeDir`, legacy params, params outside the entry workflow). Some errors it misses entirely, such as a process called twice (upstream bug 24). nf-lang also rejects call-arity mismatches in both typed and legacy scripts, while LA-33 called an unconnected input a warning. F-111 defined `ReplaceFileText { path, text }`. Research: the [F-112 plan](https://github.com/ewels/nf-builder/blob/2145be9/docs/plan/handoff/plan-F-112.md).

## Decision

- **Rules live in the pack,** behind a lazy `LanguagePack.loadLints(): Promise<PackLints>`, which replaces the sketch's `lints`. `PackLints` holds the code registry (`codes`: severity, spec IDs, origin, upstream references, lint pattern and fixability), the rules, and `connection(source, target)` for LA-29. The engine's `createDiagnoser` assembles everything per file and never throws:
  - parse problems become `syntax` errors;
  - the model's include diagnostics are added;
  - the pack's rules run, and a rule that throws becomes an `internal` warning;
  - results are sorted and memoised per file.
- **Origins.** Each code records where it comes from:
  - `parser` or `model`;
  - `lint`: `nextflow lint` reports it, and our wording and position match it;
  - `paranoid`: nf-lang checks that lint hides;
  - `ours`: not in nf-lang.

  The fixtures under `packages/lang-2610/test/lints/` are recorded by the pinned lint and checked by the oracle's `lint-fixtures` tree. The corpus test checks every lint-origin code against lint's errors and warnings on every pinned pipeline.
- **Message style.** nf-lang's wording is kept verbatim, then ` -- <what to do>`. Messages that already say what to do are listed per code as verbatim.
- **Quick fixes** are text edits on the diagnosed text: `QuickFix { title, path, edits }`, with `TextEdit` shared with F-111. Applying one gives F-111's `ReplaceFileText`. A fix is stale once the file changes. Four codes are fixable:
  - `deprecated-channel`;
  - `implicit-it`;
  - `publish-type-ignored`;
  - `duplicate-name` (an identical include entry).

  `applyTextEdits` drops exact duplicate edits.
- **The v0.1 code set** (29 codes in the pack registry, plus the engine's `internal`):
  - `syntax` (LA-30);
  - include codes (AR-03, AR-05);
  - feature flags, pipeline include types, agent outputs and config include placement (LA-31);
  - `type-mismatch` and `multiple-channels`, for typed scripts only, as nf-lang does (LA-29, LA-32);
  - `call-arity` and `unused-output` (LA-33);
  - deprecations (LA-34);
  - legacy process and workflow suggestions (LA-35);
  - the LA-36 suggestions;
  - typed-code warnings (LA-37);
  - `include-alias`, `duplicate-name` and `duplicate-call` (AR-05).
- **Spec changes:**
  - **LA-33** is now an error for a missing argument, since nf-lang rejects it. It is a warning for an unused output. A `null` argument for a typed input that isn't nullable is reported as `call-arity`, because the run rejects it.
  - **LA-31** gains the constructs above, and **LA-37** is new.
  - **Paranoid checks** are reported at the spec's severity, even though lint is silent on them.
- **`duplicate-call`** (ours) reports a process called again on the same branch path of one workflow. Calls under different conditions don't count, because the corpus has them (sarek).
- **`unused-output`** is checked per call, from AST reads. It exempts topics, a `publishDir` directive and config `publishDir`.
- **Deferred, with no new feature for v0.1:** full nf-lang name resolution and type-check parity. That covers:
  - `x is not defined`;
  - unused variables;
  - globals in processes;
  - deprecated operators under static typing;
  - `.out` read before its call;
  - unresolved code-node reads;
  - typed workflows rejecting `set` and `tap`;
  - operator and record types;
  - function arity.

  LA-14 tuple arity goes to F-302 and F-504.

## Consequences

- The initial bundle doesn't grow (QA-01): the rules load with the parser, in the worker once F-113 lands.
- A new Nextflow version brings its own pack rules, and the fixtures re-record with the new lint.
- Diagnostics are in memory only. There is no new dependency.
- Some invalid code passes without a diagnostic until name resolution is added, and lint misses it too.

## Alternatives

- **Rules in the engine:** this ties version-specific checks to the engine, against ADR 0006.
- **Our own wording:** this loses parity with lint and its documentation.
- **`QuickFix` carrying a command:** this duplicates F-111's command shape.
- **Hiding the paranoid checks as lint does:** LA-34 and LA-36 name them.
- **A separate feature for name-resolution parity:** the spec doesn't require it for v0.1.
