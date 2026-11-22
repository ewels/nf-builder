# 0032. Print as `nextflow lint -format` does, except where its output is broken

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0005 says the app "emits what `nextflow lint -format` would", and LA-45 says code is formatted as `nextflow lint -format` would. F-110 ports nf-lang 26.10.7's formatter (`Formatter`, `ScriptFormattingVisitor`) line by line and checks it against Nextflow on fixtures and on 342 corpus scripts. In five cases Nextflow's own formatter produces code that fails `nextflow lint`, changes meaning, or isn't stable when formatted again (`docs/research/upstream-bugs.md`, entries 4 to 7 and 11). Edit commands (F-111) also create nodes that were never parsed, which ADR 0027's "every node has a range that slices back" can't cover, and upstream doesn't say where blank lines go between declarations it never saw. Research: the [F-110 plan](https://github.com/ewels/nf-builder/blob/a58f44b/docs/plan/handoff/plan-F-110.md).

## Decision

- **Parity, with five known differences.** The printer's output equals `nextflow lint -format` (default options: four spaces, no Harshil alignment, no sorting) except in these cases, where it prints valid, stable code instead:
  - `type-rename`: type names are printed as written, not normalised through the Java class hierarchy (`ArrayList` stays `ArrayList`, `Long` stays `Long`);
  - `catch-package`: a `catch` type keeps its package unless the class is default-imported;
  - `call-wrap`: a call on a call's result (`f(1)(2)`) is not wrapped because of the synthetic `call` method's missing position;
  - `named-args-comma`: one comma between positional and named arguments, before any trailing comment;
  - `directive-comment`: a directive keeps its parentheses when a comment wraps its arguments.
  Each has a fixture whose `formatted/` file records Nextflow's output and whose `printed/` file records ours; the oracle notices if upstream fixes one. The corpus test lists the corpus files that hit one (`known-format-differences.json`); any other difference fails.
- **Nodes an edit creates carry `NO_RANGE`** (`{start: -1, ..., line: -1}`, nf-lang's line -1) until the file is re-parsed. This amends ADR 0027's range rule for unparsed nodes only. The printer gives them the fresh layout.
- **Fresh layout:** one blank line between top-level declarations, none inside an include run or a feature-flag run, and none elsewhere inside a new declaration.
- **Oracle:** `pnpm oracle` formats the printer fixtures with `nextflow lint -format` and checks two things per tree: Nextflow's output equals the committed `formatted*/` goldens, and the printer's output (`formatted/` with `printed/` laid over it) is a lint-clean fixed point. Only files with a known difference may be rewritten in the fixed-point pass. `pnpm oracle --write-format` regenerates the goldens. This sits within ADR 0019.
- The printer stays off the pack entry; the parser's lazy loader (F-104) carries it.

## Consequences

- Code the app writes passes lint and is a fixed point under the official formatter, which is what ADR 0005 wants. Files that hit a known difference are rare (7 of 342 corpus scripts, all `type-rename` or `catch-package`), and Nextflow would rewrite them if the user ran `lint -format` themselves.
- Each known difference can be dropped when upstream fixes it: the oracle's format row for its fixture fails, and the entry is removed.
- New upstream formatter bugs are added the same way, with a fixture and an entry in `docs/research/upstream-bugs.md`.

## Alternatives

- Full parity, including the bugs: the app would write code that fails lint or changes meaning.
- Port `Types.normalize` with a class-hierarchy table: same outcome as full parity for `type-rename`.
- No blank lines in synthesised declarations (upstream's literal behaviour): F-111 would have to splice blank lines itself.
