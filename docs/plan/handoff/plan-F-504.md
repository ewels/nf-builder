# Plan: F-504, insert a registry module

Written by the planner on 2026-11-28 from `origin/main` at `240369b` (F-405 merged), with F-302 read from `origin/feat/F-302` (PR #62, ADR 0064). I read an export of `origin/main` and changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**Steps:** (1) "Drop nf-core/fastqc into a typed template, connect it, export: passes `nextflow lint` (M5 exit)"; (2) "Drop it again: the bundle is not duplicated".

**In scope:**
- `RegistryClient.bundle(name, version)`, snapshot-only, read in the document (F-502 note, ADR 0050).
- Engine command `InsertRegistryModule` (already named in AR-21): writes the bundle to the folder the pack's include rules resolve (`modules/<ns>/<name>/`, IO-32), the pinned `requires` nested under it, and `include { NAME } from '<ns>/<name>'`; reuses a present folder; aliases the include when the name is taken or the process is already called (F-111 note).
- Palette: registry module rows focusable, draggable and Enter-insertable, with the description and the `meta.yml` ports exposed to keyboard users (F-503 note, QA-11, LA-23).
- One add = one undo step with F-301's group, discard rollback, placement and kept viewport (ADR 0060).
- LA-14: no warning for legacy into typed; inserted nodes use `connectionTargets` and `tuple-arity` from F-302 unchanged.
- Read-only: insert refused (F-703 note).
- Registry subworkflows: `registryModuleOf`/`registryFolders` also recognise vendored `subworkflows/<scope>/<name>/` (F-405 note, ADR 0063; open point 7).

**Out of scope:** module details, update available and Make local copy (F-506); plugins (F-505); live bundles (gate off, ADR 0050); binary files in projects (F-407); keyboard port connection (F-701); widening `tuple-arity` (open point 6).

## 1. Findings

### 1.1 Spec and ADRs
- **IO-32:** copy the bundle to `modules/<namespace>/<name>/`, add `include { NAME } from '<namespace>/<name>'`; a module already present is reused, never duplicated.
- **LA-14:** typed may call legacy across files with no warning; tuple inputs as `tuple(...)`; lint doesn't check arity, the connection check does (implemented by F-302 as `tuple-arity`, ADR 0064). The feature text's "warning … if S1 requires it": S1 found it doesn't, so no warning (test asserts its absence).
- **LA-23:** ports from `meta.yml` until inserted, then from the parsed source.
- **ADR 0009 / S1 report:** `.module-info` is Java properties (`checksum`, `registryUrl`); checksum algorithm (`npr-client` `ModuleChecksum.computeDirectory`) unverified, so not written until checked with the oracle. `ModuleStorage.groovy` refreshes it "after vendoring a workflow module's dependencies".
- **ADR 0034 + `packages/lang-2610/src/includes/resolve.ts`:** registry references resolve to `modules/<ref>/main.nf` under `registryBase(from)`: the including script's own directory when it lies under a `modules/` directory, else the root; `meta.yml` required. So a registry subworkflow at `modules/nf-core/bam_applybqsr/main.nf` resolves its `nf-core/gatk4/applybqsr` include to `modules/nf-core/bam_applybqsr/modules/nf-core/gatk4/applybqsr/main.nf`: `requires` must be written nested, not at the root.
- **ADR 0050:** bundles are snapshot-only, read by the document under `${BASE_URL}registry/` (same origin; nothing to `registry.nextflow.io` or `public-cr-prod.seqera.io`, so ADR 0002 and QA-30 hold); workers make no cross-origin requests.
- **ADR 0055:** registry tag = the pack's `scriptInclude` accepts the folder; `local` excluded. **ADR 0063:** `registryModuleOf(path, registry)`; `subworkflows/nf-core/**` left to F-504.
- **ADR 0058:** `ports(name)` returns `SnapshotModulePorts | null`; rows `li.registry-item[data-name]`, "unfocusable and undraggable until F-504".
- **ADR 0060:** `PALETTE_MIME` carries a key; `addFromPalette` = refuse up front, fresh name, create + `AddCall` under one group, `undo(…, {discard: true})` on a refused second half, pending placement keyed `<path>#<workflow>/<NAME>@1`, `addsPending` keeps the viewport; one `aria-live` region.
- **ADR 0064:** `EngineApi.connectionTargets`, `PackLints.tupleArity`, `Port.components`. `tupleArityOf` returns null for a non-`Tuple` source.

### 1.2 Code and fixtures
- `packages/lang-core/src/registry-snapshot.ts`: `SnapshotModuleBundle {format: 1; name; version; checksum; component: string | null; requires: {name, version}[]; files: SnapshotFile[]}`; `SnapshotFile` is `{path, text}` or `{path, base64}`.
- `tools/registry-snapshot/src/files.ts`: bundle at `registry/modules/<name>/<version>.json`, name keeps its `/`; `NAME`, `VERSION` patterns there.
- `packages/sources/src/registry/{snapshot,client,types}.ts`: `createSnapshotClient` holds `index.json` and `ports.json`; `createRegistryClient` delegates `ports` to the snapshot.
- Fixture snapshot (served to e2e by `playwright.config.ts`): `tools/registry-snapshot/test/fixtures/expected/registry/` with `nf-core/fastqc 0.0.0-6d1763b` (legacy process, component `FASTQC`, no requires; files `main.nf`, `meta.yml`, `environment.yml`, two `.conda-lock/*.txt`, `tests/main.nf.test`, `tests/main.nf.test.snap`), `nf-core/bam_applybqsr 0.0.0-df69bf6` (legacy workflow, requires `nf-core/gatk4/applybqsr 0.0.0-6d1763b` and `nf-core/samtools/merge 0.0.0-df69bf6`, both present), `nextflow-io/hello 1.0.0` (typed). No fixture has a `base64` file or `component: null`.
- `packages/lang-2610/test/ast/fixtures/modules/nf-core/fastqc/` holds a real `.module-info` (checksum `b64b18…173a`) written by `nextflow lint`'s install; that tree has no `tests/` and its `meta.yml` differs from the snapshot's, so it is a different release (useful to the checksum research, open point 2).
- Engine: `edit/apply.ts` switch; `edit/commands/create-definition.ts` (include insertion via `includeInsertion`, refusals); `edit/nodes.ts` `includeOf(name, source)` has no alias; `edit/names.ts` `freshName(base, taken)`, `builtinNames`; `edit/commands/add-call.ts` refuses a second call of a process with the alias hint; `edit/guards.ts` AR-24 parse check on every changed file; `files/registry.ts` `registryFolders`; `problems/sections.ts` `registryModuleOf`; `history/labels.ts`.
- Web: `canvas/canvas-store.ts` `addFromPalette` (lines ~1041-1146); `palette/use-palette-add.ts` `paletteAdd`; `palette/palette-drag.ts`; `canvas/workflow-canvas.tsx` drop handler; `registry/registry-lists.tsx` `RegistryRow`; `registry/registry-store.ts` (client under `BASE_URL`).
- Templates: `hello-world` (typed, `SAY_HELLO` output `greeting_file: Path`), `samplesheet-multiqc` (already includes a local `FASTQC`, so an insert there must alias), `blank`.
- `AddCall` writes a bare `FASTQC()`. FASTQC has one input, so lint reports an argument-count error until it is connected: every oracle case below is a connected state.
- e2e helpers: `dragToCanvas`, `projectFiles`, `caseFiles` (`e2e/palette-add.ts`), `moduleRow` (`e2e/registry-snapshots.ts`), `exportZip`, `stripFolder` (`e2e/export.ts`), `createFromTemplate` (`e2e/templates.ts`), `dragConnection`, `handle` (`e2e/connect.ts` on F-302).
- Oracle precedent: `packages/engine/test/edit/oracle-goldens.test.ts` chains commands from a template to a case and compares bytes; `tools/oracle/cases/f601-selectors` shows two alias includes from one source lint clean.

## 2. Design

### 2.1 Flow (one queued task, as ADR 0060)
1. Page refuses up front: no project, read-only, file tab, `version === null` ("<name> is only in the live registry; it can be inserted after the next snapshot."), `component === null` (open point 4).
2. `engine.registryInsertPlan({module, component, target})` → `{revision, folder, present, name, include: "new" | "existing"}` or refusal. `folder` = `dirname` of the `scriptInclude(caller, module)` target. `present`: the target resolves (`kind: "file"`, `module === reference`). A `missing` target whose `path` is `meta.yml` (folder half there), or any existing path under `folder` when not present, is refused: "<folder> exists but isn't a complete registry module." `name`: `component` if it isn't bound in the caller, or bound to this same registry include and not yet called by the target workflow (then `include: "existing"`); else `freshName(component, taken)` with the caller's scope and builtins (`FASTQC_2`).
3. Only when `!present`: `registryClient.bundle(module, version)`, then each `requires` recursively (depth ≤ 8, cycle guard, each pinned version), giving `BundleTree`.
4. `apply({kind: "insertRegistryModule", …}, {group, label: "Insert module nf-core/fastqc"})` then `apply({kind: "addCall", callee: name}, {group})`; on a refused `addCall`, `undo(revision, {discard: true})`. When `present` and `include: "existing"` the first apply is skipped and only `AddCall` runs (one step, same label).
5. Placement, selection, `filesStore.reveal(folder + "/main.nf")` and the live message "Inserted nf-core/fastqc as FASTQC in the entry workflow." / "… reused modules/nf-core/fastqc" when present.

### 2.2 `InsertRegistryModule` (engine, pure)
- Creates every bundle file at `<folder>/<path>` and each required bundle at `<folder>/modules/<req.name>/<path>` (recursively, by `registryBase`); text files only. Paths are checked: relative, no `.`/`..` segments, no `\`, no NUL, not `.module-info`, unique; a bundle with any `base64` file is refused (open point 3). `<folder>` must not exist.
- Adds one include statement per insert: `include { FASTQC } from 'nf-core/fastqc'` or `include { FASTQC as FASTQC_2 } from 'nf-core/fastqc'` (separate statement, as `f601-selectors`), through `includeInsertion`; same "statements outside a workflow" refusal as `createDefinition`.
- AR-24: the guard applies to the caller's edit; bundle files are vendored text like a raw write and are exempt from the parse guard (open point 5). After commit, the model must resolve the new include with no `include-target`, `include-not-parsed` or `include-name` diagnostic, or the command refuses.
- Undo deletes the created files and the include (inverse patches), restoring exact bytes (AR-23).
- No `.module-info` (open point 2).

### 2.3 Palette rows (UX-14, QA-11, LA-23)
- `RegistryRow` for modules holds a `<button>` like F-301's rows: tabbable when the group is open, `draggable`, drag data `registry:<name>` under `PALETTE_MIME`, Enter/Space inserts at the viewport centre; plugin rows unchanged (F-505).
- A visually hidden description: the module description, then "Inputs: (meta, reads). Outputs: html (meta, *.html), …" from `ports(name)` read on first focus or pointer enter (`portsSummary` in `sources/registry/view.ts`); `null` ports → "Ports unknown until inserted."; `version === null` rows `aria-disabled` with the live-only text. In read-only rows stay readable and insert is refused with ADR 0056's message.
- After insertion the node's ports come from the projection (already true); the e2e test asserts the parsed names, not `meta.yml`'s.

### 2.4 Registry subworkflows (F-405 note)
`registryFolders` also tags `subworkflows/<scope>/<name…>/` (scope ≠ `local`) holding `main.nf` and `meta.yml`, module `<scope>/<name>`, so `registryModuleOf` groups their problems and the summary lists them. Registry-inserted subworkflows already live under `modules/` and are found by the existing rule (unit-tested here). Open point 7.

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/sources/src/registry/bundle.ts` | `bundleUrl(snapshotUrl: string, name: string, version: string): string`; `parseBundle(value: unknown, url: string, expected: {name: string; version: string}): SnapshotModuleBundle` (throws `RegistryError("invalid")`); `resolveBundles(client: Pick<RegistryClient, "bundle">, root: SnapshotModuleBundle): Promise<BundleTree>`; `interface BundleTree {bundle: SnapshotModuleBundle; requires: readonly BundleTree[]}` |
| `packages/engine/src/edit/commands/insert-registry-module.ts` | `insertRegistryModule(state: EditState, command: InsertRegistryModule): TextPatch[]` |
| `packages/engine/src/edit/registry-insert-plan.ts` | `interface RegistryInsertRequest {module: string; component: string; target: WorkflowTarget}`; `interface RegistryInsertPlan {revision: number; folder: string; present: boolean; name: string; include: "new" \| "existing"}`; `planRegistryInsert(model, catalogue, includes, request): Omit<RegistryInsertPlan, "revision">` (throws `EditRefusal`) |
| `apps/web/src/registry/registry-insert.ts` | `registryItemKey(name: string): string`; `registryNameOf(key: string): string \| null`; `insertMessage(outcome): string` |
| Tests | section 4 |
| `tools/oracle/cases/f504-insert-fastqc/`, `f504-insert-twice/`, `f504-insert-subworkflow/` | section 4.4 |

### 3.2 Change
- `packages/lang-core/src/edit.ts`: `interface InsertRegistryModule {kind: "insertRegistryModule"; caller: string; module: string; component: string; alias: string | null; bundle: BundleFiles | null}`; `interface BundleFiles {name: string; version: string; files: readonly {path: string; text: string}[]; requires: readonly BundleFiles[]}`; add to `EditCommand`.
- `packages/lang-core/src/registry-snapshot.ts`: export `MODULE_NAME_PATTERN`, `MODULE_VERSION_PATTERN`; `tools/registry-snapshot/src/files.ts` imports them (no rule change; tools already import lang-core types).
- `packages/sources/src/registry/types.ts`: `RegistryClient.bundle(name: string, version: string, options?: RegistryReadOptions): Promise<SnapshotModuleBundle>`; `snapshot.ts` implements it (404/410 → `unavailable` "This registry snapshot has no bundle for <name> <version>."; no in-memory copy, HTTP cache only); `client.ts` delegates to the snapshot; `live.ts` client delegates too; `index.ts` exports `bundleUrl`, `resolveBundles`, `portsSummary`, types.
- `packages/sources/src/registry/view.ts`: `portsSummary(ports: SnapshotModulePorts | null): string`.
- `packages/engine/src/edit/nodes.ts`: `includeOf(name, source, alias: string | null = null)`.
- `packages/engine/src/edit/apply.ts` (switch case), `guards.ts` (exempt created bundle files, open point 5), `history/labels.ts` ("Insert module <module>").
- `packages/engine/src/files/registry.ts`: subworkflow rule (2.4). `problems/sections.ts` unchanged unless the rule needs it.
- `packages/engine/src/service/{service,types}.ts`: `EngineApi.registryInsertPlan(request: RegistryInsertRequest): Promise<RegistryInsertPlan | EngineRefusal>`; `apps/web/src/engine/{expose.ts,engine-client.ts}` list it.
- `apps/web/src/canvas/canvas-store.ts`: extract the shared queue/group/discard/placement body of `addFromPalette` into a local `groupedAdd`; new action `insertFromRegistry(request: {module: string; tab: string; at: Point | null}, session?: number): Promise<PaletteAddOutcome>`; store deps gain `registry: () => Pick<RegistryClient, "index" | "bundle">`.
- `apps/web/src/palette/use-palette-add.ts`: `paletteAdd` routes `registry:` keys to `insertFromRegistry`. `palette-drag.ts` unchanged (key is opaque).
- `apps/web/src/registry/registry-lists.tsx`: module rows as buttons with the hidden description; `registry-store.ts` exposes the client.
- `e2e/registry-snapshots.ts`: `moduleButton(scope, name)`; `e2e/palette-add.ts` `caseFiles(id)` takes the case id (F-301 call updated, same assertion).
- `tools/oracle/cases/cases.yaml`: three cases. `docs/licences.md`: rows for the vendored fastqc, bam_applybqsr, gatk4/applybqsr, samtools/merge copies (MIT).
- Docs: IO-32 (alias, reuse rule, nested requires, binary refusal), LA-23 (where meta.yml ports show), UX-14 (rows insertable), UX-16/UX-03 if open point 7 lands; AR-21 unchanged (already lists `InsertRegistryModule`).

## 4. Tests (write first)

### 4.1 Sources (`pnpm --filter @nf-builder/sources test`), `test/registry-bundle.test.ts`
- "F-504 IO-32 ADR-0050: bundle reads `<snapshot>/modules/nf-core/fastqc/0.0.0-6d1763b.json` from the document's fetch and never a registry host" (recorded fetch; asserts the one URL).
- "F-504: bundle 404 or 410 is `unavailable`; other non-2xx `http`; wrong format, name or version mismatch, a file with neither text nor base64 is `invalid`".
- "F-504: an invalid name or version (`../x`, `NF-core/x`, empty) is refused before any fetch".
- "F-504 IO-32: resolveBundles follows bam_applybqsr's pinned requires to both bundles; a cycle or depth over 8 rejects `invalid`".
- "F-504 ADR-0050: the live and combined clients delegate bundle to the snapshot".
- `registry-view.test.ts` (extend): "F-504 LA-23: portsSummary lists tuple components and output names from meta.yml; null gives 'Ports unknown until inserted.'".

### 4.2 Engine (`pnpm --filter @nf-builder/engine test`)
- `test/edit/insert-registry-module.test.ts` (hello-world template + fixture bundles):
  - "F-504 step 1 IO-32: inserting nf-core/fastqc writes every bundle file under modules/nf-core/fastqc/ byte for byte and adds `include { FASTQC } from 'nf-core/fastqc'`".
  - "F-504 AR-03 ADR-0034: the include resolves with no include diagnostic; the projection's FASTQC ports come from main.nf (LA-23)".
  - "F-504 LA-14: inserting a legacy module into a typed workflow gives no diagnostic beyond those the module file had (no warning)".
  - "F-504 IO-32 ADR-0034: bam_applybqsr's requires are written under modules/nf-core/bam_applybqsr/modules/nf-core/…, and both of its includes resolve".
  - "F-504 IO-32: a bundle path with `..`, a leading `/`, `\\`, `.module-info` or a duplicate is refused and nothing changes".
  - "F-504 open point 3: a bundle with a base64 file is refused with the F-407 message".
  - "F-504 AR-23: one undo after insert + AddCall restores every file byte for byte and removes the folder".
  - "F-504 AR-22: every declaration the insert doesn't target is equivalent" (property test hook, as F-111).
- `test/edit/registry-insert-plan.test.ts`:
  - "F-504 step 2 IO-32: a present folder is reused: `present: true`, no bundle needed".
  - "F-504 F-111: when the workflow already calls FASTQC the plan names FASTQC_2 with a new include".
  - "F-504: included but not yet called gives `include: existing` and the component name".
  - "F-504: in samplesheet-multiqc (local FASTQC included) the plan names FASTQC_2 and folder modules/nf-core/fastqc".
  - "F-504: a folder with main.nf but no meta.yml, or other files in the folder, is refused as incomplete".
  - "F-504 ADR-0034: from a caller under modules/, the folder is nested under the caller's directory".
- `test/edit/oracle-goldens.test.ts` (extend): "template-hello-world -> f504-insert-fastqc" (insert, AddCall, connect `greeting_file` → FASTQC input) and "f504-insert-fastqc -> f504-insert-twice" (insert again, AddCall FASTQC_2, connect); "template-blank -> f504-insert-subworkflow" (insert bam_applybqsr only, no call). Byte-for-byte equal to the case trees.
- `test/files/registry.test.ts` (extend): "F-504 F-405 ADR-0063: `subworkflows/nf-core/<name>/` with main.nf and meta.yml is a registry folder; `subworkflows/local/` and a folder without meta.yml are not; registryModuleOf picks the innermost".
- `test/history/labels.test.ts` (extend): "F-504: the step is labelled 'Insert module nf-core/fastqc'".
- `test/service/*.test.ts` (extend): "F-504 ADR-0043: registryInsertPlan answers at the current revision and refuses with no project".

### 4.3 Web (`pnpm --filter @nf-builder/web test`)
- `test/canvas-store-registry.test.ts`: "F-504 step 1: insertFromRegistry fetches the bundle, applies insert and AddCall under one group and selects FASTQC@1"; "F-504 step 2: a present module fetches nothing and applies AddCall with the alias include"; "F-504 ADR-0060: a refused AddCall is undone with discard; message ends 'Nothing was changed.'"; "F-504 F-703: refused in read-only with no engine or fetch call"; "F-504: `version: null` and `component: null` are refused up front"; "F-504: a bundle fetch failure shows the registry error and changes nothing".
- `test/registry-lists.test.tsx` (extend): "F-504 QA-11 UX-14: module rows are focusable buttons, draggable with `PALETTE_MIME` `registry:<name>`, described by description and ports"; "F-504: Enter inserts at the viewport centre"; "F-504: live-only rows are aria-disabled".
- `test/use-palette-add.test.ts` (extend): "F-504: `registry:` keys route to insertFromRegistry; message names the include and says when the folder was reused".

### 4.4 Oracle (`pnpm oracle`, CI `oracle`)
- `f504-insert-fastqc`: hello-world + fastqc bundle (all files) + include + `FASTQC(greeting_file)`. `lint: {expect: ok}`. `run`: `SAY_HELLO` gives a `Path` to a two-component legacy tuple input, so `-stub` should fail with "Input tuple does not match tuple declaration"; record what the pinned run gives (open point 6).
- `f504-insert-twice`: plus `include { FASTQC as FASTQC_2 } from 'nf-core/fastqc'` and `FASTQC_2(greeting_file)`; `lint: {expect: ok}`; run as above.
- `f504-insert-subworkflow`: blank + bam_applybqsr with nested requires + include, no call; `lint: {expect: ok}` (offline: proves the nested placement resolves in real Nextflow); `run: {expect: ok}`.
- Builder records the actual lint warnings (unused outputs) in `about`; `clean` only if none.

### 4.5 End-to-end (`pnpm test:e2e -- --grep F-504`), `e2e/registry-insert.spec.ts`
- "F-504 step 1 IO-32 LA-14 LA-23: drop nf-core/fastqc into Hello world, connect it, export: the zip equals oracle case f504-insert-fastqc": create from template; drag `moduleButton("nf-core/fastqc")` onto the canvas; node FASTQC@1 shows subtitle nf-core/fastqc and ports `html`, `zip`, `versions_fastqc`; no warning in the palette live region or problems panel about legacy; `dragConnection` greeting_file → FASTQC's input (target not dimmed); `exportZip`, `stripFolder`, compare every entry except `.nf-builder/layout.json` with the case tree byte for byte.
- "F-504 step 2 IO-32: dropping it again reuses the bundle": drop again; files under `modules/nf-core/` are the same paths and bytes; no `modules/nf-core/fastqc_2`; node FASTQC_2@1; connect; project files equal `f504-insert-twice`; one Undo removes only the second insert; a second Undo after the first connect's undo removes the folder.
- "F-504 QA-11: Enter on a focused module row inserts at the viewport centre".
- "F-504 F-703: read-only refuses insert" (row Enter at a narrow width gives ADR 0056's message).
- "F-504 QA-30: insert logs no CSP violation at top level and in a cross-origin iframe" (`watchForCspViolations`).

## 5. Tasks

Branch `feat/F-504`. `pnpm format` and `pnpm check` before every commit. Settle section 6 first. Tasks 1-5 don't need F-302; tasks 7-8 need it merged (merge `main` into the branch first).

1. **Bundle client.** Patterns in lang-core, `bundle.ts`, `bundle` on the clients, `portsSummary`, tests 4.1. Done: `pnpm --filter @nf-builder/sources test`, `pnpm --filter @nf-builder/registry-snapshot test`, `pnpm check`.
2. **Command.** lang-core types, `includeOf` alias, `insertRegistryModule`, guard exemption, label, tests in 4.2 for the command. Done: `pnpm --filter @nf-builder/engine test`, `pnpm check`.
3. **Plan call.** `planRegistryInsert`, `EngineApi.registryInsertPlan`, expose/client wiring, tests. Done: same plus `pnpm --filter @nf-builder/web test`.
4. **Oracle cases and goldens.** Three case trees (generated by the golden chain, then committed), `cases.yaml`, licences rows, golden tests. Done: `pnpm --filter @nf-builder/engine test`, `pnpm oracle` (local Java, ADR 0018) or the CI `oracle` job green.
5. **Registry subworkflows.** `registryFolders` rule, tests; re-run F-405's e2e and update its counts if the rule moves rnaseq's subworkflow files under "Registry modules" (record in the ADR; not a weakening). Done: `pnpm check`, `pnpm test:e2e -- --grep "F-405|F-210"`.
6. **Store and palette.** `groupedAdd` refactor, `insertFromRegistry`, `paletteAdd` routing, row buttons and descriptions, web tests. Done: `pnpm --filter @nf-builder/web test`, `pnpm test:e2e -- --grep "F-301|F-503|F-502|F-204"` (with `PW_CHROMIUM_EXECUTABLE`).
7. **End-to-end.** `e2e/registry-insert.spec.ts` and helpers. Done: `pnpm test:e2e -- --grep F-504`, `pnpm smoke` under 60 s, `pnpm build && pnpm check:budget && pnpm check:hosts` (QA-01; IO-41).
8. **Records** (section 7). Done: `pnpm check`.

## 6. Open points (none decided here)

1. **F-302 as a dependency.** Step 1 connects on the canvas, which is F-302's UI. **Recommend:** add F-302 to `depends_on` in this PR (`scope-change` label); start tasks 1-6 now.
2. **`.module-info`.** **Recommend:** don't write it in F-504; ask the researcher for one bounded attempt to reproduce `ModuleChecksum.computeDirectory` (the F-102 fixture gives a real directory/checksum pair; `nextflow module list` in the oracle confirms). If verified, a follow-up writes it (its `#<date>` line also needs a fixed-time rule for byte goldens). Record the outcome in ADR 0009's spike section via the new ADR. Related: whether `module install` writes `tests/` (the F-102 tree has none). **Recommend:** write every bundle file ("copies its bundle", IO-32) unless the researcher shows install filters some.
3. **Bundles with `base64` files** (ADR 0045 stores text only; F-407 deferred). **Recommend:** refuse the insert, naming the file ("…can't be inserted yet: <path> isn't text (F-407)"); ask the researcher how many snapshot modules this hits. Alternative: skip and list (the module may then not run).
4. **`component: null`.** **Recommend:** row `aria-disabled`, refuse with "The registry doesn't say which name nf-core/x defines." Alternative: parse `main.nf` after writing and include its only process.
5. **AR-24 for bundle files.** A bundle our parser can't fully parse would block insertion. **Recommend:** exempt created bundle files from the parse guard (they are vendored, like raw writes, ADR 0004) and keep it for the caller's edit; amend AR-24's text via the ADR. Alternative: keep the guard and refuse.
6. **Non-tuple source into a legacy tuple input.** `tuple-arity` (ADR 0064) is silent for a `Path` into FASTQC's two-component input, so step 1's connection lints clean but fails at run. **Recommend:** keep F-504's step as written (lint only), record the run failure in the oracle cases, and append a note to F-302 / add a small feature to widen `tuple-arity` to known non-`Tuple` sources. Alternative: widen it here (scope creep, and step 1's edge turns red).
7. **Registry subworkflows (F-405 note).** **Recommend:** treat `subworkflows/<scope>/<name>/` (scope ≠ `local`, with `main.nf` and `meta.yml`) as registry folders, amending ADRs 0055 and 0063 and UX-16/UX-03; F-405's rnaseq e2e counts change accordingly. Alternative: leave nf-core-tools layouts out and only rely on registry inserts living under `modules/`.
8. **Reuse when the present folder is a different version.** No `.module-info`, so the version isn't known. **Recommend:** reuse whatever is present, never overwrite; the message says it was reused; version checks wait for F-506.
9. **Alias form.** **Recommend:** a separate `include { FASTQC as FASTQC_2 } from 'nf-core/fastqc'` statement (proven by `f601-selectors`), not a second entry in the existing include.
10. **Where meta.yml ports show (LA-23).** **Recommend:** the palette row's hidden description and title, loaded on first focus or hover. Alternative: a details popover (more UI, belongs with F-506).

**AGENTS.md decide-and-record items:**
- **Spec / user-visible behaviour:** IO-32, LA-23, UX-14 (and UX-16, UX-03 with point 7), AR-24 (point 5): new ADR.
- **ADR amendments:** 0043 (`registryInsertPlan`), 0050/0058 (`bundle`), 0055/0063 (point 7), 0060 (registry keys through the palette add), 0009 spike result (point 2 outcome).
- **`features.json` beyond `passes`/notes:** point 1 (`scope-change`).
- **Package boundary (minor):** patterns moved into lang-core and imported by `tools/registry-snapshot`; no dependency-cruiser rule change expected.
- **None:** runtime dependencies, stored or exported formats (bundle files are ordinary project files; no `.module-info`), workflows, `open-questions.md`.

## 7. Records (drafts for the orchestrator)
- **ADR** `Accepted (agent)`, next free number at landing: "Insert registry modules from the snapshot as vendored folders with nested requires, reuse present folders, alias repeated includes". Row in `docs/adr/README.md`.
- **`features.json`:** F-504 notes "Verified <date>: steps 1-2 by `e2e/registry-insert.spec.ts`, oracle cases f504-*; ADR 00xx", `passes: true`; notes on F-506 (version of a reused folder, `.module-info`), F-407 (binary bundle files), F-302 or a new feature (point 6).
- **`progress.md`:** entry with the ADR, spec changes, licences rows, and any `@visual` re-approval (palette rows gain focus styles; re-approve from CI, ADR 0021).
- **`docs/research/upstream-bugs.md`:** only if the researcher finds a doc gap on install layout or the checksum.
- **Handoff README:** settle the points under "F-504"; delete this plan in the PR that merges F-504.

## 8. Evidence
- Feature: `docs/plan/features.json` F-504 (notes from F-005, F-105, F-501, F-112, F-203, F-502, F-703, F-503, F-301, F-111, F-405; F-302's note on `origin/feat/F-302`).
- Spec: `docs/spec/data-and-io.md` IO-32; `docs/spec/language.md` LA-14, LA-23; AR-21, AR-24 read for context.
- ADRs 0009 (spike results), 0034, 0050, 0055, 0058, 0060, 0063; 0064 on `origin/feat/F-302`; `docs/research/2026-11-22-spike-s1-typed-legacy-interop.md`.
- Nextflow syntax used: registry include `include { FASTQC } from 'nf-core/fastqc'` (F-102 fixture `include-registry.nf`, oracle-linted), alias include (`f601-selectors`); everything new is proved by the f504 oracle cases.
