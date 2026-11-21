# Plan: F-005, spike S1 (typed/legacy interop, `.module-info`, latest 26.10 patch)

Planner, 2026-11-21. Repo `/workspace/nf-builder`. Nothing in the repo was changed.
Scope: features.json F-005 (spec ADR-0007, ADR-0009, LA-03, LA-14; depends on F-003).
Includes the orchestrator's update: Nextflow may run locally as well as in CI, through one pinned version and one entry point.

Nextflow sources were read at tag `v26.10.7`, commit `0ad848ef3c3a22824cd9eb2ca14568385867702d`, via raw.githubusercontent.com and a blobless clone. `S` below stands for `https://github.com/nextflow-io/nextflow/blob/v26.10.7`.

---

## 0. Facts the plan rests on (all checked first-hand today)

| Fact | Source |
|---|---|
| Tags `v26.10.6` (commit 9dca05af4f60e73ad684808b71ab8178c5fedf2a) and `v26.10.7` (commit 0ad848ef3c3a22824cd9eb2ca14568385867702d) exist. There is no `v26.10.8`. `VERSION` at the tag reads `26.10.7`. | `git ls-remote --tags https://github.com/nextflow-io/nextflow.git 'v26.10*'`; `S/VERSION` |
| The release asset `nextflow-26.10.7-dist` is 49,107,977 bytes and redirects to `release-assets.githubusercontent.com`. The release publishes no checksum file (`.sha256`, `.sha256sum`, `sha256sums.txt`, `checksums.txt` all return 404). | `curl -sIL` on the asset |
| The `-dist` file is the bash launcher with the jar appended (`NXF_PACK=dist`). It finds itself through `command -v "$0"`, so it must be run directly as an executable, not as `bash <file>`. | `S/nextflow#L296-L299` |
| The launcher accepts only Java 17 to 26 and prints its own error otherwise. It defaults `NXF_VER` to `26.10.7` but honours an inherited `NXF_VER`. | `S/nextflow#L19-L25`, `#L350-L356`; `S/docs/install.mdx#L16` |
| `NXF_OFFLINE=true` turns off the version check and plugin downloads. | `S/docs/reference/env-vars.mdx#L225-L235` |
| `nextflow lint -o json` prints `{date, summary, errors[], warnings[]}` to stdout. Each entry has `filename`, `startLine`, `startColumn` and `message`. The exit status is non-zero only when there are errors. Lint visits directories recursively but parses only `.nf` and `.config` files. | `S/modules/nf-cli-v1/src/main/groovy/nextflow/cli/CmdLint.groovy#L152-L195`, `#L455-L511`, `#L215-L221` |
| Lint type-checks only scripts with `nextflow.enable.types = true`. A call to a legacy process has no typed outputs (`processOutputs` returns null), so the type checker doesn't check it. | `S/modules/nf-lang/src/main/java/nextflow/script/control/ScriptParser.java#L103-L104`; `.../TypeCheckingVisitor.java#L990-L994`, `#L1027-L1033` |
| `nextflow run` with a syntax error prints the errors to stdout, then throws `Script compilation failed`. | `S/modules/nextflow/src/main/groovy/nextflow/script/parser/v2/ScriptLoaderV2.groovy#L129-L146` |
| With `-stub`, a task uses its stub only when the process has a `stub:` block. Otherwise the body runs, and for `exec:` processes that body runs inside the JVM. | `S/modules/nextflow/src/main/groovy/nextflow/processor/TaskRun.groovy#L876-L878`; `S/docs/process.mdx#L304` |
| Typed calling legacy, and legacy calling typed, across files: Nextflow's own tests expect no exception. | `S/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L74-L117` (legacy calls typed), `#L119-L162` (typed calls legacy), `#L211-L253` (a typed workflow reads a legacy process's named outputs as record fields) |
| Typed and legacy definitions in one script are an error. Typed scripts parse every process as typed, so a legacy input there gives "Invalid input declaration in typed process". Without the flag, a typed input gives "Typed input declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script". | `S/docs/static-typing.mdx#L50`; `S/modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java#L585`, `#L664`, `#L741`; `S/modules/nf-lang/src/test/groovy/nextflow/script/parser/ScriptAstBuilderTest.groovy#L498-L542`, `#L544-L585`; `S/modules/nf-lang/src/main/java/nextflow/script/dsl/FeatureFlagDsl.java#L47-L53` |
| The flag takes effect where it is declared: `typingEnabled` is set when the parser reaches the declaration. | `S/.../ScriptAstBuilder.java#L320-L325` |
| `nextflow lint` reports type errors in typed scripts. `nextflow run` only warns about them. | `S/docs/migrations/26-10.mdx#L22` |
| Typed workflows can't use `.out`. They use assignments instead. A legacy workflow's outputs aren't typed, so a wrong name fails only at runtime. | `S/docs/workflow-typed.mdx#L55`; `S/docs/static-typing-prep.mdx#L64-L112` |
| `.module-info` is a `java.util.Properties` file written by `props.store(os, null)` with two keys: `checksum` and `registryUrl`. | `S/modules/nextflow/src/main/groovy/nextflow/module/ModuleInfo.groovy#L34`, `#L44-L72`, `#L99-L108`; `.../ModuleStorage.groovy#L151-L153`, `#L235-L238` (install), `#L117-L128` (`refreshChecksum` after vendoring a workflow module's dependencies); `.../ModuleChecksum.groovy#L39-L41`, which delegates to `io.seqera.npr.client.ModuleChecksum.computeDirectory`. That library is not in the Nextflow repo, so its algorithm is unverified. |
| A module directory without `.module-info` is skipped by `module list` (it scans for the marker file). `module remove` refuses it without `-force`: "Folder 'modules/<ref>' already exists and is not a valid remote module (.module-info missing)". | `.../ModuleStorage.groovy#L166-L200`, `#L265-L272` |
| nf-core module shape: `tag "${meta.id}"`, `tuple val(meta), path(reads, ...)`, `tuple val(meta), path("*.html"), emit: html`, and a `stub:` that `touch`es the outputs. | `https://github.com/nf-core/modules/blob/bbd7054a060ab558521f3c6601df5323c96362fd/modules/nf-core/fastqc/main.nf#L5`, `#L13-L17`, `#L54-L59` |
| Action pins resolved today. Tags are lightweight, so these are commit SHAs: `actions/setup-java` v6.3.0 = `d1374f8ac74474200d16ef8ecee22c7ae7a51880`, `actions/cache` v6.1.0 = `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`. If F-009 merged first with its own `actions/cache` pin, reuse that pin. | `git ls-remote` |

---

## 1. Decisions taken in this plan (to record; see Open points)

1. **Release `-dist` file on Java, not Docker.** One artefact and one entry point serve both local runs and CI, as the maintainer asked through the orchestrator. The sandbox has Java 21 and no Docker daemon. The 49 MB download is cached in `.cache/nextflow/` and in `actions/cache`. The pin is a SHA-256 in one file. CI uses Temurin 21 from `actions/setup-java`, which is inside the launcher's 17 to 26 range. The official image (`S/docker/Dockerfile`, `amazoncorretto:25-al2023`) runs the same jar, so the only difference is the JVM. Docker loses for three reasons: it works in CI only, it adds a second artefact (an image digest), and its volume and user mapping would need its own work.
2. **Home: `tools/oracle/`**, a standalone build-time tool beside `tools/corpus` (the ADR 0017 precedent). It holds its pin, its cases, its runner and their tests. Later features feed it generated case directories and a manifest through `--manifest`, so they never import it.
3. **The pin lives in `tools/oracle/oracle.yaml` only**, as `{version, sha256}`. The download URL is derived from the version in code. LA-02 governs app code. This is tool configuration, and fixture comments that cite `v26.10.7` source URLs are documentation. Later, when `packages/lang-2610` carries version metadata, the pin moves into a data file in the pack. The tool reads that file by path, which is not an import, so `tools-standalone` still holds, and runs per pack (`--pack 2610`). ADR 0018 records this as a consequence; there is no work now.
4. **Six S1 cases instead of three.** For each direction there is one case copied verbatim from Nextflow's tests (strongest evidence) and one nf-core-shaped case (what F-504 will actually do). The mixed script comes with the flag on and with the flag off. All six cover the three scenarios in step 1. See open point 10.
5. **The run environment is set by the wrapper, not by the user's shell.** It sets `NXF_HOME=<repo>/.cache/nextflow/home`, `NXF_OFFLINE=true`, `NXF_DISABLE_CHECK_LATEST=true`, `NXF_ANSI_LOG=false` and `NXF_SYNTAX_PARSER=v2`. It removes `NXF_VER`, `NXF_EDGE`, `NXF_BASE`, `NXF_DIST`, `NXF_JAR`, `NXF_BIN`, `NXF_URL`, `NXF_LAUNCHER`, `NXF_CLASSPATH`, `NXF_GRAB` and `NXF_PROT`, so an inherited variable can't switch the version or the parser. It keeps `JAVA_HOME`, `NXF_JAVA_HOME` and `NXF_OPTS`.
6. **Downloads go through `curl`** (`curl -fsSL --retry 3 -o <tmp> <url>`). curl is present on GitHub runners and in the sandbox, and it honours `HTTPS_PROXY` and `CURL_CA_BUNDLE`. Node 22's `fetch` ignores the proxy. The file is downloaded to `<dest>.part`, hashed, then renamed and `chmod 0o755`.
7. **No Playwright test.** As with F-003 and F-004, `--grep F-005` finds nothing. The CI `oracle` job run is the end-to-end evidence, and the `notes` say so.

---

## 2. Files

### 2.1 New: `tools/oracle/` (standalone build-time tool)

```
tools/oracle/
  README.md                      ≤10 lines, contains "Build-time tool" (layout test)
  package.json                   @nf-builder/oracle
  tsconfig.json                  copy of tools/corpus/tsconfig.json
  oracle.yaml                    the pin
  cases/
    cases.yaml                   manifest
    s1-typed-calls-legacy/{main.nf,module.nf}
    s1-legacy-calls-typed/{main.nf,module.nf}
    s1-typed-calls-legacy-module/{main.nf,modules/local/legacy_count/main.nf,data/s1.txt}
    s1-legacy-calls-typed-module/{main.nf,modules/local/typed_count/main.nf,data/s1.txt}
    s1-mixed-types-on/main.nf
    s1-mixed-types-off/main.nf
  src/
    paths.ts  pin.ts  nextflow.ts  nextflow-cli.ts  cases.ts  check.ts  run.ts  report.ts  cli.ts  index.ts
  test/
    pin.test.ts  nextflow.test.ts  nextflow-cli.test.ts  cases.test.ts  check.test.ts  run.test.ts  s1-cases.test.ts
```

`package.json`:
```json
{
  "name": "@nf-builder/oracle",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc", "test": "vitest run" },
  "devDependencies": { "@types/node": "22.20.5", "yaml": "2.9.1" }
}
```
`yaml` 2.9.1 is the version F-009 uses. It is already in the ADR 0003 stack. It is a dev dependency, not a runtime one.

`README.md`:
```
# @nf-builder/oracle

Build-time tool (ADR 0011, ADR 0018): runs the pinned Nextflow release as an oracle, locally and in CI. Standalone: it imports no workspace package.

- `oracle.yaml`: the Nextflow version and the SHA-256 of its `nextflow-<version>-dist` release asset. The only place the version is pinned; bump both in their own PR.
- `pnpm nextflow -- <args>`: downloads the asset once into `.cache/nextflow/`, checks its SHA-256 and runs it offline (needs Java 17 to 26). Relative paths resolve from the directory you ran pnpm in.
- `cases/cases.yaml`: one directory per case, with the expected `nextflow lint` and `nextflow run -stub` outcomes and the sources the code follows.
- `pnpm oracle [--case <id>] [--manifest <file>]`: runs each case in a fresh copy under `.cache/oracle/runs/<id>/`, then writes `.cache/oracle/report.md` and `results.json`.
```

`oracle.yaml` (Biome-formatted):
```yaml
# The Nextflow release the oracle runs, locally and in CI (ADR 0018). Nothing else pins the version.
# Bump version and sha256 together, in their own PR. Moves into the 26.10 language pack once the pack
# carries version metadata (ADR 0006, LA-02).
# sha256: of https://github.com/nextflow-io/nextflow/releases/download/v<version>/nextflow-<version>-dist
# (the release publishes no checksum; see docs/research/2026-11-21-spike-s1-typed-legacy-interop.md).
nextflow:
  version: "26.10.7"
  sha256: "<64 lowercase hex: builder fills it from sha256sum of the downloaded file>"
```

#### Exported types and signatures

`src/paths.ts`
```ts
export const REPO_ROOT: string;     // fileURLToPath(new URL("../../..", import.meta.url))
export const TOOL_DIR: string;      // <repo>/tools/oracle
export const PIN_FILE: string;      // <repo>/tools/oracle/oracle.yaml
export const DEFAULT_MANIFEST: string; // <repo>/tools/oracle/cases/cases.yaml
export const CACHE_DIR: string;     // <repo>/.cache
export const NEXTFLOW_CACHE: string;   // <repo>/.cache/nextflow
export const ORACLE_CACHE: string;     // <repo>/.cache/oracle
```

`src/pin.ts`
```ts
export type NextflowPin = { version: string; sha256: string };
/** Reads and validates oracle.yaml. Throws Error("<file>: <problem>") for a missing or non-x.y.z version, or a sha256 that isn't 64 lowercase hex digits. */
export function loadPin(file?: string): NextflowPin;
/** https://github.com/nextflow-io/nextflow/releases/download/v<v>/nextflow-<v>-dist */
export function distUrl(version: string): string;
/** <nextflowCache>/<v>/nextflow-<v>-dist */
export function distPath(version: string, nextflowCache?: string): string;
```

`src/nextflow.ts`
```ts
export type Download = (url: string, dest: string) => void;   // throws on failure
export const curlDownload: Download;                           // spawnSync("curl", ["-fsSL","--retry","3","-o",dest,url]); actionable error if curl is missing
export function sha256File(file: string): string;
export type EnsureOptions = { nextflowCache?: string; download?: Download; log?: (line: string) => void };
/** Returns the absolute path of a verified, executable -dist file. Downloads only when it's missing or its hash differs. Deletes a mismatching download and throws an error naming the expected and actual SHA-256 and the URL. */
export function ensureNextflow(pin: NextflowPin, options?: EnsureOptions): string;
export const DROPPED_ENV: readonly string[];   // NXF_VER, NXF_EDGE, NXF_BASE, NXF_DIST, NXF_JAR, NXF_BIN, NXF_URL, NXF_LAUNCHER, NXF_CLASSPATH, NXF_GRAB, NXF_PROT
export function nextflowEnv(base: NodeJS.ProcessEnv, nextflowCache?: string): NodeJS.ProcessEnv;
export type ExecResult = { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; durationMs: number };
export type Exec = (args: readonly string[], cwd: string) => ExecResult;
/** spawnSync(dist, args, { cwd, env, encoding: "utf8", timeout: timeoutMs ?? 600_000, maxBuffer: 64 MiB }) */
export function nextflowExec(dist: string, env: NodeJS.ProcessEnv, timeoutMs?: number): Exec;
/** Parses "version 26.10.7 build ..." from `nextflow -version` output; null if absent. */
export function parseVersion(output: string): string | null;
```

`src/nextflow-cli.ts` (`pnpm nextflow -- <args>`)
```ts
export type CliDeps = { pin?: NextflowPin; ensure?: (pin: NextflowPin) => string; spawn?: (dist: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => number; env?: NodeJS.ProcessEnv };
/** Drops one leading "--" (pnpm 10 passes it through; see scripts/run-playwright.ts). Runs in env.INIT_CWD ?? process.cwd() with stdio inherited. Returns Nextflow's exit status (1 if killed by a signal). Prints errors to stderr and returns 2 for a bad pin and 3 for a failed download or hash check. */
export function main(argv: readonly string[], deps?: CliDeps): number;
// isMain guard: process.exitCode = main(process.argv.slice(2))
```

`src/cases.ts`
```ts
export type Outcome = "ok" | "error";
export type LintSpec = { expect: Outcome; errors: string[] };                           // errors default []
export type RunSpec = { expect: Outcome; output: string[]; script: string; args: string[] }; // output [], script "main.nf", args ["-stub"]
export type OracleCase = { id: string; dir: string; about: string; spec: string[]; sources: string[]; lint?: LintSpec; run?: RunSpec };
export type Manifest = { file: string; cases: OracleCase[] };
/** A case's directory is <manifest dir>/<id>/. Collects every problem and throws one Error listing them as "<file>: case <id>: <problem>". Problems: unknown keys; an id that isn't kebab-case; duplicate ids; a missing directory; a missing run script; expect other than ok|error; a case with neither lint nor run; empty about, spec or sources. */
export function loadManifest(file?: string): Manifest;
```

`src/check.ts` (pure)
```ts
export type LintMessage = { filename: string; startLine: number; startColumn: number; message: string };
export type LintReport = { errors: LintMessage[]; warnings: LintMessage[] };
/** Finds the JSON object `nextflow lint -o json` prints (from the first line that is exactly "{"); null if there is none or it doesn't parse. */
export function parseLintJson(stdout: string): LintReport | null;
export function stripAnsi(text: string): string;
export type CheckKind = "lint" | "run";
export type Evaluation = { actual: Outcome; matched: boolean; problems: string[]; errors: string[]; warnings: string[] };
/** actual = status 0 ? ok : error. Matched when actual equals expect and every spec.errors text is a substring of some error message. With expect error, a missing JSON report is a problem. Problems quote the first three actual errors. */
export function evaluateLint(spec: LintSpec, result: ExecResult): Evaluation;
/** Matched when actual equals expect and every spec.output text is in stripAnsi(stdout + "\n" + stderr). A problem for an unexpected failure quotes the first line containing "ERROR" or "error". */
export function evaluateRun(spec: RunSpec, result: ExecResult): Evaluation;
```

`src/run.ts`
```ts
export type CheckResult = Evaluation & { caseId: string; kind: CheckKind; command: string[]; expected: Outcome; exitCode: number | null; durationMs: number; logFile: string };
export type RunOptions = { exec: Exec; runsDir?: string; log?: (line: string) => void };
/** rm -rf <runsDir>/<id>, then cpSync(case.dir, ..., { recursive: true }). Returns the run directory. */
export function prepareRunDir(c: OracleCase, runsDir: string): string;
/** In the run directory: lint as ["lint", "-o", "json", "."], then run as ["run", script, ...args], in that order. Writes lint.log and run.log, each holding the command, exit status, duration, stdout and stderr. */
export function runCase(c: OracleCase, options: RunOptions): CheckResult[];
export type OracleRun = { nextflowVersion: string; manifest: string; startedAt: string; results: CheckResult[] };
/** Runs ["-version"] first. If parseVersion differs from pin.version, throws Error("expected Nextflow <pin>, got <actual or 'no version'>"). Then runs every case in order. */
export function runOracle(manifest: Manifest, pin: NextflowPin, options: RunOptions): OracleRun;
```

`src/report.ts`
```ts
/** Markdown: the version line; a table | case | check | expected | actual | exit | result |; then, for each check, the command and a fenced excerpt of the first 60 lines of its output (ANSI stripped), plus lint errors and warnings as a list. */
export function formatReport(run: OracleRun): string;
/** One `::error file=<manifest relative to the repo>,title=Nextflow oracle::<case> <kind>: <problems joined by "; ">` per mismatched check. Same escaping as scripts/check-common.ts githubAnnotation, copied because tools may not import scripts/. */
export function annotations(run: OracleRun, repoRoot: string): string[];
```

`src/cli.ts` (`pnpm oracle`)
```ts
export const USAGE = "Usage: pnpm oracle [--case <id>]... [--manifest <file>]";
export type OracleDeps = { pin?: NextflowPin; ensure?: (pin: NextflowPin) => string; exec?: Exec; env?: NodeJS.ProcessEnv; oracleCache?: string; write?: (line: string) => void };
/** Drops one leading "--". Exit codes: 0 when every check matched; 1 on any mismatch; 2 for usage, manifest or pin errors, or an unknown --case id; 3 when Nextflow can't be obtained or reports the wrong version. Always writes <oracleCache>/report.md and results.json once cases ran. Appends report.md to $GITHUB_STEP_SUMMARY when set. Prints annotations when GITHUB_ACTIONS=true. */
export function main(argv: readonly string[], deps?: OracleDeps): number;
```

`src/index.ts`: re-exports the types and functions above.

### 2.2 S1 fixtures: exact Nextflow code

Rules for every fixture:
- The first line comments cite their source (s1-cases test).
- Every `script:` process has a `stub:`.
- No `container`, `conda` or plugin is used, so `run -stub` needs only bash, coreutils and the local executor.
- Paths use `${projectDir}`, so they don't depend on the working directory.

**(a1) `cases/s1-typed-calls-legacy/main.nf`**: verbatim from `S/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L123-L131`
```nextflow
// Spike S1 (F-005, LA-14): a typed entry workflow calls a legacy process and a legacy workflow from another file.
// Verbatim from Nextflow's test 'should allow typed workflow to call legacy process/workflow':
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L119-L162
nextflow.enable.types = true

include { foo ; bar } from './module.nf'

workflow {
    ch = channel.of(1, 2, 3)
    bar(foo(ch))
}
```
**`cases/s1-typed-calls-legacy/module.nf`**: verbatim from `#L134-L153`
```nextflow
// Spike S1 (F-005): legacy process and workflow (no types flag), verbatim from
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L134-L153
// exec: runs inside Nextflow; with -stub and no stub: section the exec: body runs
// (https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/main/groovy/nextflow/processor/TaskRun.groovy#L876-L878).
process foo {
    input:
    val x

    output:
    val y

    exec:
    y = x * 2
}

workflow bar {
    take:
    ys

    emit:
    ys.map { y -> y % 3 }
}
```

**(b1) `cases/s1-legacy-calls-typed/main.nf`**: verbatim from `#L78-L85`
```nextflow
// Spike S1 (F-005, LA-14): a legacy entry workflow calls a typed process and a typed workflow from another file.
// Verbatim from Nextflow's test 'should allow legacy workflow to call typed process/workflow':
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L74-L117
include { foo ; bar } from './module.nf'

workflow {
    ch = channel.of(1, 2, 3)
    bar(foo(ch))
}
```
**`cases/s1-legacy-calls-typed/module.nf`**: verbatim from `#L87-L108`
```nextflow
// Spike S1 (F-005): typed process and workflow, verbatim from
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L87-L108
// exec: runs inside Nextflow; with -stub and no stub: section the exec: body runs (TaskRun.groovy#L876-L878).
nextflow.enable.types = true

process foo {
    input:
    x: Integer

    output:
    y: Integer

    exec:
    y = x * 2
}

workflow bar {
    take:
    ys: Channel<Integer>

    emit:
    ys.map { y -> y * 2 }
}
```

**(a2) `cases/s1-typed-calls-legacy-module/main.nf`**
```nextflow
// Spike S1 (F-005, LA-14): a typed entry workflow calls an nf-core-shaped legacy process from modules/local/
// and reads its named outputs by assignment, as typed workflows must (no .out).
// Typed calls legacy: https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L119-L162
// Named legacy outputs read as fields: same file #L211-L253. No .out in typed workflows:
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/workflow-typed.mdx#L55 and docs/static-typing-prep.mdx#L64-L80
// channel.fromPath, Path.baseName, view(transform): docs/reference/stdlib-namespaces/channel.mdx#L126,
// docs/reference/stdlib-types/path.mdx#L48, docs/reference/stdlib-types/channel.mdx#L263
nextflow.enable.types = true

include { LEGACY_COUNT } from './modules/local/legacy_count/main.nf'

workflow {
    ch_reads = channel.fromPath("${projectDir}/data/*.txt")
        .map { reads -> [[id: reads.baseName], reads] }
    legacy_out = LEGACY_COUNT(ch_reads)
    legacy_out.txt.view { v -> "txt: ${v}" }
    legacy_out.versions.view { v -> "versions: ${v}" }
}
```
**`cases/s1-typed-calls-legacy-module/modules/local/legacy_count/main.nf`**
```nextflow
// Spike S1 (F-005): a legacy process shaped like an nf-core module (no types flag): tag, tuple input,
// named tuple and path outputs, script and stub. Shape from
// https://github.com/nf-core/modules/blob/bbd7054a060ab558521f3c6601df5323c96362fd/modules/nf-core/fastqc/main.nf#L5-L17 and #L54-L59;
// syntax from https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process.mdx#L646-L664 (tuple input),
// #L1002-L1020 (tuple output), #L1065-L1085 (emit), #L277-L304 (stub).
process LEGACY_COUNT {
    tag "${meta.id}"

    input:
    tuple val(meta), path(reads)

    output:
    tuple val(meta), path("${meta.id}.count.txt"), emit: txt
    path 'versions.txt', emit: versions

    script:
    """
    wc -l < ${reads} > ${meta.id}.count.txt
    echo 'wc' > versions.txt
    """

    stub:
    """
    touch ${meta.id}.count.txt
    touch versions.txt
    """
}
```
**`cases/s1-typed-calls-legacy-module/data/s1.txt`**: two plain lines, `read one` and `read two`.

**(b2) `cases/s1-legacy-calls-typed-module/main.nf`**
```nextflow
// Spike S1 (F-005, LA-14): a legacy entry workflow (no types flag) builds records and calls a typed
// process with a record input from modules/local/, as a pipeline using typed nf-core modules would.
// Legacy calls typed: https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L74-L117
// record(): https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/reference/stdlib-namespaces/global.mdx#L184
// channel.fromPath: docs/reference/stdlib-namespaces/channel.mdx#L126; legacy view: docs/process.mdx#L1065-L1085
include { TYPED_COUNT } from './modules/local/typed_count/main.nf'

workflow {
    ch_samples = channel.fromPath("${projectDir}/data/*.txt")
        .map { reads -> record(id: reads.baseName, reads: reads) }
    TYPED_COUNT(ch_samples).view { v -> "count: ${v}" }
}
```
**`cases/s1-legacy-calls-typed-module/modules/local/typed_count/main.nf`**
```nextflow
// Spike S1 (F-005): a typed process with a destructured record input, one file output, script and stub.
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process-typed.mdx#L12-L27 (flag, single unnamed file output),
// #L145-L165 (destructured record input), #L473-L475 (stub behaves as in legacy processes).
nextflow.enable.types = true

process TYPED_COUNT {
    input:
    record(
        id: String,
        reads: Path
    )

    output:
    file('count.txt')

    script:
    """
    echo '${id}' > count.txt
    wc -l < ${reads} >> count.txt
    """

    stub:
    """
    touch count.txt
    """
}
```
**`cases/s1-legacy-calls-typed-module/data/s1.txt`**: same two lines.

**(c1) `cases/s1-mixed-types-on/main.nf`**
```nextflow
// Spike S1 (F-005, LA-13): one script enables types and defines a typed and a legacy process. Expected to fail:
// https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/static-typing.mdx#L50 ("A script with
// `nextflow.enable.types = true` cannot also contain legacy process or workflow definitions.");
// parser error https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/main/java/nextflow/script/parser/ScriptAstBuilder.java#L585,
// asserted in modules/nf-lang/src/test/groovy/nextflow/script/parser/ScriptAstBuilderTest.groovy#L544-L585.
nextflow.enable.types = true

process TYPED_HELLO {
    input:
    message: String

    output:
    file('hello.txt')

    script:
    """
    echo '${message}' > hello.txt
    """

    stub:
    """
    touch hello.txt
    """
}

process LEGACY_GOODBYE {
    input:
    val message

    output:
    path 'goodbye.txt'

    script:
    """
    echo '${message}' > goodbye.txt
    """

    stub:
    """
    touch goodbye.txt
    """
}

workflow {
    TYPED_HELLO(channel.of('hello'))
    LEGACY_GOODBYE(channel.of('goodbye'))
}
```
**(c2) `cases/s1-mixed-types-off/main.nf`**: the same file without the flag line. Its header comment instead cites `ScriptAstBuilder.java#L664` and `ScriptAstBuilderTest.groovy#L498-L542` ("Typed input declaration is not allowed in legacy process ...").

**`cases/cases.yaml`** (Biome-formatted)
```yaml
# Nextflow oracle cases (ADR 0011, ADR 0018). Each case is the directory <id>/ next to this file.
# pnpm oracle copies it to .cache/oracle/runs/<id>/ and runs the pinned Nextflow (tools/oracle/oracle.yaml) there:
#   lint: nextflow lint -o json .      run: nextflow run <script> <args> (script main.nf, args [-stub] by default)
# expect: ok = exit status 0 (warnings allowed); error = non-zero exit status.
# errors (lint): each text must appear in one reported error message. output (run): each text must appear in stdout or stderr.
# Expectations must match real Nextflow; a PR that changes one says why.
cases:
  # Spike S1 (F-005): typed and legacy code across files, and in one script.
  - id: s1-typed-calls-legacy
    about: A typed entry workflow calls a legacy process and a legacy workflow included from another file.
    spec: [F-005, LA-14, ADR-0007]
    sources:
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L119-L162
    lint: { expect: ok }
    run: { expect: ok }
  - id: s1-typed-calls-legacy-module
    about: A typed entry workflow calls an nf-core-shaped legacy process from modules/local/ and reads its named outputs.
    spec: [F-005, LA-14, ADR-0007]
    sources:
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L211-L253
      - https://github.com/nf-core/modules/blob/bbd7054a060ab558521f3c6601df5323c96362fd/modules/nf-core/fastqc/main.nf#L5-L17
    lint: { expect: ok }
    run:
      expect: ok
      output: ["txt: ", "s1.count.txt", "versions: "]
  - id: s1-legacy-calls-typed
    about: A legacy entry workflow calls a typed process and a typed workflow included from another file.
    spec: [F-005, LA-14, ADR-0007]
    sources:
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nextflow/src/test/groovy/nextflow/script/DataflowTypesTest.groovy#L74-L117
    lint: { expect: ok }
    run: { expect: ok }
  - id: s1-legacy-calls-typed-module
    about: A legacy entry workflow builds records and calls a typed process with a record input from modules/local/.
    spec: [F-005, LA-14, ADR-0007]
    sources:
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/process-typed.mdx#L145-L165
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/reference/stdlib-namespaces/global.mdx#L184
    lint: { expect: ok }
    run:
      expect: ok
      output: ["count: ", "count.txt"]
  - id: s1-mixed-types-on
    about: One script enables types and defines both a typed and a legacy process.
    spec: [F-005, LA-13, ADR-0007]
    sources:
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/docs/static-typing.mdx#L50
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/test/groovy/nextflow/script/parser/ScriptAstBuilderTest.groovy#L544-L585
    lint:
      expect: error
      errors: ["Invalid input declaration in typed process"]
    run:
      expect: error
      output: ["Script compilation failed", "Invalid input declaration in typed process"]
  - id: s1-mixed-types-off
    about: One script without the types flag defines both a legacy and a typed process.
    spec: [F-005, LA-13, ADR-0007]
    sources:
      - https://github.com/nextflow-io/nextflow/blob/v26.10.7/modules/nf-lang/src/test/groovy/nextflow/script/parser/ScriptAstBuilderTest.groovy#L498-L542
    lint:
      expect: error
      errors: ["Typed input declaration is not allowed in legacy process -- set `nextflow.enable.types = true` to use typed processes in this script"]
    run:
      expect: error
      output: ["Script compilation failed", "Typed input declaration is not allowed in legacy process"]
```
How strong each expectation is:
- **Backed by Nextflow's own tests:** a1 and b1 run; lint errors for c1 and c2.
- **Hypotheses:**
  - lint passing on a1, a2, b1 and b2 (inferred from TypeCheckingVisitor's handling of legacy targets);
  - the run on a2 (a list fed to a legacy tuple input from typed code);
  - the run on b2 (`record()` inside a legacy workflow);
  - the console text on a run with a compile error (inferred from ScriptLoaderV2 printing the errors).

Builder runs confirm these locally. If one turns out wrong, that is the spike's finding. **Do not change the fixture to make it pass**; report it to the orchestrator (Task 2 says how).

### 2.3 Changed files

| File | Change |
|---|---|
| `package.json` | Add the scripts `"nextflow": "node tools/oracle/src/nextflow-cli.ts"` and `"oracle": "node tools/oracle/src/cli.ts"`. Neither joins `check`. |
| `pnpm-lock.yaml` | New importer `tools/oracle` (run `pnpm install`). |
| `.gitignore` | `/.cache/` (already on feat/F-009; add it only if F-005 starts before F-009 merges). |
| `test/layout.test.ts` | Add `"tools/oracle"` to the build-time tools `allowed` list (that test arrives with F-009). Rename the test to cite ADR-0018. |
| `test/workflows.test.ts` | Add `oracle` to the job list and `pnpm oracle` to the commands, and raise the block count by one. Add the new test in section 3. |
| `.github/workflows/ci.yml` | New job `oracle` (below). |
| `AGENTS.md` (Commands table; tested by `test/agents-md.test.ts`) | Two rows (exact text below). The other AGENTS.md prose is the orchestrator's (section 5). |

CI job, appended to `ci.yml` after `audit`:
```yaml
  oracle:
    name: Nextflow oracle (ADR 0011)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - uses: actions/setup-java@d1374f8ac74474200d16ef8ecee22c7ae7a51880 # v6.3.0
        with:
          distribution: temurin
          java-version: "21"
      - name: Restore the pinned Nextflow
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: .cache/nextflow
          key: nextflow-v1-${{ hashFiles('tools/oracle/oracle.yaml') }}
      - name: Nextflow version (LA-03)
        run: pnpm nextflow -- -version
      - run: pnpm oracle
      - name: Add the oracle report to the job summary
        if: always()
        run: if [ -f .cache/oracle/report.md ]; then cat .cache/oracle/report.md >> "$GITHUB_STEP_SUMMARY"; fi
      - name: Upload the oracle logs
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: nextflow-oracle
          path: .cache/oracle/
          retention-days: 30
          if-no-files-found: ignore
```
Notes:
- `pnpm oracle` also appends to the job summary when `GITHUB_STEP_SUMMARY` is set. Keep only one of the two: either drop the "Add the oracle report" step, or don't append from the CLI. Recommendation: let the CLI append (it is unit-tested) and drop the YAML step. The workflows test then asserts no summary step.
- The `nextflow -version` step makes the patch number visible in the log, as LA-03 evidence.

AGENTS.md Commands rows (append after `pnpm corpus:fetch`):
```
| `pnpm nextflow -- <args>` | Run the pinned Nextflow (`tools/oracle/oracle.yaml`, Java 17 to 26): downloads the release once into `.cache/nextflow/`, checks its SHA-256, runs offline |
| `pnpm oracle` | After changing Nextflow fixtures, templates or the printer: `nextflow lint` and `nextflow run -stub` on every case in `tools/oracle/cases/cases.yaml`; report in `.cache/oracle/report.md` (CI job `oracle`) |
```

---

## 3. Tests (written first in each task)

Task 1:

| File | Test name | Asserts |
|---|---|---|
| `tools/oracle/test/pin.test.ts` | `F-005 ADR-0018: oracle.yaml pins one Nextflow version (x.y.z) and the 64-hex SHA-256 of its -dist asset` | `loadPin()` on the real file. No version literal in the test. |
| same | `F-005: loadPin names the file and the problem for a missing version, a non-x.y.z version and a malformed sha256` | Temp YAML files. Error message contains the path and the field. |
| same | `F-005: distUrl and distPath derive the release asset URL and the cache path from the version` | `distUrl("1.2.3")` equals `https://github.com/nextflow-io/nextflow/releases/download/v1.2.3/nextflow-1.2.3-dist`; the path ends `/1.2.3/nextflow-1.2.3-dist`. |
| `tools/oracle/test/nextflow.test.ts` | `F-005: ensureNextflow downloads a missing -dist once, verifies its SHA-256 and makes it executable` | Fake `download` writes known bytes; the pin carries their hash. Called once. File mode has `0o100`. Returns `distPath`. |
| same | `F-005: ensureNextflow makes no download when the cached file has the pinned SHA-256` | The download spy is not called. |
| same | `F-005: ensureNextflow deletes a download with the wrong SHA-256 and names the expected and actual hashes and the URL` | Throws. Neither the `.part` nor the final file exists. |
| same | `F-005: ensureNextflow replaces a cached file whose SHA-256 differs from the pin` | Corrupt cache: download called once; the hash now matches. |
| same | `F-005: nextflowEnv runs offline from .cache/nextflow/home with the strict parser and drops variables that could switch the version` | `NXF_HOME`, `NXF_OFFLINE=true`, `NXF_DISABLE_CHECK_LATEST=true`, `NXF_ANSI_LOG=false` and `NXF_SYNTAX_PARSER=v2` are set. Every `DROPPED_ENV` key is absent. `JAVA_HOME`, `NXF_OPTS` and `PATH` are kept. |
| same | `F-005 LA-03: parseVersion reads the version from nextflow -version output` | A sample banner (`      version 26.10.7 build 12345`; a literal in test data is fine) gives `26.10.7`. Text without a version gives `null`. |
| `tools/oracle/test/nextflow-cli.test.ts` | `F-005: pnpm nextflow drops one leading -- and passes the rest to Nextflow in the directory pnpm was started from` | Fake `spawn`: args `["lint","x.nf"]`; cwd = `env.INIT_CWD`; returns the child's status. |
| same | `F-005: pnpm nextflow exits 3 with the reason when the download or hash check fails` | `ensure` throws; exit 3; stderr has the message. |
| `test/layout.test.ts` | `ADR-0003 ADR-0018: every directory under tools/ is a build-time tool ...` | `tools/oracle` allowed. Its README ≤10 lines contains "Build-time tool". |
| `test/agents-md.test.ts` | existing | Covers the two new root scripts once the rows are added. |

Task 2:

| File | Test name | Asserts |
|---|---|---|
| `tools/oracle/test/cases.test.ts` | `F-005: loadManifest applies the defaults (run script main.nf, args [-stub], no errors or output texts)` | Temp manifest plus case directory. |
| same | `F-005: loadManifest reports duplicate ids, unknown keys, a missing case directory, a missing run script and an expect other than ok or error, all in one error` | One throw; the message has five lines, each `<file>: case <id>: ...`. |
| `tools/oracle/test/check.test.ts` | `F-005: parseLintJson reads the nextflow lint -o json report even after other output` | Sample in the shape of CmdLint.groovy#L455-L511, preceded by a launcher line. Gives errors and warnings. Garbage gives `null`. |
| same | `F-005: a lint check matches when the exit status agrees with expect, warnings allowed` | status 0 + expect ok gives matched. status 1 + expect error + JSON with errors gives matched. |
| same | `F-005: a lint check with expect error fails when an expected error text is missing and quotes the actual errors` | problems mention the missing text and the first actual message. |
| same | `F-005: a lint check with expect ok fails on a non-zero exit and quotes the first error` | |
| same | `F-005: a run check finds expected output texts in stdout or stderr, ignoring ANSI codes` | |
| same | `F-005: a run check with expect error fails when Nextflow exits 0` | |
| `tools/oracle/test/run.test.ts` | `F-005: runCase runs lint -o json . then run <script> -stub in a fresh copy under .cache/oracle/runs/<id> and writes lint.log and run.log` | Fake `exec` records `(args, cwd)`. A stale file in the run directory is gone. Logs contain the command, the exit status and the output. |
| same | `F-005 LA-03: the oracle stops before any case when nextflow -version doesn't report the pinned version` | Fake `-version` reports another version. `main` returns 3. No case ran. |
| same | `F-005: pnpm oracle exits 1 on any mismatch, still writes report.md and results.json with the actual outcomes, and prints one GitHub annotation per mismatch under Actions` | Temp `oracleCache` and `GITHUB_ACTIONS=true`. `results.json` has `actual`. The report table has a row per check. Appends to a temp `GITHUB_STEP_SUMMARY`. |
| same | `F-005: --case selects cases by id, and an unknown id is a usage error` | exit 2 plus USAGE. |
| `tools/oracle/test/s1-cases.test.ts` | `F-005 LA-14 ADR-0007: cases.yaml has every S1 scenario with a lint and a run check` | ids `s1-typed-calls-legacy`, `s1-typed-calls-legacy-module`, `s1-legacy-calls-typed`, `s1-legacy-calls-typed-module`, `s1-mixed-types-on`, `s1-mixed-types-off`. Each has `lint` and `run` with args `["-stub"]`. |
| same | `F-005 LA-14 ADR-0007: the cross-file cases include the other file, and only one side enables types` | In each interop case, `main.nf` has `include { ... } from './...'`. Exactly one of the caller and callee files contains `nextflow.enable.types = true`, and the typed one is the caller in `typed-calls-*` and the callee in `legacy-calls-*`. |
| same | `F-005 LA-14 ADR-0007: typed and legacy code across files is expected to pass lint and run -stub` | The four interop cases expect `ok` for both checks. After CI this states the result; if CI showed otherwise, the orchestrator changes this assertion together with LA-14. |
| same | `F-005 LA-13: a script mixing typed and legacy definitions is expected to fail lint and run with the parser's message` | Both mixed cases expect `error`. `errors` holds the ScriptAstBuilder text. |
| same | `F-005: every S1 Nextflow file starts with comments citing the nextflow-io/nextflow source it follows` | The first comment block holds a `https://github.com/nextflow-io/nextflow/blob/v` link. |
| same | `F-005: every S1 process with a script: section has a stub: section, and no S1 file sets container, conda or plugins` | So `run -stub` is offline and container-free. |
| `test/workflows.test.ts` | `F-003 step 1 ADR-0011: ...` (existing, extended) | Job `oracle` is present, the block count is one higher, and `run: pnpm oracle` is present. |
| same | `F-005 ADR-0018: the oracle job sets up Temurin 21, caches .cache/nextflow keyed on oracle.yaml, prints the Nextflow version, runs pnpm oracle and uploads .cache/oracle even on failure` | Regexes on the `oracle` block: `distribution: temurin`, `java-version: "21"`, `hashFiles('tools/oracle/oracle.yaml')`, `run: pnpm nextflow -- -version`, `run: pnpm oracle`, and `if: always()` before the upload with `path: .cache/oracle/`. The SHA-pin test already covers the new `uses:` lines. |

End to end: the CI `oracle` job run. There is no Playwright test, so `pnpm test:e2e -- --grep F-005` matches nothing (say so in `notes`).

---

## 4. Tasks (builder runs; one at a time)

**Precondition:** F-009 is merged and `feat/F-005` branches from the updated `main`. Otherwise, rebase before Task 1 (see open point 9).

### Task 1 (builder): oracle tool skeleton, pin and `pnpm nextflow`
Scope: section 2.1 (`README.md`, `package.json`, `tsconfig.json`, `oracle.yaml`, `src/paths.ts`, `pin.ts`, `nextflow.ts`, `nextflow-cli.ts`, `index.ts`), the root scripts `nextflow` and `oracle` (point `oracle` at `src/cli.ts`, which Task 2 creates; until then add a stub `cli.ts` that prints "pnpm oracle arrives in Task 2" and exits 2), the two AGENTS.md rows, the `test/layout.test.ts` allowed list, and `.gitignore` if needed. Tests from section 3, Task 1, come first.

To fill the pin:
1. Download once with the tool's own code. Put a placeholder sha256 in `oracle.yaml`, run `pnpm nextflow -- -version`, expect the hash-mismatch error, and take the actual hash from the message.
2. Cross-check it with `sha256sum .cache/nextflow/26.10.7/nextflow-26.10.7-dist`.
3. Put the hash in `oracle.yaml` and run again.

Do not use `NXF_VER` anywhere.

Proof:
```
pnpm install && pnpm check
pnpm nextflow -- -version          # first run: downloads, prints "version 26.10.7"
pnpm nextflow -- -version          # second run: no download line; same version
pnpm nextflow -- info              # runs offline, NXF_HOME under .cache/nextflow/home
```

### Task 2 (builder): cases, runner, report, `pnpm oracle` and the CI job
Scope:
- `src/cases.ts`, `check.ts`, `run.ts`, `report.ts` and `cli.ts`;
- the six case directories and `cases.yaml`, exactly as in section 2.2;
- the `oracle` job in `ci.yml`;
- the changes to `test/workflows.test.ts`.

Tests from section 3, Task 2, come first.

Then run `pnpm oracle` locally:
- **Every check matches:** done.
- **A check doesn't match:**
  1. Don't edit the fixture or the expectation.
  2. Copy `.cache/oracle/report.md` and the case's `lint.log` and `run.log` into your hand-back.
  3. Stop. The orchestrator decides (section 5, step 3).

Proof:
```
pnpm install && pnpm check
pnpm oracle                        # exit 0; .cache/oracle/report.md lists 6 cases x 2 checks, all matched
pnpm oracle -- --case s1-mixed-types-on   # exit 0, one case
pnpm biome check tools/oracle .github     # YAML formatted
```

---

## 5. Orchestrator (docs, CI, decisions)

1. **Before Task 1:** write ADR 0018 (below), mark ADR 0011 `Superseded by 0018`, add both to the README index, and update the AGENTS.md prose (below). Commit with Task 1 so the ADR lint, the layout test and the agents-md test stay green.
2. **After Task 2:** run `pnpm check`, commit, push, open the PR, then `gh pr checks --watch`.
3. **After the CI `oracle` job:**
   - `gh run download <run-id> -n nextflow-oracle -D <scratchpad>/oracle-ci`. The job summary holds the same report.
   - **CI agrees with the local run:** fill the report placeholders from `runs/<id>/lint.log` and `run.log` (command, exit status and 5 to 20 relevant lines each), `results.json` and the `nextflow -version` step.
   - **CI disagrees with an expectation** (the job fails, and the artifact still holds the actuals):
     1. Ask the researcher why.
     2. Send the builder a task that sets the expectation to the observed result, plus the matching `s1-cases.test.ts` assertion, and record the change in the report's "Hypotheses vs results" section.
     3. Re-run CI. The final committed expectations must equal reality, so the job is green.
   - **The four interop cases are green:** append the Spike result to ADR 0007, change LA-14 (no new ADR; see open point 8), append the Spike result to ADR 0009 and edit LA-03, all as worded below.
   - **A typed workflow can't call a legacy process across files** (a1 or a2 fail):
     - LA-14 keeps its warning;
     - write a new ADR (`Accepted (agent)`) superseding ADR 0007, after asking the researcher for the "other route" options;
     - the ADR 0007 Spike result says so. Don't invent the route here.
4. Set `features.json` F-005 `passes: true` and append to `notes`: "Verified <date>: CI oracle job run <url> ran lint and run -stub on the six S1 cases ...; no Playwright test, so `--grep F-005` finds nothing; the CI run is the end-to-end evidence." Optionally append to F-504 `notes`: "S1 (F-005): typed may call legacy across files; no LA-14 warning needed." Appending notes passes the scope guard.
5. Add a `progress.md` entry with Decisions: ADR 0018; LA-14; LA-03; the ADR 0007 and 0009 spike results; `.module-info` deferred to F-504. Then the PR template, reviewer and simplifier, and merge.

### ADR 0018 (draft for the orchestrator)
```
# 0018. Run the Nextflow oracle from the pinned release, locally and in CI

- Status: Accepted (agent)
- Date: 2026-11-21

## Context

ADR 0011 uses real Nextflow as an oracle, from the Docker image `nextflow/nextflow:26.10.x`, in CI only. Spike S1 (F-005) is its first user; templates (F-203), the printer (F-110) and exports (F-301, F-404, F-504) follow. On 2026-11-21 the maintainer allowed running Nextflow locally too (AGENTS.md). The agent sandbox has Java 21 and no Docker daemon. Each release ships `nextflow-<version>-dist`, the launcher with the runtime jar appended, which runs offline on Java 17 to 26. The release publishes no checksum.

## Decision

This ADR restates ADR 0011 with the oracle row changed, and supersedes it.

[ADR 0011's table and rules, verbatim, except the Nextflow oracle row:]
| Nextflow oracle | `pnpm oracle` (`tools/oracle`) runs `nextflow lint` and `nextflow run -stub` on a manifest of cases with the pinned release; later features add templates, edit outputs, edited corpus exports and `lint -format` diffs | locally, and CI (`oracle` job) |

- **Pin:** `tools/oracle/oracle.yaml` holds the Nextflow version and the SHA-256 of its `-dist` asset; nothing else names the version. Bumps go in their own PR. When the 26.10 pack carries version metadata the pin moves into the pack and the oracle runs per pack (ADR 0006, LA-02).
- **Entry points:** `pnpm nextflow -- <args>` downloads the asset into `.cache/nextflow/` with curl, checks the SHA-256 and runs it with `NXF_HOME=.cache/nextflow/home`, `NXF_OFFLINE=true`, `NXF_ANSI_LOG=false` and `NXF_SYNTAX_PARSER=v2`, ignoring inherited `NXF_VER` and launcher variables. `pnpm oracle` runs each case in a fresh copy under `.cache/oracle/runs/` and compares the exit status and expected messages with `tools/oracle/cases/cases.yaml`.
- **CI:** the `oracle` job in `ci.yml` sets up Temurin 21 with `actions/setup-java`, caches `.cache/nextflow` keyed on `oracle.yaml`, and uploads `.cache/oracle/` even on failure.
- **Cases:** each case cites the sources its Nextflow code follows. Expectations must match real Nextflow; a PR that changes one says why.
- **Layout:** `tools/oracle` joins ADR 0003's standalone build-time tools.
- **Hosts:** build-time only (ADR 0017's rule): `github.com` release downloads, redirected to `release-assets.githubusercontent.com`.

## Consequences

- Agents check Nextflow code locally before CI; CI and local runs use the same file and flags.
- Docker isn't needed. Java 17 to 26 is needed for the oracle, not for `pnpm check`. The docs oracle (nf-docs, nf-metro) still runs in CI only.
- Renovate doesn't bump the pin; bumping it means a new SHA-256 from a fresh download, cross-checked in CI.
- Offline mode means a case that needs a plugin fails until the oracle pre-fetches plugins; F-203 will meet this first.

## Alternatives

- Docker image `nextflow/nextflow:26.10.7` pinned by digest: CI only (no Docker daemon in the sandbox) and a second artefact to pin.
- `get.nextflow.io` launcher with `NXF_VER`: downloads the framework at first run from an unpinned source.
- `nf-core/setup-nextflow` action: third-party, CI only.
```

### AGENTS.md prose (orchestrator)
- Replace the sentence in the Commands note that ends "F-005 adds a wrapper." with: "Use `pnpm nextflow` and `pnpm oracle`, which run the version pinned in `tools/oracle/oracle.yaml` (ADR 0018)."
- Nextflow knowledge, last bullet: "Nextflow code in templates and fixtures must pass the oracle (`pnpm oracle`, CI job `oracle`: `nextflow lint` and `nextflow run -stub` on 26.10)."
- The line "Nextflow oracle tests always run in CI" stays true.

### ADR 0007: `## Spike result` (if the interop cases are green)
```
## Spike result

2026-11-2X, spike S1 ([report](../research/2026-11-21-spike-s1-typed-legacy-interop.md)), Nextflow 26.10.7: a typed workflow may call a legacy process or workflow included from another file, including an nf-core-shaped module whose named outputs it reads by assignment, and a legacy workflow may call a typed process, including one with a record input. `nextflow lint` and `nextflow run -stub` pass in both directions. A script that enables types and defines a legacy process fails to parse ("Invalid input declaration in typed process"), and so does a typed process without the flag, as this decision assumed. The decision stands: inserting a legacy module into a typed workflow needs no other route, and LA-14 drops its interim warning.
```

### ADR 0009: `## Spike result`
The status line is unchanged; S4 is still open.
```
## Spike result

2026-11-2X, spike S1 ([report](../research/2026-11-21-spike-s1-typed-legacy-interop.md)), Nextflow 26.10.7 source: `.module-info` is a Java properties file (written with `Properties.store`, so a `#<date>` comment line comes first and `:` in values is escaped as `\:`) with two keys: `checksum`, the SHA-256 of the installed module directory without `.module-info`, and `registryUrl`, the URL the bundle was downloaded from. Nextflow writes it on `module install`, uses it as the marker for `module list`, and compares the checksum to detect local changes; without it, `module remove` refuses the folder unless `-force` is given. The checksum comes from `io.seqera:npr-client` (`ModuleChecksum.computeDirectory`), whose file order and normalisation the spike couldn't read. Inserting a module therefore doesn't write `.module-info` yet; F-504 decides once the algorithm is verified with the oracle (`nextflow module list` on a written module).
```
(Open point 7: the last sentence is a decision.)

### LA-14 (proposed, if the interop cases are green)
`| LA-14 | A typed workflow may call a legacy process or workflow included from another file, and a legacy workflow may call a typed one (spike S1, Nextflow 26.10.7). Inserting a legacy registry module into a typed workflow needs no warning. The typed workflow reads the module's outputs by assignment and name (`fastqc_out = FASTQC(...)`, then `fastqc_out.html`), never through `.out`. |`
- The second sentence replaces the interim warning.
- The third follows `docs/workflow-typed.mdx#L55`. It is optional; drop it if the reviewer reads it as new scope.

### LA-03 (proposed)
`| LA-03 | New projects set `manifest.nextflowVersion` to the pack's recommended floor. For 26.10 that is `>=26.10.6` (released 2026-11-12; spike S1 confirmed it and found 26.10.7, 2026-11-20, as the latest patch), per nf-core's guidance on record hashing and the `stage` block. |`

### Report skeleton: `docs/research/2026-11-21-spike-s1-typed-legacy-interop.md`
````
# Spike S1: typed and legacy code across files, `.module-info`, and the latest 26.10 patch

2026-11-21, F-005. Nextflow <!-- FILL: version line from the "Nextflow version (LA-03)" CI step --> run by the oracle (ADR 0018) in CI run <!-- FILL: run URL --> and locally. Sources read at tag v26.10.7, commit 0ad848ef3c3a22824cd9eb2ca14568385867702d.

## Answers

| Question | Answer | Evidence |
|---|---|---|
| Can a typed workflow call a legacy process or workflow from another file? | <!-- FILL: Yes/No --> | cases `s1-typed-calls-legacy`, `s1-typed-calls-legacy-module`; DataflowTypesTest.groovy#L119-L162, #L211-L253 |
| Can a legacy workflow call a typed process or workflow? | <!-- FILL --> | cases `s1-legacy-calls-typed`, `s1-legacy-calls-typed-module`; DataflowTypesTest.groovy#L74-L117 |
| Typed and legacy definitions in one script? | Rejected by the parser <!-- FILL: confirm --> | cases `s1-mixed-types-on`, `s1-mixed-types-off`; static-typing.mdx#L50; ScriptAstBuilder.java#L585, #L664 |
| `.module-info` format | Java properties: `checksum`, `registryUrl` | ModuleInfo.groovy, ModuleStorage.groovy |
| Latest 26.10 patch | 26.10.7 (2026-11-20); 26.10.6 exists (2026-11-12) | tags; CI `-version` step |

## Method
- How Nextflow ran: pinned `-dist` + SHA-256, Java (Temurin 21 in CI, <!-- FILL: local java -version -->), the env from ADR 0018, `lint -o json .` and `run main.nf -stub` in a fresh copy of each case.
- Why `-stub`: no tools or containers needed; `exec:` processes have no stub, so their body runs (TaskRun.groovy#L876-L878).
- Logs: CI artifact `nextflow-oracle` (`runs/<case>/lint.log`, `run.log`, `.nextflow.log`, `report.md`, `results.json`).

## Cases
### s1-typed-calls-legacy (typed workflow → legacy process and workflow, verbatim from Nextflow's test)
Files, source, expected (lint ok, run ok), actual:
```text
<!-- FILL: lint.log, command, exit status, summary line -->
```
```text
<!-- FILL: run.log, command, exit status, last lines -->
```
### s1-typed-calls-legacy-module   (same layout; quote the `txt:` and `versions:` view lines)
### s1-legacy-calls-typed
### s1-legacy-calls-typed-module   (quote the `count:` view line)
### s1-mixed-types-on   (quote the lint JSON error with line and column, and the run's "Script compilation failed" block)
### s1-mixed-types-off

## Hypotheses vs results
<!-- FILL: each expectation that was a hypothesis (section 2.2 of the plan) and what Nextflow did; any expectation changed after a run, and why -->

## Lint warnings seen
<!-- FILL from results.json warnings: anything a typed caller of legacy code triggers (useful for LA-35 and the F-504 UX) -->

## `.module-info`
- Format, keys and an example (values illustrative), with source links: ModuleInfo.groovy#L34, #L44-L72, #L99-L108; ModuleStorage.groovy#L117-L128, #L151-L153, #L166-L200, #L235-L238, #L265-L272; ModuleChecksum.groovy#L39-L41.
- Unknown: the algorithm in io.seqera:npr-client (`computeDirectory`: file order, path separators, which files are included).
- Consequence for F-504 (ADR 0009 Spike result).

## Latest 26.10 patch (LA-03)
v26.10.7, commit 0ad848e…, 2026-11-20 (latest on 2026-11-21); v26.10.6, commit 9dca05a…, 2026-11-12, so the `>=26.10.6` floor exists. No checksum is published for the `-dist` asset; the pin's SHA-256 was computed from the sandbox download and matched the fresh download on the GitHub runner <!-- FILL: yes, and the cache-miss run URL -->.

## Other findings
- The types flag takes effect where it is declared (ScriptAstBuilder.java#L320-L325); LA-12 puts it at the top.
- `nextflow run` warns about type errors that `nextflow lint` fails on (migrations/26-10.mdx#L22), so the oracle must lint, not only run.

## Consequences
ADR 0007 Spike result; LA-14; ADR 0009 Spike result; LA-03; ADR 0018.

## Sources
<!-- the URLs above, all at v26.10.7, plus nf-core/modules@bbd7054 -->
````

---

## 6. Open points

**Ask first / decide and record:**
1. **The local-run permission came through the orchestrator.** It contradicts ADR 0011 (Docker, "run only in CI") and the AGENTS.md line on `main` ("Don't try to run them locally"). feat/F-009's AGENTS.md already records it ("maintainer, 2026-11-21"). The plan supersedes ADR 0011 wholesale with ADR 0018, restating every row with the oracle row changed, because ADR 0001 has no partial supersede. Confirm this, or prefer a narrower ADR that leaves 0011 standing (which AGENTS.md's "supersede it" rule argues against).
2. **New build-time tool directory `tools/oracle`.** This changes the ADR 0003 tools table; it is recorded in ADR 0018, and the layout test's allowed list changes. The alternative is the root `scripts/` plus `test/oracle/`, which avoids the table change. But `scripts/` checkers must run without `pnpm install`, so the manifest would have to be JSON with no citation comments.
3. **Build-time hosts** `github.com` and `release-assets.githubusercontent.com` (ADR 0017's rule).
4. **`.github/workflows/ci.yml` edit:** the new `oracle` job and two new pinned actions (`setup-java` v6.3.0, `cache` v6.1.0). If F-009 pinned `actions/cache` first, reuse its SHA.
5. `yaml` 2.9.1 becomes a dev dependency of `tools/oracle`. There is no runtime dependency, and no stored or exported format changes.
6. **Provenance of the pin's SHA-256.** No checksum is published. The plan trusts the sandbox download and relies on CI's independent first download (a cache miss) getting the same hash. Optional stronger check: `gh api repos/nextflow-io/nextflow/releases/tags/v26.10.7 --jq '.assets[]|select(.name=="nextflow-26.10.7-dist")|.digest'` from CI or wherever the API isn't refused (it is refused in the sandbox for that repo).
7. **`.module-info`:** the format is confirmed, but the checksum algorithm lives in `io.seqera:npr-client` and is unverified. Writing `.module-info` without a correct checksum would make Nextflow treat the module as locally modified. Not writing it means `module list` ignores the module and `module remove` needs `-force`. The proposed ADR 0009 text defers writing to F-504. That is a decision for the orchestrator, and F-504 may need its own research.
8. **LA-14 changes user-visible behaviour** (the warning is dropped). Recommendation: no new ADR. ADR 0007 already made the warning conditional on S1, and ADR 0001 records spike outcomes as a Spike result. Still list it under "Decisions made for the maintainer" in the PR. A superseding ADR is needed only if S1 says no.

**Spec and plan gaps:**

9. **Ordering with F-009.** Both touch `.gitignore` (`/.cache/`), `test/layout.test.ts` (the tools list arrives with F-009), `ci.yml` and the job count in `test/workflows.test.ts`, `pnpm-lock.yaml`, the AGENTS.md Commands and prose, and ADR numbering (F-009 holds 0017, unmerged). Plan: merge F-009 first, then branch F-005 from `main`, with ADR 0018. If F-005 must go first: still use 0018 (the ADR lint has no gap rule), add `/.cache/` and create the tools layout check, then reconcile at F-009's rebase.
10. **Scope:** six cases where step 1 names three scenarios: a verbatim and an nf-core-shaped case per direction, and two mixed variants. Trim to a1, b1 and c1 if you want the minimum. a2 and b2 are what tell F-504 whether real modules work, and that includes the `record()`-from-legacy question.
11. **Expectations that are hypotheses, not Nextflow tests:** lint `ok` on the four interop cases; the a2 and b2 runs; and the run-console text for c1 and c2. If one fails, it is a finding. Changing the fixture to dodge it would hide the answer, so the orchestrator decides; Task 2 forbids the builder to "fix" it.
12. **Not covered by S1 (optional extra cases; not in the feature's steps):**
    - a legacy process declared *before* a mid-file types flag (the parser sets the flag at its declaration; relevant to LA-13);
    - a type error that `lint` fails on and `run` only warns about.
13. **Offline plugins:** later oracle users (templates with nf-schema, F-203) will need plugins fetched in advance. ADR 0018 notes this; nothing to do now.
14. **Testing at the floor:** the oracle runs only the latest patch (26.10.7), not the LA-03 floor (26.10.6). Not required by F-005.
15. **F-009's `tools/corpus/fixtures/fixtures.yaml` lint expectations** are "hypotheses until the oracle confirms" (ADR 0017). Feeding them to `pnpm oracle` is a natural follow-up after both features merge, outside F-005; F-006 or a small task could take it.
16. **CI cost:** the `oracle` job runs on every PR (about 2 to 3 minutes: Java setup, cached download, 12 Nextflow invocations). Path filters would need job-level conditions. Not proposed.
