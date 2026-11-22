# 0027. Share AST conventions across scripts and configs, and attach comments as nf-lang does

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

F-102 (script AST) and F-103 (config AST) build our own typed trees from the generated parse trees (AR-02). Both need source ranges that slice back to exact text, comments that the printer can put back (F-110), and the same error positions as `nextflow lint`. nf-lang counts columns in code points (it reads input with `CharStreams.fromReader`), while JavaScript strings slice in UTF-16 units. AR-02 says comments attach to the following node, but nf-lang's `CommentAttacher`, which `nextflow lint -format` prints from, attaches leading, trailing and dangling comments. The two grammars share their expression rules. Research: the [F-102 plan](https://github.com/ewels/nf-builder/blob/a58f44b/docs/plan/handoff/plan-F-102.md), the [F-103 plan](https://github.com/ewels/nf-builder/blob/a58f44b/docs/plan/handoff/plan-F-103.md) and [spike S2 report](../research/2026-11-22-spike-s2-parser.md).

## Decision

- **Types:** the AST types, ranges, comments and a walker live in `@nf-builder/lang-core` (`src/ast/`), imported by packs and the engine. Builders live in each pack (`packages/lang-2610/src/ast/`), ported from nf-lang's `ScriptAstBuilder` and `ConfigAstBuilder` with upstream line references. The AST is in-memory only; it is not a stored or exported format.
- **Ranges:** half-open `{ start, end, line, column, endLine, endColumn }`, where `start` and `end` count UTF-16 units (so `text.slice(start, end)` is the node's source) and lines and columns count from 1, columns in code points (as `nextflow lint` reports). Every node has one; a test checks that each node's slice re-parses to the same node, over fixtures in `pnpm check` and over the corpus in `pnpm test:corpus`.
- **Comments:** each node carries `leadingComments`, `trailingComments` and `danglingComments`, attached by a port of nf-lang's `CommentAttacher`; the file root also keeps every comment in order. This amends AR-02's "attached to the following node".
- **Expressions:** one expression builder serves both grammars where their rules match, so scripts and configs get the same expression nodes.
- **Errors:** the builders report every error nf-lang's AST builders raise, at the same position and with the same message; name and type resolution and warnings stay with F-112. Where `nextflow lint` prints an error at `-1:-1` (an upstream bug), we report the node's real position. Builders keep going after an error and return a partial AST plus all errors.
- **Bundle:** the parser and builders stay off the pack entry until the engine worker loads them (F-104, F-113), so they never enter the initial bundle.

## Consequences

- The printer, projection and diagnostics all share one tree shape and one notion of position.
- Comment placement can be checked against nf-lang's own attacher, which the pinned Nextflow jar contains.

## Alternatives

- Comments attached only to the following node (AR-02 as written): loses trailing and end-of-block comments that `nextflow lint -format` keeps.
- Code-unit columns: positions would disagree with `nextflow lint` on lines with characters outside the Basic Multilingual Plane.
- Separate AST type packages per pack: duplicate types the engine has to handle twice.
