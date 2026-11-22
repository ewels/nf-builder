# 0037. Wire code nodes to the variables they read and write

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0004 keeps every statement the projection can't model as a code node, and AR-13 and LA-27 say a code node's inputs are the variables it reads that were defined elsewhere in the workflow, and its outputs the variables it assigns. F-106 left code nodes as shells with no inputs. LA-27 doesn't say how closures, mutations, conditional writes, `params` or keys are treated. nf-lang 26.10.7's `VariableScopeVisitor` decides which names are defined where; `nextflow lint` reports a free read with no definition as "`x` is not defined", which gives an oracle. Research: the [F-108 plan](https://github.com/ewels/nf-builder/blob/7203dc6/docs/plan/handoff/plan-F-108.md).

## Decision

- **Free-variable analysis** (`packages/engine/src/projection/free-variables.ts`) follows nf-lang's scoping in source order: block and closure scopes, closure parameters and implicit `it`, catch variables, `def` at the statement's top level versus inside a nested block or closure, implicit declaration by assignment, compound assignment as a read and a write, and `.set { v }`/`.tap { v }` as writes. Method names, property names and map or named-argument keys are not reads.
- **Inputs:** one port per distinct resolved free read (through the shared `scope.ts`), with indirect edges carrying the source's type. Reads inside closures count, since the node is opaque and lint counts them. Reads that resolve to nothing (functions, built-ins, unbound names) get no port; `params` read as a whole gets none, while `params.x` does.
- **Outputs:** one port per variable the statement writes, in first-write order, rebound in the scope so later statements read them. A conditional write without an `else` still replaces the earlier binding (LA-27 read strictly). Mutations (`x.p = v`, `x[i] = v`, `x << v`, `x.add(v)`) are reads only; a later read of `x` doesn't depend on the mutation, a recorded limitation.
- **Keys:** the first output's variable, or `:code@n` with no outputs (ADR 0036's grammar, unchanged).
- **Text:** a code node keeps its exact source slice (`CodeNode.text`) and a one-line label.
- **Oracle:** a lint-only probe tree (`packages/engine/test/projection/code/free-variables/`) records lint's "not defined" errors at exact positions; our analysis must find the same free reads (apart from upstream-bugs 22's one-column shift).

## Consequences

- Statements the projection can't model still connect to the graph, so a canvas shows where their data comes from and goes.
- F-111 can move or delete a code node by its range and text; F-112 can report unresolved free reads.
- The round trip stays exact: projecting never changes a file.

## Alternatives

- Ignore closure reads (as F-106's chains do): hides real dependencies of opaque code.
- Treat mutated roots as outputs: more edges, but LA-27 says outputs are assigned variables.
- A port for `params` as a whole: one port that every node would share, adding noise without information.
