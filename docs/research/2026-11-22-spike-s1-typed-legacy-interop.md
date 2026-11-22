# Spike S1: typed and legacy code across files, `.module-info`, and the latest 26.10 patch

2026-11-22, F-005. Nextflow 26.10.7 (build 15252) run by the oracle (ADR 0019) locally on OpenJDK 21.0.13 and in CI on Temurin 21 (`oracle` job; run linked from the F-005 notes in `features.json`). Sources read at tag v26.10.7, commit 0ad848ef3c3a22824cd9eb2ca14568385867702d. `S` stands for `https://github.com/nextflow-io/nextflow/blob/v26.10.7`.

## Answers

| Question | Answer | Evidence |
|---|---|---|
| Can a typed workflow call a legacy process or workflow from another file? | Yes. Tuple inputs must be built with `tuple(...)`; a mixed list literal fails lint | cases `s1-typed-calls-legacy`, `s1-typed-calls-legacy-module`, `s1-typed-list-literal-tuple`; `S/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L119-L162`, `#L211-L253` |
| Can a legacy workflow call a typed process or workflow? | Yes | cases `s1-legacy-calls-typed`, `s1-legacy-calls-typed-module`; DataflowTypesTest.groovy#L74-L117 |
| Typed and legacy definitions in one script? | Rejected by the parser, with or without the types flag | cases `s1-mixed-types-on`, `s1-mixed-types-off`; `S/docs/static-typing.mdx#L50`; `S/modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java#L585`, `#L664` |
| `.module-info` format | Java properties: `checksum`, `registryUrl` | ModuleInfo.groovy, ModuleStorage.groovy (below) |
| Latest 26.10 patch | 26.10.7 (2026-11-20); 26.10.6 exists (2026-11-12) | tags; `pnpm nextflow -- -version` |

## Method

- `pnpm nextflow` runs the pinned `nextflow-26.10.7-dist` (SHA-256 `c54cd4b7…80a6` in `packages/lang-2610/upstream.json`) with `NXF_HOME=.cache/nextflow/home`, `NXF_OFFLINE=true`, `NXF_SYNTAX_PARSER=v2` and inherited `NXF_VER` dropped.
- `pnpm oracle` copies each case to `.cache/oracle/runs/<id>/` and runs `nextflow lint -o json .` and `nextflow run main.nf -stub`, comparing the exit status and expected texts with `tools/oracle/cases/cases.yaml`. It also lints each corpus fixture alone and compares with `tools/corpus/fixtures/fixtures.yaml`.
- `-stub` needs no tools or containers; every S1 process with a `script:` has a `stub:`.
- Logs: CI artifact `nextflow-oracle` (`runs/<case>/lint.log`, `run.log`, `report.md`, `results.json`).

## Cases

All 14 case checks and 9 fixture checks matched, locally and in CI.

| Case | Shape | lint | run -stub |
|---|---|---|---|
| `s1-typed-calls-legacy` | typed entry calls a legacy process and workflow from `module.nf` (verbatim from DataflowTypesTest) | ok | ok |
| `s1-typed-calls-legacy-module` | typed entry calls an nf-core-shaped legacy module (`tuple val(meta), path(reads)`), input built with `tuple([id: reads.baseName], reads)`, outputs read by assignment (`legacy_out.txt`) | ok, 0 errors, 0 warnings | ok; prints `txt: [[id:s1], …/s1.count.txt]` and `versions: …/versions.txt` |
| `s1-typed-list-literal-tuple` | same, input built with `[[id: reads.baseName], reads]` | error: `main.nf:14:25 List expression has inconsistent element types -- some elements have type Map<String, String> while others have type Path` | ok, with `WARN: Type checking found 1 error(s) -- run nextflow lint to inspect them` |
| `s1-legacy-calls-typed` | legacy entry calls a typed process (verbatim from DataflowTypesTest) | ok | ok |
| `s1-legacy-calls-typed-module` | legacy entry calls a typed module from `modules/local/` | ok | ok; prints `count: …/count.txt` |
| `s1-mixed-types-on` | types enabled, typed and legacy processes in one script | error: `Invalid input declaration in typed process` (plus two follow-on "not defined" errors) | error: `Error main.nf:28:5: Invalid input declaration in typed process`, then `Script compilation failed` |
| `s1-mixed-types-off` | the same script without the flag | error: ``Typed input declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script`` | error at `main.nf:8:5` with the same message, then `Script compilation failed` |

## Hypotheses vs results

- The plan expected `s1-typed-calls-legacy-module` to pass lint with a list literal `[[id: x], reads]`, the shape nf-core code uses. It failed: in typed scripts, `TypeCheckingVisitor.visitListExpression` rejects any list literal whose elements have different inferred types (`S/modules/nf-lang/src/main/java/nextflow/script/control/TypeCheckingVisitor.java#L1403-L1424`, comparing with `Types.isEqual`, `S/modules/nf-lang/src/main/java/nextflow/script/dsl/Types.java#L198-L210`). Map literals with mixed value types are fine. `nextflow run` only warns (`S/docs/migrations/26-10.mdx#L22`).
- The documented idiom is the stdlib `tuple()` function (`Tuple tuple(Object... args)`, `S/modules/nf-lang/src/main/java/nextflow/script/dsl/ScriptDsl.java#L213-L216`; `S/docs/reference/stdlib-namespaces/global.mdx#L188-L190`; `S/docs/reference/semantics.mdx#L192-L208`; `S/docs/tutorials/static-types-operators.mdx#L176`). With it the case passes lint and run with no warning. The list-literal form stays as its own case so the oracle keeps recording the difference.
- Lint doesn't check a legacy input's shape: in a scratch run, `tuple([id: x])` sent to the two-component input passed lint and failed at run time (`Error executing process > 'LEGACY_COUNT (1)'`). The app has to compare arity itself.
- `tuple(record(id: x), reads)` also passes lint and run, and `meta.id` works in the legacy process; nf-core modules that use Map operations on `meta` (`meta + [...]`) were not tested with a record.
- Every other expectation held as planned.

## Lint warnings seen

None in any interop case once `tuple()` is used.

## `.module-info`

- A `java.util.Properties` file written by `props.store(os, null)`, so the first line is a `#<date>` comment and `:` in values is escaped. Two keys: `checksum` (SHA-256 of the installed module directory without `.module-info`) and `registryUrl`. `S/modules/nextflow/src/main/groovy/nextflow/module/ModuleInfo.groovy#L34`, `#L44-L72`, `#L99-L108`.
- Written on `module install` and refreshed after vendoring a workflow module's dependencies: `ModuleStorage.groovy#L151-L153`, `#L235-L238`, `#L117-L128`. `module list` scans for it (`#L166-L200`); `module remove` refuses a folder without it unless `-force` (`#L265-L272`).
- Unknown: the checksum algorithm, in `io.seqera:npr-client` (`ModuleChecksum.computeDirectory`, delegated from `ModuleChecksum.groovy#L39-L41`), which isn't in the Nextflow repository.
- Consequence: F-504 doesn't write `.module-info` until the algorithm is verified with the oracle (ADR 0009 spike result).

## Latest 26.10 patch (LA-03)

v26.10.7, commit 0ad848e, 2026-11-20, is the latest on 2026-11-22; v26.10.6, commit 9dca05a, 2026-11-12, exists, so the `>=26.10.6` floor stands. The release publishes no checksum; the pin's SHA-256 was computed from a sandbox download and matches a fresh download by the tool and by CI's cache-miss run.

## Other findings

- The types flag takes effect where it is declared (`ScriptAstBuilder.java#L320-L325`); LA-12 puts it at the top.
- `nextflow run` warns about type errors that `nextflow lint` fails on, so the oracle must lint, not only run.
- All nine corpus fixtures give the `lint` result `fixtures.yaml` records.

## Consequences

- ADR 0007 spike result: the decision stands; LA-14 drops its warning and says how typed code passes legacy tuple inputs.
- F-110 and F-504: the printer emits `tuple(a, b, …)` for a legacy tuple input in typed code, never a mixed list literal; the connection check (F-302) compares arity with the legacy declaration.
- ADR 0009 spike result: `.module-info` deferred to F-504.
- LA-03 confirmed. ADR 0019 records the oracle.
