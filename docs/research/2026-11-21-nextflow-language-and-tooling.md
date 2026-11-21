# Nextflow language, registry and tooling: state on 2026-11-21

Research that the first ADRs rest on. Facts are dated; re-check anything marked **verify** before building on it.

## Language

- Latest stable line is **26.10** (26.10.5 released 2 Nov 2026). Static typing left preview in 26.10. Typed processes and workflows need `nextflow.enable.types = true` in each script that uses them. The `params` and `output` blocks work without the flag.
- The flag is **per script**: Nextflow's own announcement for 26.04 describes adopting static typing "one file at a time". A script with the flag set **cannot also contain legacy process or workflow definitions**.
- 26.10 adds typed `params`/`output` blocks that act as `take:`/`emit:` when a pipeline is included, pipeline composition (`include { workflow as X }`), workflow modules, and a preview `agent` block.
- Deprecated in 26.10: process `when:` and `storeDir`. Removed: `echo` directive. Deprecated under strict syntax: `Channel.` (use `channel.`), implicit `it`, `shell:`.
- The strict parser has been the default since 26.04. `NXF_SYNTAX_PARSER=v1` falls back to the legacy parser. Strict syntax drops `import`, classes, `for`/`while`, `switch`, spread, dollar-slashy strings, assignments inside expressions and `addParams`. Code needing full Groovy belongs in `lib/` or a plugin.
- Typed workflows restrict some legacy idioms: `.out` access, `|`/`&` composition, `set`/`tap`. Only a core subset of operators is recommended under static typing (for example, `mix` takes one argument at a time).
- nf-core module guidance (published 18 Nov 2026) recommends at least 26.10.4 when typed functions return records (resume hashing), and at least 26.10.6 when using the `stage` block. **Verify** 26.10.6 is released before using it as the default floor.

## Legacy code in the wild

- Every nf-core module is synced to the Nextflow registry under the `nf-core` namespace.
- On 2026-11-21, `nf-core/fastqc`, `multiqc`, `star/align` and `samtools/sort` on nf-core/modules `master` were all **legacy DSL2**: `tuple val(meta), path(...)` inputs, `emit:` outputs, `when:` sections.
- nf-core's typed module conventions were published on 18 Nov 2026. Each module takes one input record and emits one output record. `meta` becomes `meta: Record?`. Tool arguments become `<tool>_args` fields. Versions go to the `versions` topic as a record. No migration timeline was given, so expect a mixed registry through 2027.
- Most pipelines on GitHub are legacy DSL2. Some will not parse under strict syntax at all.
- **Verify:** whether a typed workflow (flag on) may call a legacy process `include`d from another file. The docs say operators work in both styles, and the operator migration guide contrasts how typed and legacy processes handle missing optional outputs, which implies mixing across files. Neither page says so outright. Settle it with a real Nextflow run (M0 spike S1).

## Registry

- The registry at `registry.nextflow.io` hosts plugins, modules and pipelines. The module-system ADR in the Nextflow repo lists these endpoints. **Verify** them against `https://registry.nextflow.io/openapi/`:
  - `GET /api/v1/plugins`, `/api/v1/plugins/{id}`, `/api/v1/plugins/{id}/{version}`
  - `GET /api/modules?query=`, `/api/modules/{name}`, `/api/modules/{name}/releases`, `/api/modules/{name}/{version}`, `/api/modules/{name}/{version}/download`
- Module bundles contain `main.nf`, `meta.yml` and `README.md`. Installed modules live under `modules/<namespace>/<name>/` with a `.module-info` file recording checksum and registry URL. Scripts include them by name: `include { FASTQC } from 'nf-core/fastqc'`.
- `meta.yml` has `input`/`output` specs, so ports can be drawn without fetching code.
- Each plugin release has a **plugin spec** (JSON) listing its `ConfigScope`, `Function`, `Factory` and `Operator` definitions, stored by the registry. That is enough to add plugin functions and operators to the palette and plugin config scopes to the config editor.
- **Verify:** whether the registry sends CORS headers. The workspace used for this research could not reach the host from a shell.

## Language server

- `nextflow-io/language-server` is Java/Groovy. It provides diagnostics, formatting, hover, completion, rename, DAG preview and a "Convert script to static types" command. Its version follows Nextflow's.
- Releases ship `language-server-all.jar` (about 10 MB, targets Java 17), plus standalone bundles with their own Java runtime for Linux x64/arm64 and macOS arm64. The VS Code extension downloads the bundle where one exists. It is a jlink-style runtime, not a native binary, so there is nothing to run directly in a browser.
- The jar contains `spec/definitions.json` (about 110 KB). It holds the **core config spec**: 31 top-level config scopes with descriptions and option types. Script-side definitions (directives, operators, types, feature flags) live as annotated classes in `nextflow.script.dsl` and `nextflow.script.types`.
- Running it in the browser:
  - **CheerpJ** is a WebAssembly JVM. It added Java 17 support (preview) in 4.1 and is free for FOSS projects. This is the most plausible route. Unknowns: start-up time, memory, and whether Groovy's runtime class generation works.
  - **TeaVM** is unsuitable: Groovy relies on reflection and runtime bytecode generation.
  - **GraalVM WebAssembly** output is experimental and closed-world. Not viable now.
- Conclusion: worth a time-boxed spike (S3). The app must not depend on it.

## Agent-built projects

- Keep `AGENTS.md` short and specific: exact commands, generated paths, dependency rules, approval boundaries, definition of done. Leave out directory tours and generic advice. Evidence: Gloaguen et al. (arXiv:2602.11988) found that developer-written context files beat LLM-generated ones and that overviews did not help. The AAIF guidance (Aug 2026) says the same.
- Claude Code reads `CLAUDE.md`, so add a one-line `CLAUDE.md` containing `@AGENTS.md`.
- Anthropic's long-running harness pattern:
  - a JSON feature list where agents may only flip `passes`;
  - a progress log;
  - a start-up routine (read log, pick one feature, run the smoke test);
  - one feature per session;
  - end-to-end checks in a real browser before marking anything done.
- Harness engineering (Böckeler/Fowler) splits controls into **guides** (docs, skills) and **sensors** (tests, linters, structural checks). Lint messages should say how to fix the problem. Architecture boundaries should be enforced by tools, not prose.
- Specs: three-tier boundaries (always / ask first / never). Small tasks with acceptance criteria. Conformance suites for contract behaviour. Load only the relevant slice of the spec per task.
- Nextflow-specific agent skills (pipeline creation, module use, migration) live in `seqeralabs/nextflow-plugin`, previously `nextflow-io/agent-skills`.

## Sources

- [Migrating to 26.10](https://docs.seqera.io/nextflow/migrations/26-10), [Migrating to 26.04](https://docs.seqera.io/nextflow/migrations/26-04)
- [Static typing](https://docs.seqera.io/nextflow/static-typing), [Typed processes](https://docs.seqera.io/nextflow/process-typed), [Typed workflows](https://docs.seqera.io/nextflow/workflow-typed), [Operators with static typing](https://docs.seqera.io/nextflow/tutorials/static-types-operators)
- [Strict syntax](https://docs.seqera.io/nextflow/strict-syntax), [Syntax reference](https://docs.seqera.io/nextflow/reference/syntax)
- [Module registry](https://docs.seqera.io/nextflow/modules/module-registry), [Using modules](https://docs.seqera.io/nextflow/modules/using-modules)
- [Nextflow ADR: module system](https://github.com/nextflow-io/nextflow/blob/master/docs/adr/20251114-module-system.md), [Nextflow ADR: plugin spec](https://github.com/nextflow-io/nextflow/blob/master/docs/adr/20250922-plugin-spec.md)
- [nf-lang ANTLR grammars](https://github.com/nextflow-io/nextflow/tree/master/modules/nf-lang/src/main/antlr)
- [nf-core: types and records](https://nf-co.re/blog/2026/types-and-records/)
- [Nextflow language server](https://github.com/nextflow-io/language-server), [VS Code extension](https://github.com/nextflow-io/vscode-language-nextflow)
- [CheerpJ 4.1 (Java 17 preview)](https://labs.leaningtech.com/blog/cheerpj-4.1.html)
- [Writing an effective AGENTS.md (AAIF)](https://aaif.io/blog/writing-an-effective-agents-md), [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988)
- [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness engineering (Böckeler, Fowler)](https://martinfowler.com/articles/harness-engineering.html)
- [How to write a good spec for AI agents (Osmani)](https://addyosmani.com/blog/good-spec/)
- [seqeralabs/nextflow-plugin](https://github.com/seqeralabs/nextflow-plugin)
