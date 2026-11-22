# 0038. Project legacy dataflow forms, including aliases and dataflow conditionals

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

AR-14 says legacy workflows may use `.out`, `|`, `set` and `tap`, and LA-21 that legacy process ports come from input and output qualifiers. F-107's step 2 asks that at least 90% of corpus workflow statements are modelled. Measured on the pinned corpus, AR-14's four forms plus legacy ports reach about 74%; the nf-core pipelines also lean on aliases (`x = FOO.out.bam`), call-result properties (`FOO(x).bam`), process names held in variables, and `if` blocks and ternaries that choose between dataflow branches. Legacy operators such as `first`, `concat`, `set` and `tap` are not in the 26.10 catalogue. Research: the [F-107 plan](https://github.com/ewels/nf-builder/blob/7203dc6/docs/plan/handoff/plan-F-107.md).

## Decision

- **Legacy ports (LA-21):** a legacy process call takes its ports from the qualifiers (`val`, `path`, `file`, `tuple`, `each`, `env`, `stdin`; outputs named by `emit:`, else `out` alone or `[i]`), for legacy and typed callers alike (LA-14). The result is a channel when any argument is a channel or unknown, or when an input is `each`.
- **Legacy forms:** `X.out`, `X.out.name` and `X.out[n]`; pipes and `&` forks, with consecutive operator steps forming one chain; `set { v }` and `tap { v }` as assignments, recognised exactly as nf-lang's `VariableScopeVisitor` does (the only argument is a closure whose body is one bare variable); legacy `params.x = …` as `:params` ports. Typed workflows reject `set` (26.10.7 lint: "Unrecognized method `set` for type Channel<String>"; run: "Operator `set` is not supported in typed workflows -- use an assignment instead"); the projector still reads it as an assignment there, and F-112 reports it.
- **Legacy operators and factories** come from the pack (`LanguagePack.legacyOperators`, the 17 names with their result kinds from the operator docs), not the catalogue generator. They are legacy-only chain steps marked `known: false`.
- **Beyond AR-14's list** (amending AR-14 to say so): aliases (`x = y`, `x = FOO.out.bam`) and process names in variables bind without a node; call-result properties are the call's output port; `if`/`else` and ternary or elvis whose branches hold dataflow are transparent, projecting each branch's nodes with a guard (the branch and condition text) and binding the variable to the union of the reaching definitions. Any other `if` stays one code node (ADR 0037).
- **Coverage:** `Projection.statements` records how each statement was modelled (nodes, a binding, or a code node), and `projectionCoverage` measures the share; the corpus test reports it per workflow and asserts at least 90% overall.
- Node keys are unchanged (ADR 0036); an alias makes no node, so later assignments to the name keep lower occurrence numbers.

## Consequences

- 90.6% of the 2,062 corpus workflow statements are modelled (rnaseq 92.1%, sarek 91.1%); the rest are mostly plain-Groovy utility subworkflows, which stay code nodes.
- The canvas shows nf-core's conditional wiring with guards rather than opaque code blocks.
- The margin over 90% is small; a corpus pin update can move it, and the corpus test will say so.

## Alternatives

- Only AR-14's four forms: about 74%, short of step 2.
- A separate feature for conditionals: splits one coherent projection change across two PRs with no gain.
- Generate the legacy operators from `WorkflowDslV1` in the catalogue generator: no value/channel kinds, misses `tap` and `count*`, and changes the generator.
