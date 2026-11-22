# 0007. Typed by default; legacy code accepted and editable

- Status: Accepted
- Date: 2026-11-21

## Context

Static typing is stable in 26.10, and it is where Nextflow and nf-core are heading. But registry modules and most pipelines are still legacy DSL2, and nf-core's typed module conventions only appeared on 18 Nov 2026. Nextflow allows typed and legacy code in one pipeline, but not in one script. See [research](../research/2026-11-21-nextflow-language-and-tooling.md).

## Decision

**New code is modern:**
- The palette offers only modern constructs.
- Templates are typed.
- A new process or workflow goes in its own file with `nextflow.enable.types = true`. That way it never lands in a legacy script.

**Legacy code works:**
- Imports and legacy registry modules load as they are.
- They are fully editable, including qualifier-based Configure forms.
- Nothing is migrated without the user asking.

**Nudges:**
- Suggestion-level lints flag legacy patterns.
- "Migrate to typed" shows a diff and applies only on confirmation.

**Badges:** typed processes and workflows carry a small `typed` badge, and so do typed registry modules. No badge means legacy.

**To verify:** whether a typed workflow may call a legacy process from another file. This is spike S1, before M3. If not, inserting a legacy module into a typed workflow needs another route, and this ADR gets updated.

## Consequences

- The registry and real pipelines are usable from day one.
- Two process syntaxes to support in the engine and the forms.
- Once typed code is the norm, the badge will be everywhere. Revisit then.

## Alternatives

- Typed only: the registry would be nearly empty, and most imports would fail.
- Migrate automatically on import: surprising, lossy, and detaches modules from upstream.
- `legacy` badge instead: marks most nodes today, and reads as a judgement.

## Spike result

2026-11-22, spike S1 ([report](../research/2026-11-22-spike-s1-typed-legacy-interop.md)), Nextflow 26.10.7 through the oracle (ADR 0019): a typed workflow may call a legacy process or workflow included from another file, including an nf-core-shaped module whose named outputs it reads by assignment, and a legacy workflow may call a typed process. `nextflow lint` and `nextflow run -stub` pass in both directions. One constraint: typed code must build a legacy `tuple` input with `tuple(...)`; a list literal with mixed element types (`[[id: x], file]`) fails `nextflow lint` ("List expression has inconsistent element types"), while `nextflow run` only warns. Lint doesn't check a legacy input's shape, so a wrong arity fails only at run time. A script that enables types and defines a legacy process fails to parse, and so does a typed process without the flag, as this decision assumed. The decision stands: inserting a legacy module into a typed workflow needs no other route, and LA-14 drops its interim warning.
