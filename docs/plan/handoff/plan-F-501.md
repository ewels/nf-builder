# Plan: F-501, registry snapshot

I wrote this plan on 2026-11-22 and changed nothing in the repo or any worktree. It is based on:
- `main` at `f29d22e`;
- `feat/F-104` at `63d19b4` (`/home/user/wt-F-104`), for the names this plan relies on: `LanguagePack.loadParser(): Promise<SourceParser>`, `SourceParser.parseScript(text): ScriptSourceParse` (`status` is `modelled`, `partial` or `verbatim`; `ast` is `ScriptAst | null`), top-level `Unparsed` items, and ADR 0033. The next free ADR is therefore **0034**.

I measured the registry live from the sandbox (section 8).

## 0. Scope

A scheduled and dispatchable workflow runs a new build-time tool, `tools/registry-snapshot`, and writes a static snapshot:
- a module index: process or workflow, typed or legacy, and `meta.yml` ports;
- one bundle per module release;
- a plugin index and per-plugin specs.

The tool classifies typed and legacy modules with the 26.10 pack's parser. A root script checks the result (QA-06 and integrity). The workflow then publishes the snapshot, and every Netlify build serves it at `/registry/`.

Out of scope here, but F-501 fixes the format these features read:
- F-502: `RegistryClient`, fallback, age display.
- F-503: palette.
- F-504: insertion and `.module-info`.
- F-505: plugin palette and config entries.
- F-506: module details.

## 1. Findings

### 1.1 Spec, ADRs, repo
- **IO-31:** the snapshot is built daily by an Action and served with the site. It holds a module index (`meta.yml` inputs and outputs, process or workflow, legacy or typed), per-module bundles, a plugin index and plugin specs.
- **QA-06:** the index is at most 300 KB gzipped. The ADR 0015 conventions apply: node:zlib default level, 1 kB = 1000 B, limit in `scripts/budgets.json`.
- **Other spec items the format must serve:**
  - LA-23: ports come from `meta.yml` until the module is inserted.
  - UX-11: search by name, description and keywords.
  - UX-14: namespace groups, a process or workflow mark, a `typed` tag, the data source and its age.
  - UX-21: the node title is the component name.
  - IO-32: `include { NAME } from '<ns>/<name>'`.
  - IO-33: `id '<name>@<version>'`.
  - F-506: "update available" needs the version.
- **ADR 0009 and S4:** the snapshot is the browser's only registry source. Bundles must come from our origin.
- **ADR 0002:** server steps run in Actions and ship as static files. The runtime allow-list doesn't change; `/registry/` is same-origin and `connect-src 'self'` covers it.
- **ADR 0017:** build-time hosts are recorded in the ADR that adds them.
- **`.dependency-cruiser.cjs` rule `tools-standalone`:** a tool may not import any workspace package. Parser-based detection therefore needs a boundary change (open point 4).
- **AGENTS.md "Generated files"** lists `apps/web/public/registry/**` with CI job `registry-snapshot`. It was written before sizes were known (open point 1). `biome.json` already excludes `apps/web/public/registry`.
- **`netlify.toml`:** the SPA fallback `/* → /index.html 200` means a missing `/registry/index.json` returns HTML with status 200. `test/netlify-config.test.ts` pins the build command, so the design leaves `netlify.toml` alone.
- **Existing helpers to reuse:**
  - `readBudget` in `scripts/check-bundle-budget.ts`;
  - `Problem` and `githubAnnotation` in `scripts/check-common.ts`;
  - the Vite-plugin pattern in `scripts/version-json.ts`, which already reads Netlify's env;
  - `test/workflows.test.ts`, which checks SHA pinning and top-level permissions for every workflow;
  - `test/architecture.test.ts` plus `test/fixtures/boundaries`.
- **Tools already read `packages/lang-2610/upstream.json` by path** (`tools/corpus/src/lint.ts`). Its `nextflow.version` is `26.10.7`.

### 1.2 The registry API

Measured on 2026-11-22. `service-info` reports 0.29.1; the OpenAPI document is 0.14.0 (https://registry.nextflow.io/openapi/openapi-latest.yaml, SHA-256 `d7f720a9…e5aa5`).

**Rate limits and timing**
- Every response carries `ratelimit-limit: 100`, `ratelimit-remaining` and `ratelimit-reset` (seconds).
- A sequential client made 4,756 requests in 28.9 min (≈0.36 s each, latency-bound): 2,322 module GETs, 2,322 CDN downloads and 114 plugin calls. It got no 429.
- One module fails persistently: `nf-core/tiara/tiara` gives HTTP 500 on both `/modules/{name}` and `/releases`.

**Module list:** `GET /api/v1/modules/list?size=100&page=N&kind=Process|Workflow`
- `page` is 1-based, and `size` is at most 100.
- Without `kind`, the endpoint returns processes only.
- There are 2,196 processes and 126 workflows, 2,322 in all:

  | Namespace | Modules |
  |---|---|
  | nf-core | 2,288 |
  | cellgeni | 20 |
  | seqera-services | 7 |
  | seqera | 4 |
  | claymcleod | 1 |
  | nextflow-io | 1 |
  | nf-neuro | 1 |

- 1,771 names have three segments (`nf-core/samtools/merge`). Upstream `ModuleReference`: scope is the first segment, name is the rest.
- None are revoked. List items carry no `latest` and no metadata.

**Module details:** `GET /api/v1/modules/{name}`, with the name `%2F`-encoded, about 2.6 kB each.
- It returns `module.latest`: `version` (`0.0.0-<sha7>` for 2,288 modules), `checksum` (`sha256:` of the tar.gz), `size`, and `metadata`.
- `metadata` is the registry's own reading of `meta.yml`: `kind`, `description`, `keywords`, `componentName`, `requires.modules`, `input: [{items:[{name,type,description,pattern?}], tuple}]` and `output: {name: {items, tuple}}`.
- **`output` is not in `meta.yml` order.** For fastqc the API gives `zip, html, versions_fastqc`; `meta.yml` and `main.nf` give `html, zip, versions_fastqc`. The order is the same across endpoints.
- 47 unnamed outputs get synthetic `output_<n>` keys.
- 361 items have no `type`. Most come from nf-core subworkflow `structure:` lists, which the registry flattens to the channel name.
- `tuple` equals "more than one item" except in 3 channels.

**Bundle download:** `GET …/{version}/download` returns a 307 to `public-cr-prod.seqera.io/docker/registry/v2/blobs/sha256/<2>/<hex>/data`, with `x-nf-module-checksum`. The `latest.url` (`public.cr.seqera.io` OCI blob) needs a bearer token.
- The bundle is the module directory. For fastqc 0.0.0-6d1763b (22,661 B) it holds:
  - `.conda-lock/` (2 files, 70 kB);
  - `environment.yml`;
  - `main.nf` (byte-identical to nf-core/modules@6d1763b);
  - `meta.yml` (re-serialised: `name: "nf-core/fastqc"`, plus `version` and `license`; key order kept);
  - `tests/main.nf.test` and `tests/main.nf.test.snap`.
- The archives use pax headers.
- `nextflow module install` extracts the whole archive into `modules/<scope>/<name>/` (`ModuleStorage.installModule`).

**Sizes across all 2,321 bundles**

| Measure | Size |
|---|---|
| tar.gz | 23.1 MB |
| Extracted | 92.3 MB |
| As `{path,text}` JSON, gzipped | 21.6 MB (largest 148 kB) |
| Without `tests/` and `.conda-lock/`, extracted | 15.5 MB |
| Without `tests/` and `.conda-lock/`, gzipped JSON | 5.0 MB |

- 9 files are not UTF-8 (a cellgeni module ships `.pyc`). No file has an executable bit.

**`meta.yml` dialects in the bundles**

| Dialect | Modules |
|---|---|
| nf-core nested lists | 1,262 |
| nf-core with mixed inputs | 686 |
| nf-core flat and subworkflow `structure:` | 127 |
| cellgeni variants | 99 + 53 + 46 |
| Nextflow module schema v1 (nextflow-io/schemas `module/v1`; output names optional) | 25 |

The registry normalises all of them.

**Workflow `requires.modules`:** 471 pins, all exact and none constraints. They pin **154 distinct versions that are not the latest**; for example `nf-core/gatk4/applybqsr@0.0.0-6d1763b`, while the latest is `0.0.0-c87ca93`.

**Churn:** a bulk import on 2026-10-28 (1,385 latest releases). Otherwise 1 to 198 new latest releases a day.

**Plugins**
- `GET /api/v1/plugins?size=100&page=N` lists 112 ids. `GET /api/v1/plugins/{id}` returns `releases[]` with `version`, `date`, `requires`, `status`, `description` (README markdown, median 767 chars) and `spec` (a JSON string, nextflow-io/schemas `plugin/v1`).
- 8 plugins have no published release. 1 release is REVOKED.
- Releases are listed by **version**, not date: nf-azure 1.25.0 comes before 1.24.5, which is newer by date.
- The highest versions of the core plugins require `>=26.11.0-edge`, so they don't run on 26.10.7: nf-amazon 3.13.0, nf-azure 1.25.0, nf-wave 1.23.0, nf-seqera 0.27.0.
- `requires` comes in the forms `>=V`, `>V`, `<V` and bare `V`, where V is `YY.MM.P[-edge|-SNAPSHOT]`.
- 30 of the highest releases have a spec (98.6 kB, 23 kB gzipped). Their definitions are 164 Functions, 24 ConfigScopes, 4 Operators and 3 Factories.
- nf-schema 3.1.0 has a 9 kB spec (1 ConfigScope, 20 Functions); its 3.0.0 and 2.8.0 have none.

### 1.3 Typed and legacy, using the 26.10 parser

I ran `parseScriptAst` from main over all 2,321 `main.nf` files in 32 s:
- 0 parse failures;
- **10 typed processes**: nextflow-io/hello, seqera/evoef1 and evoef2, and seqera-services bcftools_sort, bedtools_intersect, filter_calls, mosdepth, multiqc, sniffles2 and truvari_bench;
- 2,184 legacy processes, including nf-core/fastqc (`FASTQC`);
- 127 legacy workflows.

Three cases where the registry and the parser disagree:
- `nf-core/fasta_clean_faidx` is `Process` in the registry, but `main.nf` declares a workflow.
- `nextflow-io/hello` (typed) has no `componentName`; the parser finds `HELLO`.
- 2 files have several process or workflow declarations.

In 26.10 a process is typed when `nextflow.enable.types = true` appears before it (`src/ast/build/process.ts:4`).

**Running the pack under plain Node:** it fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, because 5 constructors use parameter properties:
- `src/ast/attach-comments.ts:82`;
- on F-104: `printer/formatter.ts:81`, `printer/script-formatter.ts:68`, `source/isolate.ts:23` and `source/prescan.ts:586`.

Everything else in lang-2610, lang-core and engine passes `erasableSyntaxOnly`. The pack entry imports by package name under plain `node`. It also works with `--experimental-transform-types`.

### 1.4 QA-06 options, measured on the full data (gzip −6)

| Variant | kB |
|---|---|
| One index with everything (component, ports including eval item names) | **304: over** |
| One index without the component | 281 |
| One index without eval item names (they are shell commands) | 286 |
| One index without both | 264 (88%) |
| **Split, `index.json`**: name, version, kind, component, typed, description, keywords, plus the plugins (6 kB) | **≈168 (56%)** |
| **Split, `ports.json`** (eval names kept) | 142 |

Share of the one-file index by field: descriptions 37%, outputs 34%, inputs 13%, keywords 12%. Removing checksums from the index saved about 120 kB.

## 2. Design

### 2.1 Where things live

| Piece | Where |
|---|---|
| Format v1 types | `packages/lang-core/src/registry-snapshot.ts`, types only. The writer (tool) and the reader (F-502, `packages/sources`) both import lang-core. |
| Builder: API client, record and replay, tar reader, ports, classification, plugins, build, CLI | `tools/registry-snapshot/`, a new workspace package. It may import lang-core and pack entries only (new dependency-cruiser rule). |
| QA-06 and integrity check | `scripts/check-registry-snapshot.ts` (`pnpm check:registry`), next to `budgets.json` and `readBudget` |
| Serving | `scripts/registry-snapshot-site.ts`, a Vite plugin in `apps/web/vite.config.ts`. `netlify.toml` is unchanged. |
| Workflow | `.github/workflows/registry-snapshot.yml` |

### 2.2 Format v1, served at `/registry/` (ADR 0034)

```
registry/index.json                    QA-06; what the palette loads first
registry/ports.json                    meta.yml ports of each indexed version (LA-23); loaded on first need
registry/modules/<name>/<version>.json one per release: each module's latest, plus every pinned dependency version
registry/plugins/<id>/<version>.json   one per indexed plugin: description and definitions
```

```ts
export interface RegistrySnapshotIndex {
  readonly format: 1;
  readonly generatedAt: string;   // ISO UTC, when the build started (UX-14 age)
  readonly registry: string;      // "https://registry.nextflow.io"
  readonly apiVersion: string;    // service-info, "0.29.1"
  readonly language: string;      // pack that classified typed and legacy, "26.10"
  readonly nextflow: string;      // version plugin releases were chosen for, "26.10.7"
  readonly modules: readonly SnapshotModule[];  // sorted by name
  readonly plugins: readonly SnapshotPlugin[];  // sorted by id
}
export interface SnapshotModule {
  readonly name: string;          // "nf-core/fastqc"; namespace = text before the first "/"
  readonly version: string;       // bundle at modules/<name>/<version>.json
  readonly kind: "process" | "workflow";
  readonly component: string | null; // "FASTQC"
  readonly typed: boolean | null;    // null: main.nf could not be modelled
  readonly description: string;
  readonly keywords: readonly string[];
}
export interface RegistrySnapshotPorts {
  readonly format: 1;
  readonly generatedAt: string;   // equals the index's
  readonly modules: Readonly<Record<string, SnapshotModulePorts>>;
}
export interface SnapshotModulePorts {
  readonly inputs: readonly SnapshotPort[];
  readonly outputs: readonly SnapshotOutput[];
}
/** "<name>:<type>" (split at the last ":"; either side may be empty), or an array of them for a tuple. */
export type SnapshotPort = string | readonly string[];
export interface SnapshotOutput {
  readonly name: string | null;
  readonly port: SnapshotPort;
}
export interface SnapshotPlugin {
  readonly id: string;
  readonly version: string;       // highest published release that runs on `nextflow`
  readonly requires: string | null;
  readonly summary: string;       // first non-heading paragraph of the description, ≤ 300 chars
  readonly provider: string | null;
  readonly projectUrl: string | null;
  readonly definitions: number;   // 0: the release publishes no spec
}
export interface SnapshotModuleBundle {
  readonly format: 1;
  readonly name: string;
  readonly version: string;
  readonly checksum: string;      // "sha256:<hex>" of the registry tar.gz, verified
  readonly component: string | null;
  readonly requires: readonly { readonly name: string; readonly version: string }[];
  readonly files: readonly SnapshotFile[];  // every regular file, sorted by path
}
export type SnapshotFile =
  | { readonly path: string; readonly text: string }
  | { readonly path: string; readonly base64: string };
export interface SnapshotPluginFile {
  readonly format: 1;
  readonly id: string;
  readonly version: string;
  readonly requires: string | null;
  readonly description: string;
  readonly definitions: readonly PluginDefinition[];
}
export type PluginDefinition =
  | { readonly type: "ConfigScope"; readonly spec: PluginConfigScope }
  | { readonly type: "Function" | "Operator" | "Factory"; readonly spec: PluginFunction };
// PluginConfigScope { name; description?; children?: (ConfigScope | ConfigOption{name, description?, type, additionalTypes?})[] }
// PluginFunction { name; description?; returnType?; parameters?: {name, type}[] }
```

The fastqc entries come out as follows:
- `index.json`: `{"name":"nf-core/fastqc","version":"0.0.0-6d1763b","kind":"process","component":"FASTQC","typed":false,…}`.
- `ports.json`: inputs `[["meta:map","reads:file"]]`; outputs `html` → `["meta:map","*.html:file"]`, `zip` → `["meta:map","*.zip:file"]`, `versions_fastqc` → `["${task.process}:string","fastqc:string","fastqc --version | sed \"/FastQC v/!d; s/.*v//\":eval"]`.

All JSON is minified and deterministic: the same input and the same clock give identical bytes.

### 2.3 Build pipeline (`buildSnapshot`; sequential; header-driven backoff)

1. Call `serviceInfo`, then `listModules` for both kinds. With `--only`, use the given names instead.
2. For each module:
   1. `getModule`, and skip it if there's no published `latest`.
   2. **Get the bundle.** Reuse `modules/<name>/<version>.json` from `--previous` if its checksum matches. Otherwise call `downloadModule` (it follows the 307), verify the SHA-256, and read it with `readModuleTarGz`.
   3. Classify it with `classifyModule` (2.4).
   4. Work out its ports with `modulePorts` (2.5).
   5. **Pins:** for each `requires.modules` entry that isn't that module's latest and isn't already written, call `getModuleRelease` and download it. Recurse with a visited set.
3. For plugins, call `listPlugins` and then `getPlugin` for each, and build the entry with `pluginSnapshot` (2.6).
4. **Failure policy:**
   - A failed module (HTTP error after 5 attempts, checksum mismatch, bad archive) keeps its previous entry, ports and bundle if it has them. Otherwise it is left out. Either way the report lists it.
   - The build throws `SnapshotBuildError` if more than 2% of modules fail, or if the module count falls below 90% of the previous snapshot's.
   - Only a fully successful run publishes. The live snapshot stays otherwise, and its age shows in the palette.
5. Return a map of files and a report: counts, typed, `typed: null`, kind overrides, reused and downloaded, failures, skipped plugins and sizes. The report is written as Markdown for the job summary.

**Timing:** a daily run is about 17 min (module GETs, pins and plugins). The first run adds about 2,476 downloads, so allow about 40 min; the job timeout is 120 min.

### 2.4 Classification (`classifyModule`)
- Parse with `parser.parseScript(mainNf)`.
- Among top-level `Process` and `Workflow` items (`Unparsed` doesn't count), take the one named the registry's `componentName`, otherwise the only one.
- From that item: kind = its kind, component = its name, typed = its `typed`.
- If no item qualifies (`verbatim`, `Unparsed`, or no `main.nf`): kind comes from the registry, component from `componentName ?? null`, and typed is `null`.
- Disagreements with the registry go in the report.

### 2.5 Ports (`modulePorts`)
- Items come from the registry's metadata, which has already read every dialect.
- A channel with `tuple: true` or more than one item becomes an array; otherwise a single string.
- A missing name or type becomes an empty string.
- Output order comes from the bundle's `meta.yml`:
  - for a map: its keys;
  - for a list: each element's single key, or its `name`, or `output_<i+1>`.
  The API's outputs are sorted by that order; any it doesn't match stay at the end in API order.
- Synthetic `output_<n>` names become `name: null`.
- Known limitation: subworkflow `structure:` items are reduced to channel names, as the registry does. After insertion, ports come from the parsed source anyway (LA-23).

### 2.6 Plugins (`pluginSnapshot`)
- The version is the highest **published** release, in registry order (descending version), whose `requires` admits `nextflow` (upstream.json, 26.10.7). `admits()` handles the forms in 1.2: numeric `YY.MM.P` comparison, and a `-edge` or `-SNAPSHOT` suffix sorts below its release.
- A plugin with no admitted release is skipped and reported.
- Definitions come from that release's `spec.definitions`. Entries that aren't one of the four types with a string `spec.name` are dropped and reported.
- One file is written per plugin.

### 2.7 Workflow `Registry snapshot`

**Triggers**
- `schedule` daily at `23 3 * * *`.
- `workflow_dispatch`.
- `pull_request` limited to these paths: `tools/registry-snapshot/**`, `scripts/check-registry-snapshot.ts` and the workflow itself. This is a dry run that never publishes.
- Top-level `permissions: contents: read`. Concurrency is per PR, or `main`; only PR runs cancel in progress.

**Job `build`** (read-only, `timeout-minutes: 120`):
1. Check out and set up.
2. `git fetch --depth 1 origin registry-snapshot` into `.cache/registry/previous`. This is absent on the first run.
3. Run `pnpm registry:snapshot --out .cache/registry/out --previous … --report …`.
4. Run `pnpm check:registry .cache/registry/out`.
5. Always: write the report to `$GITHUB_STEP_SUMMARY` and upload the `registry-snapshot` artefact (7 days).

**Job `publish`** (`needs: build`; only when the event isn't a PR and the ref is `main`; `permissions: contents: write`):
1. Make a single orphan commit holding `registry/**` and a `netlify.toml` with `[build] ignore = "exit 0"`, so Netlify never builds that branch.
2. `git push --force` it to `refs/heads/registry-snapshot` only, never to `main`.
3. If `secrets.NETLIFY_BUILD_HOOK` is set (passed through env), POST to it, then run `pnpm check:registry --url https://nf-builder.netlify.app --generated-at <ts>`. That command polls up to 15 min until production serves this snapshot, then checks it.

This workflow is not part of AGENTS.md's "CI green" (it depends on a third party, like S4).

### 2.8 Serving: `registrySnapshot(env)`, a Vite plugin with `apply: "build"`
- **Source rules:**
  - If `REGISTRY_SNAPSHOT_DIR` is set, copy that directory's `registry/**`.
  - Otherwise, if `NETLIFY === "true"`, fetch branch `registry-snapshot` from `REPOSITORY_URL` with git (shallow, into a temporary bare repository). A missing branch logs a warning and emits nothing; that covers deploys before the first run. Any other git error fails the build, so the previous deploy stays live.
  - Otherwise emit nothing.
- Each file is emitted as an asset under `registry/`.
- Playwright's preview `webServer` sets `REGISTRY_SNAPSHOT_DIR` to the golden fixture snapshot, which F-502 and F-503 will reuse.
- Build-time hosts (ADR 0034): `registry.nextflow.io`, `public-cr-prod.seqera.io` (download redirect), and `github.com` (git; from the workflow and the Netlify build).

## 3. Files

### 3.1 Create

| File | Exports and signatures |
|---|---|
| `packages/lang-core/src/registry-snapshot.ts` | The types in 2.2. `src/index.ts` re-exports them with `export type`. |
| `tools/registry-snapshot/package.json` | `@nf-builder/registry-snapshot`. Deps: `@nf-builder/lang-core` and `@nf-builder/lang-2610` (`workspace:*`). Dev deps: `@types/node 22.20.5`, `yaml 2.9.1`. Scripts: `typecheck`, `test`. |
| `tools/registry-snapshot/tsconfig.json` | Extends base; `types: ["node"]`; `erasableSyntaxOnly: true` |
| `tools/registry-snapshot/README.md` | Usage; live run in the sandbox with `NODE_USE_ENV_PROXY=1`; re-recording fixtures |
| `src/api-types.ts` | `ApiModuleSummary`, `ApiModule`, `ApiModuleRelease`, `ApiModuleMetadata`, `ApiModuleChannel`, `ApiModuleItem`, `ApiPlugin`, `ApiPluginRelease`: the OpenAPI 0.14.0 subset used |
| `src/api.ts` | `createRegistryApi(o?: {baseUrl?, fetch?, sleep?, log?, maxAttempts?}): RegistryApi` with `serviceInfo()`, `listModules()`, `getModule(name)`, `getModuleRelease(name, version)`, `downloadModule(name, version): Promise<Uint8Array>`, `listPlugins(): Promise<string[]>`, `getPlugin(id)`. Also `class RegistryHttpError extends Error { url; status }`. |
| `src/recording.ts` | `recordingFetch(dir, inner?): typeof fetch`; `replayFetch(dir): typeof fetch & { requested: readonly string[] }` (an unknown URL throws, naming it) |
| `src/tar.ts` | `readModuleTarGz(bytes: Uint8Array): SnapshotFile[]`: gunzip with node:zlib; ustar, pax `path` and GNU `L` names. Throws on absolute or `..` paths, links and devices. Non-UTF-8 content becomes `base64`. |
| `src/ports.ts` | `modulePorts(metadata: ApiModuleMetadata \| undefined, metaYml: string \| null): SnapshotModulePorts`; `metaYmlOutputNames(metaYml: string): string[]` |
| `src/classify.ts` | `classifyModule(parser: SourceParser, mainNf: string \| null, registry: {kind?: string; componentName?: string}): {kind, component, typed}` |
| `src/plugins.ts` | `admits(requires: string \| null, nextflow: string): boolean`; `pluginSnapshot(p: ApiPlugin, nextflow: string): {entry: SnapshotPlugin; file: SnapshotPluginFile; problems: string[]} \| {skipped: string}` |
| `src/build.ts` | `buildSnapshot(o: BuildOptions): Promise<{files: ReadonlyMap<string,string>; report: BuildReport}>`, where `BuildOptions = {api, parser, language, nextflow, now: () => Date, previous?, only?: {modules?, plugins?}, limits?: {maxFailureRatio: 0.02, minCountRatio: 0.9}, log?}`. Also `readPreviousSnapshot(dir): PreviousSnapshot \| undefined` and `class SnapshotBuildError`. |
| `src/files.ts` | `moduleBundlePath(name, version)`, `pluginFilePath(id, version)`, `serialise(value): string`, `writeSnapshot(dir, files)` (replaces `dir/registry`) |
| `src/report.ts` | `reportMarkdown(report: BuildReport, sizes): string` |
| `src/cli.ts` | `main(argv): Promise<number>` for `pnpm registry:snapshot [--out d] [--previous d] [--report f] [--only names] [--plugins ids] [--record d \| --replay d] [--now iso]`. It loads `pack.loadParser()` from `@nf-builder/lang-2610` and reads `nextflow.version` from `packages/lang-2610/upstream.json`. Exit codes: 0 ok, 1 build error, 2 usage. |
| `test/*.test.ts`, `test/fixtures/recorded/**`, `test/fixtures/expected/registry/**` | Section 4 |
| `scripts/check-registry-snapshot.ts` | `checkRegistrySnapshot(dir, budget = readBudget("QA-06")): {ok, indexGzipBytes, problems: Problem[], warnings: Problem[]}`; `checkDeployedSnapshot(url, generatedAt, {timeoutMs, intervalMs, log}): Promise<…>`. CLI: `pnpm check:registry <dir> \| --url <site> --generated-at <iso>`. |
| `scripts/registry-snapshot-site.ts` | `snapshotSource(env): {kind:"dir"; dir} \| {kind:"branch"; url; branch} \| {kind:"none"}`; `fetchSnapshotBranch(url, branch, into): "fetched" \| "missing"`; `registrySnapshot(env): Plugin` |
| `test/check-registry-snapshot.test.ts`, `test/registry-snapshot-site.test.ts`, `e2e/registry-snapshot.spec.ts` | Section 4 |
| `.github/workflows/registry-snapshot.yml` | Section 2.7 |
| `docs/adr/0034-registry-snapshot.md` | Section 7 |

### 3.2 Change

| File | Change |
|---|---|
| `packages/lang-2610/src/{ast/attach-comments,printer/formatter,printer/script-formatter,source/isolate,source/prescan}.ts` | Parameter properties become declared fields |
| `packages/lang-2610/tsconfig.json` | Add `"erasableSyntaxOnly": true` |
| `.dependency-cruiser.cjs` | `tools-standalone` gets `pathNot` for `tools/registry-snapshot`. New rule `registry-snapshot-imports-only-lang-core-and-pack-entries`, mirroring the engine rule. |
| `test/fixtures/boundaries/` | A tool fixture |
| `package.json` | `"registry:snapshot": "node tools/registry-snapshot/src/cli.ts"`, `"check:registry": "node scripts/check-registry-snapshot.ts"` |
| `scripts/budgets.json` | `"QA-06": {description: "Registry snapshot index (registry/index.json), gzipped", maxBytes: 300000, reason: "QA-06 as specified"}` |
| `apps/web/vite.config.ts` | Add the `registrySnapshot(process.env)` plugin |
| `playwright.config.ts` | Preview `webServer.env.REGISTRY_SNAPSHOT_DIR` |
| `biome.json` | Exclude `tools/registry-snapshot/test/fixtures/{recorded,expected}` |
| `test/workflows.test.ts`, `test/architecture.test.ts` | New cases |
| `AGENTS.md` | Two command rows; replace the Generated-files line with "the registry snapshot (branch `registry-snapshot`, served at `/registry/`): workflow `Registry snapshot`; never commit it"; note that the workflow isn't a merge gate |
| `docs/adr/README.md`, `docs/licences.md`, `docs/plan/features.json` (notes), `docs/plan/progress.md` | Records |

## 4. Tests (written before the implementation)

No test touches the network.

**Fixtures** (`tools/registry-snapshot/test/fixtures/recorded/`, recorded in 2026-11 by the CLI with `--record --only`):
- `requests.json` maps `GET <url>` to `{status, headers, body}`.
- Modules:
  - nf-core/fastqc 0.0.0-6d1763b;
  - nextflow-io/hello 1.0.0 (typed, schema v1, 601 B);
  - nf-core/bam_applybqsr (workflow), with pins gatk4/applybqsr@0.0.0-6d1763b (latest is c87ca93) and samtools/merge@0.0.0-df69bf6 (latest is 1b655c6).
- Plugins: nf-schema, and nf-ffq (no spec, 566 B).
- `expected/registry/**` is the golden output and also the e2e snapshot. Regenerate it with `UPDATE_GOLDEN=1`.

**`tools/registry-snapshot/test/api.test.ts`** (fake fetch, fake sleep)

| Test | Asserts |
|---|---|
| `F-501 IO-31: listModules pages through kind=Process and kind=Workflow until last` | Query strings, pages 1..N, size 100, names deduped |
| `F-501 ADR-0009: module names are %2F-encoded in every path` | `nf-core%2Fsamtools%2Fmerge` |
| `F-501: waits ratelimit-reset seconds when ratelimit-remaining reaches 0; retries 429 and 5xx with backoff` | Sleep calls and order |
| `F-501: gives up after 5 attempts with a RegistryHttpError naming the URL and status` | |
| `F-501: downloadModule follows the 307 to the blob` | |

**`tar.test.ts`**

| Test | Asserts |
|---|---|
| `F-501 IO-31: reads every regular file of the recorded fastqc bundle, honouring pax headers` | 7 paths; `main.nf` text contains `process FASTQC` |
| `F-501: rejects absolute paths, .. segments, symlinks and hard links` | Synthetic tars |
| `F-501: a non-UTF-8 file is kept as base64` | |

**`ports.test.ts`**

| Test | Asserts |
|---|---|
| `F-501 step 3 LA-23: nf-core/fastqc ports match its meta.yml` | Recorded metadata plus the bundle's `meta.yml` give exactly the 2.2 ports. Independently, a test-local reader of the nf-core nested dialect (via `yaml`) derives the same channels, item names and types, in order. |
| `F-501 LA-23: outputs follow meta.yml order, not the API's` | |
| `F-501: list-form meta.yml outputs keep position; synthetic output_<n> names become null` | hello |
| `F-501: a missing item name or type is an empty string, never dropped` | |
| `F-501: a single-item tuple stays an array` | |

**`classify.test.ts`** (real parser via `pack.loadParser()`)

| Test | Asserts |
|---|---|
| `F-501 step 3 IO-31: nf-core/fastqc is a legacy process named FASTQC` | |
| `F-501 IO-31: nextflow-io/hello is a typed process HELLO although the registry gives no componentName` | |
| `F-501 IO-31: the parsed kind wins over the registry's` | Inline workflow text with registry `Process` gives `workflow` |
| `F-501 ADR-0004: an unmodellable main.nf gives typed null, kind and component from the registry` | |
| `F-501: picks the declaration named componentName among several` | |
| `F-501: the pack's parser loads and parses under plain Node type stripping` | `spawnSync(process.execPath, ["--input-type=module", "-e", …])` imports `@nf-builder/lang-2610` |

**`plugins.test.ts`**

| Test | Asserts |
|---|---|
| `F-501 IO-31 IO-33: nf-schema indexes 3.1.0 with its 21 definitions` | |
| `F-501 IO-33: the chosen release is the highest published one whose requires admits 26.10.7` | Synthetic releases like nf-azure: 1.25.0 `>=26.11.0-edge` gives 1.24.5 |
| `F-501: admits handles >=, >, <, bare versions, -edge and -SNAPSHOT` | |
| `F-501: no spec gives definitions 0; malformed definitions are dropped and reported; no admitted release skips the plugin` | |

**`build.test.ts`** (replay)

| Test | Asserts |
|---|---|
| `F-501 IO-31: replaying the recording gives the golden snapshot` | Byte equality with `expected/` |
| `F-501 IO-31: each module bundle holds every file of its registry tar.gz and the verified checksum` | |
| `F-501 IO-31: a workflow module's pinned dependency versions get their own bundles` | |
| `F-501: bundles in --previous with a matching checksum are reused without a download` | `replay.requested` |
| `F-501: a module failing after retries keeps its previous entry or is left out, and the report lists it` | |
| `F-501: more than 2% failures, or under 90% of the previous count, throws SnapshotBuildError` | |
| `F-501: two builds with the same clock give identical bytes` | |

**Root tests**

| Test | Asserts |
|---|---|
| `test/check-registry-snapshot.test.ts`: `F-501 step 2 QA-06: index.json gzip size is checked against budgets.json QA-06, with a warning from 90%` | Golden passes; a synthetic 301 kB index fails with a message naming the limit |
| same file: `F-501 IO-31: rejects a wrong format, a module without its bundle or ports, or a plugin without its file` | |
| `test/registry-snapshot-site.test.ts`: `F-501 step 1 IO-31: on Netlify the build fetches the registry-snapshot branch and emits registry/**` | A local bare repo as `file://` `REPOSITORY_URL` |
| same file: `F-501 step 1: a missing branch warns and emits nothing; another git failure fails the build` | |
| same file: `F-501: REGISTRY_SNAPSHOT_DIR wins; with neither variable nothing is emitted` | |
| `test/workflows.test.ts`: `F-501 step 1 IO-31: Registry snapshot runs on a daily schedule, on dispatch, and as a dry run on pull requests touching the tool` | |
| same file: `F-501 step 1 ADR-0034: only the publish job may write, only off pull requests on main, and it pushes only to registry-snapshot` | |
| same file: `F-501 step 2 QA-06: the build job runs pnpm check:registry before uploading` | |
| `test/architecture.test.ts`: `ADR-0003 F-501: tools/registry-snapshot may import lang-core and a pack entry, not pack internals or engine; other tools stay standalone` | |

**End to end:** `e2e/registry-snapshot.spec.ts`, `F-501 step 1 IO-31: the built site serves the snapshot at /registry/ as JSON`. It reads `index.json`, `ports.json` and the fastqc bundle from the preview, which is fed by the fixture snapshot.

## 5. Tasks

Branch `feat/F-501` from `main` after F-104 merges, then run `pnpm install`. Each task writes its tests first.

**Task 1: groundwork**
- Erasable refactor of the 5 constructors, plus the lang-2610 `tsconfig` flag.
- lang-core types.
- Tool skeleton.
- dependency-cruiser rule, boundaries fixture and architecture test.
- The plain-Node parser test.
- Done when:
  ```
  pnpm install && pnpm --filter @nf-builder/lang-2610 test && pnpm --filter @nf-builder/registry-snapshot test && pnpm check
  ```

**Task 2: `api.ts`, `recording.ts`, `tar.ts`**
- Tests use inline fakes, plus the fastqc tar.gz, which you fetch once with `curl -L …/download` into `recorded/`.
- Done when:
  ```
  pnpm --filter @nf-builder/registry-snapshot exec vitest run test/api.test.ts test/tar.test.ts && pnpm check
  ```

**Task 3: `ports.ts`, `classify.ts`, `plugins.ts`**
- Uses the recorded JSON in the replay layout.
- Done when:
  ```
  pnpm --filter @nf-builder/registry-snapshot exec vitest run test/ports.test.ts test/classify.test.ts test/plugins.test.ts && pnpm check
  ```

**Task 4: `build.ts`, `files.ts`, `report.ts`, `cli.ts`; the `registry:snapshot` script**
- Record the fixture set (in the sandbox: `NODE_USE_ENV_PROXY=1 pnpm registry:snapshot --record … --only nf-core/fastqc,nextflow-io/hello,nf-core/bam_applybqsr --plugins nf-schema,nf-ffq`).
- Generate the golden output.
- Done when:
  ```
  pnpm --filter @nf-builder/registry-snapshot test && pnpm registry:snapshot --replay tools/registry-snapshot/test/fixtures/recorded --only nf-core/fastqc --out .cache/registry/t4 && pnpm check
  ```

**Task 5: `check-registry-snapshot.ts`, the QA-06 budget and the `check:registry` script**
- Done when:
  ```
  pnpm exec vitest run test/check-registry-snapshot.test.ts && pnpm check:registry tools/registry-snapshot/test/fixtures/expected && pnpm check
  ```
- Optional: a full live build in the sandbox (about 45 min, `NODE_USE_ENV_PROXY=1`).

**Task 6: Vite plugin, vite config, Playwright env, e2e**
- Done when:
  ```
  pnpm exec vitest run test/registry-snapshot-site.test.ts && pnpm test:e2e -- --grep F-501 && pnpm build && pnpm check:budget && pnpm check:hosts && pnpm check
  ```

**Task 7: workflow, workflow tests, AGENTS.md, Biome, ADR 0034, licences, README**
- Open the PR. The PR's dry run of `Registry snapshot` must go green: that is live QA-06 and the live fastqc entry.
- Done when:
  ```
  pnpm check && gh pr checks --watch
  ```
  and the `Registry snapshot` run is green, with its summary showing the index size and that fastqc is legacy.

**After merge (Q11)**
- `gh workflow run "Registry snapshot" --ref main` must succeed.
- After the next production deploy (or the hook), `pnpm check:registry --url https://nf-builder.netlify.app --generated-at <ts>` passes.
- Record both run links in F-501's notes.

## 6. Open points (each with a recommendation; none decided)

These are decide-and-record items: a stored and published format, a workflow, a package boundary, and a secret.

1. **Publishing route.**
   - **Recommendation:** an orphan `registry-snapshot` branch (force-pushed single commit), fetched by every Netlify build (2.8).
   - Committing to `main`, as the AGENTS.md line implies, loses:
     - 92 MB of text in the tree, with daily churn;
     - bot pushes to `main` that bypass PR CI and contradict AGENTS.md "Never";
     - noise in every worktree's searches.
   - Release assets: the same as the branch plus tar handling and clutter.
   - Netlify CLI deploys from Actions need a token and drop Netlify's own builds and previews.
   - Building in Netlify: about 20 to 45 min of registry calls per deploy, including every preview.
2. **Netlify build hook (maintainer).**
   - Without the `NETLIFY_BUILD_HOOK` secret, a new snapshot reaches the site at the next production deploy, so daily only while `main` moves.
   - **Recommendation:** ship without it. Open a `maintainer` issue to add the secret, and record it under Blockers; it doesn't block passing.
   - Also ask the maintainer to confirm branch deploys are off for `registry-snapshot`. The branch's `netlify.toml` ignore covers it anyway.
3. **QA-06 versus IO-31.** IO-31 puts ports in the "module index", but a full single index is 304 kB, over QA-06.
   - **Recommendation:** split into `index.json` (168 kB, QA-06) and `ports.json` (142 kB, loaded on first need, which matches UX-14 "lazy-loaded" and LA-23's drag-time use). Record in ADR 0034 that IO-31's module index is the pair and QA-06 applies to `index.json`. Optionally amend IO-31's wording in the same PR.
   - Alternative: one file without the component and eval item names, at 264 kB (88%). It would breach within months as the registry grows.
4. **Builder location and boundary.**
   - **Recommendation:** `tools/registry-snapshot` may import lang-core and pack entries (new rule; ADR 0034 amends ADR 0003's table). Format types go in lang-core.
   - Alternative: put the builder in `packages/sources` with an injected parser and a root CLI. That needs no rule change, but puts Node build code in a browser package.
5. **Running the pack in Node.**
   - **Recommendation:** make lang-2610 erasable (5 constructors) and enforce it with `erasableSyntaxOnly`.
   - Alternative: `node --experimental-transform-types`, an experimental flag in a daily job.
6. **Ports source.**
   - **Recommendation:** the registry's normalised metadata, with output order from the bundle's `meta.yml`.
   - Alternative: our own reader of 5+ dialects.
   - Accept the subworkflow `structure:` limitation.
7. **Classification.** **Recommendation:** the parser's kind and component win; `typed: null` when nothing is modelled (measured: none today).
8. **Bundle contents.**
   - **Recommendation:** every file (21.6 MB gzipped across 2,321 modules; at most 148 kB each), with non-UTF-8 files as base64. This matches `nextflow module install` and keeps F-504's `.module-info` checksum possible.
   - Alternative: drop `tests/` and `.conda-lock/` (5.0 MB).
9. **Pinned dependency versions.** **Recommendation:** include the closure (+154 bundles). Without it, F-504 can't install workflow modules as `nextflow module install` would.
10. **Plugin version.**
    - **Recommendation:** the highest published release admitted by `upstream.json`'s Nextflow (26.10.7). Write one file per plugin, holding the description and definitions.
    - Alternative: the newest regardless. F-505 would then pin core plugins that need 26.11-edge.
11. **Failure policy.** **Recommendation:** 5 attempts per request; at most 2% module failures; at least 90% of the previous count; no issue automation. GitHub mails the cron author on failure, and the palette shows the age.
12. **PR dry run.** **Recommendation:** a path-filtered PR trigger, not in "CI green". F-501's own PR needs one green run as evidence for steps 2 and 3.
13. **Schedule.** Daily at 03:23 UTC. GitHub disables schedules after 60 days without repository activity; F-502's age display makes that visible.
14. **e2e fixture.** **Recommendation:** `REGISTRY_SNAPSHOT_DIR` in Playwright's preview env, set to the golden snapshot, so F-501 has an e2e test and F-502 and F-503 have data.

## 7. Records

**ADR 0034** "Build the registry snapshot in a scheduled workflow and publish it through a snapshot branch", `Accepted (agent)`:
- format v1 (2.2), versioned by `format`;
- the builder and its boundary exception (amends ADR 0003);
- the erasable pack;
- classification, ports, pins and plugin choice;
- failure policy;
- the workflow, branch, Vite fetch and optional hook;
- build-time hosts (ADR 0017);
- the reading of IO-31 and QA-06 (open point 3);
- Alternatives: the routes in open point 1, the single-file index, and the transform-types flag.

Also:
- a row in `docs/adr/README.md`;
- AGENTS.md commands (`pnpm registry:snapshot`, `pnpm check:registry`) and the Generated-files line;
- `docs/licences.md` rows: recorded registry responses and bundles (nf-core/modules MIT; nextflow-io/hello Apache-2.0; nf-schema description and spec Apache-2.0), test data only;
- `progress.md` Decisions for each settled open point;
- Blockers: the hook issue.

**features.json notes** (no scope change)
- **F-501:** verification runs and sizes.
- **F-502:**
  - Read `/registry/index.json`, check `format === 1` and a JSON content type (the SPA fallback returns HTML 200 when it's missing).
  - Age comes from `generatedAt`.
  - Fixture snapshot via `REGISTRY_SNAPSHOT_DIR`.
  - Delete the S4 probe here.
- **F-503:** namespace = the first segment; `kind`, `typed` (null = unknown); search over name, description and keywords; ports are in `ports.json`.
- **F-504:**
  - The bundle's `files`, including base64, go to `modules/<name>/`.
  - `component` is the include name.
  - The `requires` pins are present as bundles.
  - `checksum` is the registry tar.gz checksum.
- **F-505:** `plugins/<id>/<version>.json` definitions; the version is already chosen for the pack's Nextflow.
- **F-506:** the index `version` is the latest.

## 8. Evidence and how to repeat it

Everything is in `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f501/`, which may be cleared:
- **Raw data** (`dl/`):
  - `openapi.yaml`;
  - `names.json`;
  - `mods/` (2,321 module JSON files);
  - `bundles/` (2,321 tar.gz files);
  - `plugins/` (112);
  - `fetch.log`;
  - `typed-report.json`.
- **Scripts** (`scripts/`): `fetch_all.py` is the throttled fetcher; `run_all.sh` runs every analysis; the results are in `analysis-full.txt`.
- **Format types draft:** `draft/types.ts`.
- **Typed detection:** run `node --experimental-transform-types scripts/typed.ts <dl>` from `/home/user/wt-main`.
- **Upstream install code:** `/tmp/claude-0/-home-user-nf-builder/70d5865b-2a0d-5fd9-97cb-b2ef34d49d11/scratchpad/f105/upstream/ModuleStorage.groovy`, L215-L240.
