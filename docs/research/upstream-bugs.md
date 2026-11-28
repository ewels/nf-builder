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
| 11 | nf-lang formatter | `lint -format` drops a directive's parentheses when a comment wraps its arguments, so the result fails lint | F-110 | no |
| 12 | Nextflow lint | An invalid registry module reference aborts lint instead of giving a diagnostic at the include | F-105 plan | no |
| 13 | Nextflow lint | A registry module missing `meta.yml` aborts lint ("corrupted") instead of giving a diagnostic | F-105 plan | no |
| 14 | nf-lang config resolver | `includeConfig` of a directory passes lint; `nextflow run` then fails to parse the config | F-105 plan | no |
| 15 | Nextflow lint | Lint downloads a missing registry module into the project even with `NXF_OFFLINE=true` (may be intended) | F-105 plan | no |
| 16 | nf-lang lexer | A stray top-level `}`, `)` or `]` is silently accepted by lint and run | F-104 review | no |
| 17 | Nextflow registry | `nf-core/tiara/tiara` returns HTTP 500 on its module and releases endpoints | F-501 plan | no |
| 18 | Nextflow registry | Module metadata lists outputs in a different order from `meta.yml` and `main.nf` | F-501 plan | no |
| 19 | Nextflow registry | `nf-core/fasta_clean_faidx` is listed as a process but declares a workflow; `nextflow-io/hello` has no `componentName` | F-501 plan | no |
| 20 | nf-lang lint | A legacy process before `nextflow.enable.types = true` and a typed one after it in the same script pass lint and run, although the docs say a script can't mix them | F-111 plan | no |
| 21 | Nextflow registry | The download endpoint for `nf-core/cooler/digest` 0.0.0-6d1763b returns HTTP 401 | F-501 live build | no |
| 22 | nf-lang lint | Errors on a bare variable that is an `if` condition or the only index in `x[i]` point one column early, at the `(` or `[` | F-108 | no |
| 23 | nf-lang formatter | `lint -format` re-indents multi-line string content, changing the string's value | F-111 | no |

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

```nextflow
def paths() {
    def a = file(
        'a',
        'b',
        checkIfExists: true
    )
    def b = file(
        'c', // the path
        checkIfExists: true // checked
    )
    return [a, b]
}
```

- **What happens:** `lint -format` prints `'b',,` (a double comma) and `'c' // the path,` (the comma inside the comment). Neither result parses. `Formatter.arguments` appends `,` after the positional arguments even when `positionalArgs` has already written a trailing comma or a trailing comment.
- **Expected:** one comma, before any trailing comment.
- **nf-builder:** prints valid code; known difference `named-args-comma` (F-110, fixture `packages/lang-2610/test/printer/input/known/named-args.nf`).

### 8. Lint doesn't check a legacy tuple input's arity from typed code

From spike S1 ([report](2026-11-22-spike-s1-typed-legacy-interop.md), oracle case `s1-typed-legacy-tuple-arity`): typed code passing a one-component `tuple([id: x])` to a legacy process whose input is a two-component `tuple` passes `nextflow lint`; `nextflow run` then fails with "Input tuple does not match tuple declaration in process `LEGACY_COUNT`".

- **Expected:** lint reports the arity mismatch.
- **nf-builder:** the connection check compares arity itself (F-302).

### 9. `nextflow.preview.recursion` is undocumented

nf-lang 26.10 models the `nextflow.preview.recursion` feature flag, but `docs/reference/feature-flags.mdx` at the pinned commit doesn't list it (spike S2, [report](2026-11-22-spike-s2-parser.md)).

### 10. `groupBy` is missing from the legacy operator docs

`groupBy` is documented as a typed operator (`docs/reference/stdlib-types/channel.mdx:72`) but not in the legacy `docs/reference/operator.mdx` (spike S2). Worth checking whether it is meant to be typed-only and, if so, saying so.

### 11. The formatter drops a directive's parentheses around a comment

```nextflow
process HELLO {
    memory(
        // enough for the index
        2.GB
    )

    script:
    """
    echo hello
    """
}
```

- **What happens:** the input passes `nextflow lint`; `lint -format` prints `memory`, the comment and `2.GB` on separate lines without the parentheses, plus a whitespace-only line, and the result fails lint.
- **Expected:** keep the parentheses when the arguments wrap.
- **nf-builder:** keeps them; known difference `directive-comment` (F-110).

### 12. An invalid module reference aborts lint

```nextflow
include { X } from 'Bad'

workflow {
    X()
}
```

- **What happens:** `nextflow lint .` stops with `ERROR ~ Failed to resolve remote module Bad: Invalid module reference: 'Bad'. Expected format: ...` and lints nothing else.
- **Expected:** an error diagnostic at the include (1:1) with that message, and the rest of the project linted.
- **nf-builder:** reports nf-lang's `ModuleReference` message at the include (F-105).

### 13. A registry module without `meta.yml` aborts lint

`main.nf`:

```nextflow
include { NOMETA } from 'nf-core/nometa'

workflow {
    NOMETA()
}
```

with `modules/nf-core/nometa/main.nf` holding a process `NOMETA` and no `meta.yml`.

- **What happens:** lint stops with `ERROR ~ Failed to resolve remote module nf-core/nometa: Module nf-core/nometa is corrupted (missing required files). Please remove and reinstall.`
- **Expected:** a diagnostic at the include naming the missing `meta.yml`.
- **nf-builder:** reports one (F-105).

### 14. `includeConfig` of a directory passes lint but fails at run time

`nextflow.config`: `includeConfig 'conf/sub'`, where `conf/sub/` is a directory; `main.nf` has `workflow { println('hi') }`.

- **What happens:** `nextflow lint .` reports no errors; `nextflow run main.nf` fails with `ERROR ~ Unable to parse config file: '.../nextflow.config'`.
- **Expected:** lint reports "Invalid include source" for a target that isn't a file (`config/control/ResolveIncludeVisitor.java` checks existence only).
- **nf-builder:** treats a directory as a missing target (F-105).

### 15. Lint installs a missing registry module even when offline

`main.nf`: `include { FASTQC } from 'nf-core/fastqc'` and a workflow calling it, with no `modules/` directory.

- **What happens:** with `NXF_OFFLINE=true`, `nextflow lint .` downloads the module into `modules/nf-core/fastqc/` and reports only a warning. Linting changes the project, and the offline setting is ignored.
- **Expected:** possibly intended (lint resolves modules as `run` does), but offline mode should not reach the registry, and a read-only check arguably shouldn't write files. Raise as a question rather than a bug.
- **nf-builder:** reports a missing registry module as a diagnostic naming `modules/nf-core/fastqc/main.nf` (F-105).

### 16. A stray closing brace is silently accepted

```nextflow
workflow {
    println('hi')
}
}
```

- **What happens:** `nextflow lint .` reports no errors and `nextflow run main.nf` succeeds. The last `}` pops a lexer mode with nothing left to pop (`ScriptLexer.g4` L737); the ANTLR runtime's empty-stack exception is not reported as a syntax error.
- **Expected:** a syntax error at 4:1 (`Unexpected input: '}'`), as for any other unexpected token.
- **Also:** several stray closers are accepted, `)` and `]` behave the same, errors after a stray closer are reported at the same positions as without it, and a config file behaves the same.
- **nf-builder:** drops the stray token as upstream does, so lint-clean files stay fully modelled (F-104).

### 17. A registry module that always fails

- **What happens:** on 2026-11-22, `GET https://registry.nextflow.io/api/v1/modules/nf-core%2Ftiara%2Ftiara` and its `/releases` endpoint return HTTP 500 on every attempt; the other 2,321 modules respond.
- **Expected:** the module's details, or a 404 if it shouldn't be listed.
- **nf-builder:** the snapshot build keeps the previous entry or leaves the module out and reports it (F-501).

### 18. Registry output order differs from `meta.yml`

- **What happens:** for `nf-core/fastqc` the registry's `metadata.output` lists `zip, html, versions_fastqc`; the module's `meta.yml` and `main.nf` list `html, zip, versions_fastqc`. The order is the same across endpoints, so it looks like a map sorted or re-keyed on the server.
- **Expected:** outputs in `meta.yml` order, which is the process's emit order and what users see.
- **nf-builder:** reorders outputs by the bundle's `meta.yml` (F-501).

### 19. Registry metadata disagrees with the module source

- **What happens:** `nf-core/fasta_clean_faidx` is listed with `kind: Process`, but its `main.nf` declares a workflow; `nextflow-io/hello` has no `metadata.componentName`, although its `main.nf` declares process `HELLO`.
- **Expected:** `kind` and `componentName` that match `main.nf`.
- **nf-builder:** takes kind and component from the parsed `main.nf` and reports disagreements (F-501).

### 20. Typed and legacy processes can be mixed in one script by position

```nextflow
process LEGACY_GOODBYE {
    input:
    val x

    script:
    """
    echo goodbye ${x}
    """

    stub:
    """
    echo goodbye ${x}
    """
}

nextflow.enable.types = true

process TYPED_HELLO {
    input:
    x: String

    script:
    """
    echo hello ${x}
    """

    stub:
    """
    echo hello ${x}
    """
}

workflow {
    LEGACY_GOODBYE(channel.of('a'))
    TYPED_HELLO('b')
}
```

- **What happens:** `nextflow lint .` reports no errors and `nextflow run main.nf -stub` runs both processes. The typed/legacy split depends on where the feature flag appears; lint only rejects a legacy definition after the flag or a typed one without it.
- **Expected:** the static-types docs (`docs/static-typing.mdx` L50 at the pinned commit) say a script can't mix typed and legacy definitions, so lint should report the legacy process here, or the docs should describe the positional rule.
- **nf-builder:** refuses edits that would mix the two in one script (LA-13, F-111), and keeps scripts that are already mixed editable.
- **Reproducer:** the oracle case `f111-mixed-after-flag` (added with F-111) records this file.

### 21. A registry bundle that can't be downloaded

- **What happens:** on 2026-11-22, `GET https://registry.nextflow.io/api/v1/modules/nf-core%2Fcooler%2Fdigest/0.0.0-6d1763b/download` returned HTTP 401, while the module's details endpoint and every other module's download worked anonymously.
- **Expected:** a redirect to the bundle, as for the other 2,320 modules.
- **nf-builder:** the snapshot build reports it and leaves the module out (F-501).

### 22. Some variable errors point at the delimiter, one column early

```nextflow
workflow {
    if (flag) {
        println('x')
    }
    xs = [1, 2]
    println(xs[idx])
    println(other)
}
```

- **What happens:** `nextflow lint -o json .` reports "`flag` is not defined" at 2:8 (the `(`; `flag` starts at 2:9) and "`idx` is not defined" at 6:15 (the `[`; `idx` starts at 6:16). "`other` is not defined" is at 7:13, which is right.
- **Expected:** the position of the variable itself. The parenthesised condition and the index expression seem to take the position of their enclosing delimiter.
- **nf-builder:** reports the variable's own position; the F-108 free-variable oracle test allows for the one-column difference in these two shapes.

### 23. The formatter changes the value of multi-line strings

```nextflow
workflow {
        msg = """
  first
    second
"""
    println(msg)
}
```

- **What happens:** `nextflow run main.nf` prints `  first` and `    second`. After `nextflow lint -format .`, the string's lines are re-indented (here to column 1, losing even their relative indentation), and the same run prints `first` and `second`. Formatting changed what the program does.
- **Expected:** the formatter leaves string content alone, or re-indents only strings whose value can't change (for example those passed through `stripIndent()` or `stripMargin()`).
- **nf-builder:** the printer keeps multi-line string content verbatim, a known difference `string-reindent` (ADR 0039, amending ADR 0032), so reprinting a declaration never changes a string's value.

### 24. Lint accepts a process called twice in one workflow

```nextflow
nextflow.enable.types = true

process HELLO {
    input:
    x: String

    output:
    y: String = x

    script:
    """
    echo ${x}
    """
}

workflow {
    a = HELLO('one')
    b = HELLO('two')
    a.view()
    b.view()
}
```

- **What happens:** `nextflow lint .` reports no errors. `nextflow run main.nf -stub` fails with "Process 'HELLO' was called twice -- include it with a different alias or call it in a different workflow".
- **Expected:** lint reports the second call, as it reports other errors the runtime would raise.
- **nf-builder:** AddCall refuses a second call of the same callee in one workflow (F-111, ADR 0039), and F-112 can report it in imported code.

### 25. The config formatter drops the type of a closure parameter

`nextflow.config`:

```nextflow
process {
    ext.args = {
        'a b'.split(' ').collect { String token -> token }
    }
}
```

- **What happens:** `nextflow lint -format .` (26.10.7) rewrites the closure to `{ token -> token }`. In a script the formatter keeps a closure parameter's type.
- **Expected:** the type stays, or the formatter says why a config closure differs from a script one.
- **nf-builder:** the config printer keeps the type (as `token: String`, the form it prints in scripts). Three rnaseq configs differ for this reason alone, listed in `packages/lang-2610/test/corpus/known-config-format-differences.json` (F-601, ADR 0032).
