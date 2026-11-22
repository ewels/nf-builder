# Architecture decision records

Process: [0001](0001-record-decisions-as-adrs.md). Template: [template.md](template.md). Until the first code is merged, ADRs are rewritten in place; after that, superseded.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-decisions-as-adrs.md) | Record decisions as ADRs | Accepted |
| [0002](0002-browser-only-app.md) | Browser-only static app, projects stored in IndexedDB | Accepted |
| [0003](0003-stack-and-repo-layout.md) | TypeScript and React in a pnpm monorepo with tool-enforced boundaries | Accepted |
| [0004](0004-files-are-the-source-of-truth.md) | Files are the source of truth, and code is never lost | Accepted |
| [0005](0005-use-nextflows-own-sources.md) | Use Nextflow's own grammar, definitions and formatter | Accepted |
| [0006](0006-language-packs-per-version.md) | One language pack per Nextflow version; 26.10 only at launch | Accepted |
| [0007](0007-typed-by-default.md) | Typed by default; legacy code accepted and editable | Accepted |
| [0008](0008-canvas-model.md) | Canvas model: fixed node kinds, chain nodes, layout in a sidecar | Accepted |
| [0009](0009-registry-and-github-access.md) | Read the registry and GitHub straight from the browser, with a snapshot fallback | Accepted |
| [0010](0010-language-server-spike.md) | Try the official language server in the browser; never depend on it | Superseded by 0026 |
| [0011](0011-testing-with-real-pipelines-and-nextflow.md) | Test against real pipelines, with real Nextflow and nf-docs as oracles | Accepted |
| [0012](0012-agent-workflow.md) | Agents work one feature per session against a fixed feature list | Accepted |
| [0013](0013-nf-docs-integration.md) | Write docs in nf-docs format, generate an nf-metro map, publish to GitHub Pages | Accepted |
| [0014](0014-security-headers.md) | Serve a strict, one-line security header set from netlify.toml | Superseded by 0040 |
| [0015](0015-ci-checks.md) | Run every check on each pull request in one CI workflow | Accepted (agent) |
| [0016](0016-scope-guard-and-smoke.md) | Guard features.json scope in CI and keep a one-minute smoke run | Accepted (agent) |
| [0017](0017-corpus-fetch.md) | Fetch the corpus by commit SHA with git and cache it in Actions | Accepted (agent) |
| [0018](0018-parallel-features-and-local-nextflow.md) | Allow parallel features and local Nextflow runs | Accepted |
| [0019](0019-nextflow-oracle.md) | Run the Nextflow oracle from the pinned release, locally and in CI | Accepted (agent) |
| [0020](0020-parser-and-catalogue-generation.md) | Generate the parser with antlr-ng and the catalogue from the language server jar | Accepted (agent) |
| [0021](0021-app-shell-layout.md) | Hand-roll the resizable shell and keep its layout in localStorage | Accepted (agent) |
| [0022](0022-s3-spike-local.md) | Run spike S3 locally, with its own header set and no CI job | Accepted (agent) |
| [0023](0023-s4-probe.md) | Probe cross-origin access from the deployed site with a Playwright-driven page | Accepted (agent) |
| [0024](0024-spike-s5-self-hosted-pyodide.md) | Run spike S5 as a local test page with pinned, self-hosted Pyodide | Accepted (agent) |
| [0025](0025-palette-overlay.md) | Keep the palette overlay in YAML, generate JSON for the pack | Accepted (agent) |
| [0026](0026-no-language-server-in-v0-1.md) | Keep the CheerpJ language server out of v0.1 | Accepted (agent) |
| [0027](0027-ast-conventions.md) | Share AST conventions across scripts and configs, and attach comments as nf-lang does | Accepted (agent) |
| [0028](0028-palette-data-path.md) | Load the palette from the pack and the catalogue lazily | Accepted (agent) |
| [0029](0029-relax-qa-03.md) | Let opening a large project take longer, as long as the app stays responsive | Accepted |
| [0030](0030-trim-v0-1-scope-and-gates.md) | Defer private GitHub import and report the timing budgets instead of gating them | Accepted |
| [0031](0031-docs-only-changes-to-main.md) | Push docs-only changes straight to main | Accepted |
| [0032](0032-printer-known-differences.md) | Print as `nextflow lint -format` does, except where its output is broken | Accepted (agent) |
| [0033](0033-declaration-fallback-and-source-file.md) | Fall back per declaration, print untouched code from its source, and load the parser lazily | Accepted (agent) |
| [0034](0034-include-resolution-and-incremental-model.md) | Resolve includes as nf-lang 26.10 does, and re-model a changed file and its direct dependants | Accepted (agent) |
| [0035](0035-registry-snapshot.md) | Build the registry snapshot in a scheduled workflow and publish it through a snapshot branch | Superseded by 0041 |
| [0036](0036-projection-node-keys-and-types.md) | Project typed workflows into plain-data graphs with name-based node keys and Channel/Value types | Accepted (agent) |
| [0037](0037-code-nodes-and-free-variables.md) | Wire code nodes to the variables they read and write | Accepted (agent) |
| [0038](0038-legacy-projection.md) | Project legacy dataflow forms, including aliases and dataflow conditionals | Accepted (agent) |
| [0039](0039-edit-commands.md) | Apply edits as text patches with inverses, reprinting whole declarations, behind AR-24 and LA-13 guards | Accepted (agent) |
| [0040](0040-github-pages-hosting.md) | Host on GitHub Pages, with the security policy in meta elements | Accepted |
| [0041](0041-registry-snapshot-deploy.md) | Deploy the registry snapshot with the site from Actions | Accepted (agent) |
| [0043](0043-engine-worker.md) | Run the engine in a module worker behind Comlink, and benchmark it in Chromium | Accepted (agent) |
| [0044](0044-embeddable-in-frames.md) | Let the app load and work inside frames | Accepted |
