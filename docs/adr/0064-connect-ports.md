# 0064. Connect ports by drag with a worker dry run of targets, draw mismatches red from diagnostics, disconnect with Delete, and check tuple arity in the pack

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

UX-25 says connecting is a drag from an output port to an input port, that invalid targets dim while dragging, and that connecting creates or rewrites the call's argument (ADR 0004). LA-29 allows a connection between incompatible known types but makes it an error diagnostic; unknown types never block. UX-24 draws a type mismatch red with the diagnostic on hover, and QA-12 says colour is never the only signal. F-302's step 3 deletes an edge. LA-14 says `nextflow lint` doesn't check a legacy input's shape, so the connection check compares a tuple's arity with the legacy declaration; ADR 0042 left that check to F-302 and F-504.

F-111 built `Connect` and `Disconnect` (ADR 0039) with no dry run. ADR 0042's `PackLints.connection` is LA-29's check, and the `type-mismatch` code is lint-origin. The pack's lints load only in the engine worker (QA-01, AR-30), whose API ADR 0043 lists. ADR 0052 re-fits the viewport on every new projection; ADR 0060 keeps it for palette adds. React Flow edges are `selectable: false` and the F-206 tests assert that and the shared edge description. ADR 0056 keeps connecting off in read-only.

The spec doesn't say what "invalid" covers, how an edge is chosen for deletion, or what the canvas shows when a drop is refused.

Research: the F-302 plan (deleted in the PR that merged F-302; settled in `docs/plan/handoff/README.md`, "F-302").

## Decision

- **Drag from outputs only** (UX-25). Output handles start a connection and input handles end one; dragging from an input does nothing. A drop applies `Connect` through the canvas store as one undo step; connecting to a fed input rewrites its argument. Undo labels stay "Connect" and "Disconnect".
- **Dry run of targets** (amends ADR 0043's API list). `connect` is split into `planConnect`, which makes every check that doesn't need the reprint (locate, ports, self, cycles, statement order, reassignment, target kind, emit and output items, the positional slot, and comment loss) and throws the same refusals with the same messages, and the rewrite. `EngineApi.connectionTargets({path, workflow, from})` answers, at the current revision, a status for every input port of the workflow:
  - `refused` when `planConnect` refuses, with its message;
  - `mismatch` when the pack's `connection` check says `incompatible`, or `tupleArity` finds a different component count, with a message in the diagnostic's wording;
  - `ok` otherwise, unknown types included (LA-29).
  The dry run predicts the argument count after the connect: nf-lang checks a call's argument types only when their number is right, so a connect that leaves the count wrong is `ok`, and `mismatch` is given only when the connect makes the count right. A refusal only the full apply finds (a new parse problem, LA-13 mixing) isn't predicted; the drop then shows it. The page drops answers for an older session or revision.
- **Dimming.** Refused targets dim with a `not-allowed` cursor and reject the drop. Mismatched targets dim with a dashed red ring and accept it (LA-29), after which the edge is red. A card with no `ok` or `mismatch` input dims. Each state carries the engine's message as a `title`. Components only map statuses to classes (AR-31). A refused drop shows "Couldn't connect: <message>" in the canvas notices region, cleared by the next change.
- **Mismatch edges** (UX-24, QA-12). `edgeMismatches(projection, diagnostics)` maps `type-mismatch` and `tuple-arity` diagnostics to edges: the diagnostic's range equals the target port's argument (a call) or contains it (an emit or output item), and every edge into that port is marked. The canvas uses diagnostics only at the projection's revision. A marked edge is drawn in the error colour with a thicker stroke, above the selection highlight, with a "!" glyph at its midpoint (the second cue), and its tooltip and aria label carry the diagnostic's message.
- **Disconnect.** Edge selection is canvas-local; React Flow's `selectable` stays false and its `deleteKeyCode` stays null, so the F-206 tests are unchanged. Clicking an edge selects it and clears node selection; Enter on a focused edge selects it; Escape, a pane click or focus leaving the edge clears it. Delete or Backspace on the selected or focused edge applies `Disconnect` (ADR 0039). A deletable edge exposes `role="button"` with `aria-pressed` for its selection, and its aria label adds "Press Delete to disconnect."
- **Viewport kept** (amends ADR 0052's viewport rule, as ADR 0060 did for palette adds). The views that follow a connect or disconnect carry `refit: false`.
- **Tuple arity** (LA-14; amends ADR 0042's code set, now 31 codes). A new pack code `tuple-arity`, severity error, origin `ours`, spec `LA-14` and `LA-32`: in a typed script, a call to a modelled legacy process whose `tuple` input gets a `tuple(...)` with a different positional count, or a single direct source of known `Tuple<…>` arity that differs. `PackLints.tupleArity` serves the dry run. The pinned `nextflow lint` 26.10.7 was checked and doesn't report tuple arity, so the code has no lint pattern.
- **`Port.components`** (lang-core projection, plain data, not stored): the component count a legacy `tuple` input declares, set by the legacy signature.
- **Record parity.** The oracle confirmed that the pinned lint reports a `Path` passed to a `Sample` record input, so `type-mismatch` stays lint-origin; record lint fixtures cover it.
- **Read-only** (ADR 0056). No connection starts, no edge selection, and Delete on an edge does nothing; the store refuses connect and disconnect without calling the engine.

## Consequences

- Connecting and disconnecting work on the canvas with feedback before the drop, and every mismatch the diagnostics report shows on its edge.
- The dry run costs one `planConnect` per input port, with no reprint, so it stays cheap on large workflows (QA-04); it can mark a target `ok` that the drop then refuses for a parse or mixing reason.
- Disconnecting an argument that a Connect introduced through `x = P()` leaves `x` assigned and unused, which lint reports as an unused-variable warning. This is known; F-310's node delete is where unused assignments get cleaned up.
- Keyboard port connection (QA-11) stays with F-701. F-504 reuses `connectionTargets` and `tuple-arity`. F-308's edge drops must not clash with edge selection; F-310's node Delete shares the canvas key handler.
- The `connect-mismatch` `@visual` baseline is approved from CI (ADR 0021). No stored or exported format, runtime dependency, package boundary or workflow changes.

## Alternatives

- **Dim only refused targets and show a mismatch after the drop:** hides LA-29's error until it is made.
- **A full apply per target:** reprint, reparse and LA-13 per port is too slow for large workflows.
- **React Flow's own edge selection with `onBeforeDelete`:** changes the F-206 assertions.
- **A dash pattern for mismatch:** dashes already mean value channels (ADR 0046).
- **Leave tuple arity to F-504:** connections made on the canvas would fail at run time with no warning.
