# Upstream bugs

Bugs and doc gaps found in Nextflow, nf-lang, the language server or the Nextflow docs while building nf-builder, kept so the maintainer can file them upstream. Every entry was reproduced with the pinned release (`packages/lang-2610/upstream.json`: Nextflow 26.10.7, commit `0ad848ef`) unless it says otherwise.

To add one: give it the next number, a minimal reproducer that runs as written, what happens, what should happen, the upstream source line where known, and how nf-builder handles it. Set **Filed** to the issue link once it exists.

To reproduce with the pinned dist: `NXF_OFFLINE=true .cache/nextflow/26.10.7/nextflow-26.10.7-dist lint .` (or `lint -format .`) in a directory holding the file.

## Summary

| # | Component | Bug | Found in | Filed |
|---|---|---|---|---|
| 1 | nf-lang `ScriptAstBuilder` | `nextflow lint` crashes on a legacy `params.x =` assignment when typed syntax is enabled | F-102 | no |
| 2 | nf-lang `ScriptAstBuilder` | "Typed output is not allowed in legacy workflow" is reported at -1:-1 | F-102 | no |
| 3 | nf-lang `ScriptAstBuilder` | "Named workflow cannot have an onError section" is reported at -1:-1 | F-102 | no |
| 4 | nf-lang formatter | `lint -format` renames types (`new ArrayList<String>()` becomes `new List<String>()`, `Long` becomes `Integer`) | F-110 plan | no |
| 5 | nf-lang formatter | `lint -format` drops the package from `catch` types, so the result fails lint | F-110 plan | no |
| 6 | nf-lang formatter | `lint -format` prints `adder(1)(2)` as a wrapped `adder(1).call(...)`, and a second pass changes it again | F-110 plan | no |
| 7 | nf-lang formatter | `lint -format` prints a double comma, or a comma inside a comment, before named arguments | F-110 | no |
| 8 | nf-lang lint | Lint doesn't check the arity of a legacy tuple input called from typed code; the run fails instead | F-005 (spike S1) | no |
| 9 | Nextflow docs | `nextflow.preview.recursion` is modelled by nf-lang but missing from `feature-flags.mdx` | F-006 (spike S2) | no |
| 10 | Nextflow docs | `groupBy` is documented as a typed operator but missing from the legacy `operator.mdx` | F-006 (spike S2) | no |

## Details

### 1. Lint crashes on a legacy parameter with typed syntax enabled

```nextflow
nextflow.enable.types = true

params.input = 'x'
```

- **What happens:** `nextflow lint .` prints `ERROR ~ Cannot read field "value" because "node" is null` and stops.
- **Expected:** the builder's own error at 3:1, "Legacy parameter is not allowed with `nextflow.enable.types = true` -- use the `params` block instead" (`ScriptAstBuilder.java#L446`).
- **nf-builder:** reports the expected message at 3:1 (`packages/lang-2610/test/ast/errors.test.ts`); the input is kept out of the oracle-linted inputs because lint crashes on it.

### 2. Typed workflow output error at -1:-1

```nextflow
workflow hello {
    main:
    x = channel.of('a')

    emit:
    x: Channel<String>
}
```

- **What happens:** lint reports "Typed output is not allowed in legacy workflow -- set `nextflow.enable.types = true` to use typed workflows in this script" at -1:-1.
- **Cause:** the emit is passed to the error before it is given a position (`ScriptAstBuilder.java#L1015-L1022`).
- **Expected:** the error at the emit, 6:5.
- **nf-builder:** reports it at the emit (`packages/lang-2610/test/ast/errors.json`, `workflow-legacy-typed-emit.nf`).

### 3. Named workflow onError error at -1:-1

```nextflow
workflow hello {
    main:
    println 'hello'

    onError:
    println 'failed'
}
```

- **What happens:** lint reports "Named workflow cannot have an onError section" at -1:-1.
- **Cause:** the `onComplete` block is passed instead of `onError` (`ScriptAstBuilder.java#L942`); with no `onComplete` it has no position.
- **Expected:** the error at the first `onError` statement, 6:5, as for `publish:` and `onComplete:`.
- **nf-builder:** reports it there (`errors.json`, `workflow-named-onerror.nf`).

### 4. The formatter renames types

```nextflow
def f() {
    def xs = new ArrayList<String>()
    def big = Long.MAX_VALUE
    def d = Double.parseDouble('1.0')
    return [xs, big, d]
}
```

- **What happens:** `lint -format` prints `new List<String>()` (which then fails lint: "`java.util.List` is an abstract type and cannot be constructed directly"), `Integer.MAX_VALUE` and `Float.parseDouble('1.0')`. It prints resolved types through `Types.getName`, which normalises them through the Java class hierarchy: `int` and `Long` become `Integer`, `Double` becomes `Float`, `ArrayList` becomes `List`, `LinkedHashMap` becomes `Map`, `Tuple2<A,B>` becomes `List<A, B>`. This applies to annotations, `new`, casts, `instanceof` and class receivers.
- **Why it matters:** some results fail lint (`new List<String>()`; nf-core/rnaseq `subworkflows/local/multiqc_rnaseq/main.nf` L472-L473 with `new LinkedHashMap(...)`), and some pass lint but change meaning (`Long.MAX_VALUE` to `Integer.MAX_VALUE`). Type annotations are not erased at run time: a function parameter typed `TreeMap` rejects a `LinkedHashMap` argument, so renaming an annotation can change behaviour.
- **Expected:** type names printed as written.
- **nf-builder:** prints type names as written; known difference `type-rename` (F-110).

### 5. The formatter drops the package from catch types

```nextflow
def f() {
    try {
        println 'x'
    }
    catch (java.nio.file.AccessDeniedException e) {
        println 'denied'
    }
}
```

- **What happens:** `lint -format` prints `catch (e: AccessDeniedException)` (via `getNameWithoutPackage()`), which fails lint: "`AccessDeniedException` is not defined".
- **Expected:** keep the package unless the class is default-imported.
- **nf-builder:** keeps it; known difference `catch-package` (F-110).

### 6. The formatter wraps a call on a call's result, and isn't idempotent

```nextflow
def adder(x) {
    return { y -> x + y }
}

workflow {
    println adder(1)(2)
}
```

- **What happens:** the first `lint -format` pass prints `println(adder(1).call(` with `2` on its own line and `))` on the next. The synthetic `call` method has no position (line -1 is less than the arguments' last line), so the formatter wraps it. A second pass changes the text again: it wraps the outer `println(` argument as well. (On its own, `return f(1)(2)` is wrapped the same way but is stable on the second pass.)
- **Expected:** `println(adder(1).call(2))` on one line, and formatting twice gives the same text.
- **nf-builder:** prints `adder(1).call(2)`; known difference `call-wrap` (F-110, fixture `packages/lang-2610/test/ast/fixtures/expr-call-value.nf`).

### 7. The formatter's comma before named arguments

Two shapes, both from `Formatter.arguments` appending `,` after the positional arguments even when `positionalArgs` has already added a trailing comma or a trailing comment:

- two or more wrapped positional arguments followed by a named argument print `'b',,` (a double comma, invalid code);
- a single positional argument with a trailing end-of-line comment, followed by a named argument, prints `'a' // one,`, which puts the comma inside the comment and breaks the code.

- **Expected:** one comma, before any trailing comment.
- **nf-builder:** prints valid code; known difference `named-args-comma` (F-110). The exact reproducer is the F-110 fixture `packages/lang-2610/test/printer/input/known/` (added with F-110).

### 8. Lint doesn't check a legacy tuple input's arity from typed code

From spike S1 ([report](2026-11-22-spike-s1-typed-legacy-interop.md), oracle case `s1-typed-legacy-tuple-arity`): typed code passing a one-component `tuple([id: x])` to a legacy process whose input is a two-component `tuple` passes `nextflow lint`; `nextflow run` then fails with "Input tuple does not match tuple declaration in process `LEGACY_COUNT`".

- **Expected:** lint reports the arity mismatch.
- **nf-builder:** the connection check compares arity itself (F-302).

### 9. `nextflow.preview.recursion` is undocumented

nf-lang 26.10 models the `nextflow.preview.recursion` feature flag, but `docs/reference/feature-flags.mdx` at the pinned commit doesn't list it (spike S2, [report](2026-11-22-spike-s2-parser.md)).

### 10. `groupBy` is missing from the legacy operator docs

`groupBy` is documented as a typed operator (`docs/reference/stdlib-types/channel.mdx:72`) but not in the legacy `docs/reference/operator.mdx` (spike S2). Worth checking whether it is meant to be typed-only and, if so, saying so.
