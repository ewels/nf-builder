# 0036. Project typed workflows into plain-data graphs with name-based node keys and Channel/Value types

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

AR-10 asks for one projection per workflow (calls, chains, factories, takes, emits, params, output and code nodes, with def-use edges); AR-11 and ADR 0008 make node ids the layout keys, sketched as `<file>#<workflow>/<assigned variable>` or `<callee>@<n>`, but leave the entry workflow, reassignment, role nodes and the counting rule open. F-207 will store these keys in `.nf-builder/layout.json`, so they become a stored format. AR-12 and ADR 0008 define chains; LA-20 to LA-26 define ports; LA-28 asks for `Channel<T>`/`Value<T>` types on edges where known. AR-31 keeps node components presentational, so the projection must be plain data that crosses the worker boundary. `workflow`, `output`, `params` and `take` are legal identifiers in 26.10, so `workflow workflow {}` parses. nf-lang 26.10.7's `TypeCheckingVisitor` decides call result types; the pack's catalogue carries operator, factory and function signatures. Research: the [F-106 plan](https://github.com/ewels/nf-builder/blob/3e20916/docs/plan/handoff/plan-F-106.md).

## Decision

- **Placement:** projection types in lang-core (`src/projection.ts`); all logic in the engine (`src/projection/`), version-independent, with operator, factory, function and typed-output data from the pack's catalogue. The rules ported from nf-lang (call result kinds, workflow emit wrapping, pipeline outputs) live in the engine rather than behind a pack hook. This sits uneasily with LA-02 and ADR 0006: the call-kind rule is old and stable, but agents, `record(...)` and pipeline outputs are new in 26.10 (pipeline includes are experimental). The engine holds no version literal; if a later version changes these rules, they move behind a `LanguagePack` hook then.
- **Node keys** (amends ADR 0008's sketch without superseding it): `path "#" workflow "/" local`, where `workflow` is the name or `""` for the entry workflow, and `local` is `var` (the node whose result is assigned to `var`), `var~n` (the n-th assignment, n >= 2), `callee@n` (the n-th unassigned node of that callee; a chain is `.` plus its first operator, a factory `channel.of`), `:code@n` (the n-th unassigned code node), `:take:name`, `:emit:name`, `:params` or `:output`. Keys hold no offsets, so whitespace never changes them; an edit changes a key only when it changes the node's variable, callee, or order among same-callee unassigned nodes or same-variable assignments. `parseNodeKey` inverts `formatNodeKey`.
- **Graph:** nodes with input and output ports and ranges; ports with declared or inferred `FlowType`, the argument range feeding them and the inline argument's type; edges with the source port's type, the variable read, and whether the use is direct. Chains are maximal runs of operator calls with no assignment between; closures and factory arguments never wire (ADR 0008, LA-25). Statements that aren't dataflow are code nodes (ADR 0004); F-108 gives them inputs. `:params` belongs to the entry workflow (or any workflow reading `params.x`); `:output` to the entry workflow only.
- **Types (LA-28, "where known"):** `FlowType { dataflow: channel | value | plain | null, element }`. Plain values (`Path`, `String`) are their own kind, as nf-lang distinguishes them. A process or agent call returns a channel when any argument is a channel or unknown, else a value; a workflow's plain emit becomes `Value<T>`; operator and factory results come from the catalogue with `E`/`V` substituted. Closure results, record fields, `combine`/`groupBy` tuple components and parameter unification are not inferred. A type-probe oracle tree checks the kinds against `nextflow lint`.
- **Calls:** processes, workflows, agents and pipeline entries; `Unparsed` or unresolved callees stay call nodes with a status; functions, plugin entries and unknown names are code.
- **Lifetime:** a projector is a snapshot of the model with its own memo; F-113 re-projects the re-modelled files and their dependants. The projection is in memory only.

## Consequences

- F-207 can store node keys knowing exactly when they change; F-111 can locate edits from port arguments and node ranges; F-112 can check edge types.
- F-107 and F-108 extend the same projector through the shared `scope.ts` and the signature and code-node hooks.

## Alternatives

- Offset- or line-based ids: break on every whitespace edit.
- `workflow` as the entry workflow's key: collides with a workflow named `workflow`.
- A `LanguagePack.dataflow` hook for the typing rules: more faithful to ADR 0006 but unnecessary while the rules are stable.
- Full nf-lang type inference: closure and record inference is F-112's if LA-32 ever needs it.
