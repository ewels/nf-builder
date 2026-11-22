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
| [0010](0010-language-server-spike.md) | Try the official language server in the browser; never depend on it | Accepted (spike S3 to confirm) |
| [0011](0011-testing-with-real-pipelines-and-nextflow.md) | Test against real pipelines, with real Nextflow and nf-docs as oracles | Accepted |
| [0012](0012-agent-workflow.md) | Agents work one feature per session against a fixed feature list | Accepted |
| [0013](0013-nf-docs-integration.md) | Write docs in nf-docs format, generate an nf-metro map, publish to GitHub Pages | Accepted |
| [0014](0014-security-headers.md) | Serve a strict, one-line security header set from netlify.toml | Accepted (agent) |
| [0015](0015-ci-checks.md) | Run every check on each pull request in one CI workflow | Accepted (agent) |
| [0016](0016-scope-guard-and-smoke.md) | Guard features.json scope in CI and keep a one-minute smoke run | Accepted (agent) |
| [0017](0017-corpus-fetch.md) | Fetch the corpus by commit SHA with git and cache it in Actions | Accepted (agent) |
| [0018](0018-parallel-features-and-local-nextflow.md) | Allow parallel features and local Nextflow runs | Accepted |
| [0019](0019-nextflow-oracle.md) | Run the Nextflow oracle from the pinned release, locally and in CI | Accepted (agent) |
| [0020](0020-parser-and-catalogue-generation.md) | Generate the parser with antlr-ng and the catalogue from the language server jar | Accepted (agent) |
| [0021](0021-app-shell-layout.md) | Hand-roll the resizable shell and keep its layout in localStorage | Accepted (agent) |
| [0023](0023-s4-probe.md) | Probe cross-origin access from the deployed site with a Playwright-driven page | Accepted (agent) |
