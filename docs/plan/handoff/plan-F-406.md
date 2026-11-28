# Plan: F-406, export all projects to one backup zip and import it back

Written by the planner on 2026-11-28 from `origin/main` at `3e28b72` (F-404 merged). I read an export of `origin/main` and changed nothing except this file. Paths are relative to the repository root.

## 0. Scope

**Step:** "Export all, clear storage, import the backup: every project restored with layout".

**In scope:**
- **Backup format v1** (new exported format, IO-04): a zip with a manifest at the root and one folder per project (F-404 note), carrying each project's `ProjectMeta` (including `source`, ADR 0057) and every stored file, the layout sidecar always included (ADR 0008).
- **"Export all projects"**: worker reads every stored project after flushing autosave, zips them with the F-404 writer, page downloads.
- **"Import"**: the header's Import button (disabled since F-202, left for F-406 by ADR 0062) is enabled; a zip that holds a backup manifest is restored as projects. Limits and text check reused, ignore list bypassed (F-403 note).
- **Forward-compatibility rules** for the format (section 2.2).
- **Read-only:** Export all and Import stay hidden below 1024 px (ADR 0056).

**Out of scope:**
- Binary files in projects or backups (F-407, deferred schema v2).
- Merging or replacing projects by id; selective restore of some projects (open point 4).
- Restoring a backup by dropping it on the canvas (F-210's add flow treats it as files; open point 9).
- Re-import limit checks at single-project export (ADR 0062 consequence stands).
- Settings or column widths (no settings store yet, ADR 0045).

## 1. Findings

### 1.1 Spec and ADRs
- **IO-04** says only: "'Export all projects' downloads one zip of every project as a backup. 'Import' accepts that zip back." It fixes neither the layout, the metadata, where the control lives, the file name, what happens to projects already stored, nor which limits apply. All of those are decided here (section 2, section 6).
- **ADR 0045:** schema v1, `projects` keyed by `id` (`{id, name, languageVersion, createdAt, updatedAt, openedAt}`), `files` keyed by `[projectId, path]`, text only; one transaction per create; duplicate names allowed; the backup is the way to move projects to another origin.
- **ADR 0053:** limits 200 MB zip, 20,000 entries, 200 MB uncompressed, 1 MB per text file, 30 s; binary and over-1-MB files skipped and listed; one top folder stripped when every entry is under it; staging in the worker, one stage at a time.
- **ADR 0057:** `ProjectMeta.source` is `{kind: "github", repo, ref, sha}` or `{kind: "zip", name, sha256?}`; "an additive optional field doesn't bump the schema version; anything an older build would misread does". The same rule is the natural one for the backup manifest.
- **ADR 0062:** `zipProject(files, {folder})`, `exportSlug`, `exportFileName` in `@nf-builder/sources/export`; Unix modes (`bin/`, `resources/usr/bin/` 0755); every entry's time is export time; `downloadBytes` with a 60 s revoke; "F-406 reuses `zipProject` and `exportFileName`, with one folder per project"; "Header Import stays disabled; IO-04's Import belongs to F-406".
- **ADR 0056:** Export hidden in read-only for v0.1 (F-404 and F-406); the store's `create` is refused in read-only.

### 1.2 Code on main
- `apps/web/src/workspace/workspace.ts`: `serial` queue; `flushAll`; `exportProject` reads the engine; `createProject`/`importProject` validate name (`normaliseProjectName`) and pack (`installedPackVersions`). Stage via `createImportStager` (`import-stage.ts`), which calls `readZip` and keeps `ZipRead.candidates`.
- `apps/web/src/workspace/project-db.ts`: `listProjects`, `readProject(id)`, `createProject(meta, files)` (one tx each). No bulk read or bulk create.
- `packages/sources/src/export/zip-project.ts`: `zipProject` builds the `Zippable` inline; `exportMode(path)` is exported from the file but not from the subpath index.
- `packages/sources/src/zip/read-zip.ts`: `readZip(bytes)` applies every IO-12 limit to the whole zip and returns candidates with text or a skip reason; the ignore list is applied later in `select.ts`, so bypassing it needs no reader change.
- `apps/web/src/shell/app-header.tsx`: Import is `<button disabled>`; `apps/web/test/app-shell.test.tsx` line 39 asserts it ("Import stays disabled until F-406"). The static render has storage `starting`, so Import stays disabled there; the comment changes, the assertion doesn't weaken.
- `apps/web/src/engine/expose.ts` transfers `exportProject`'s bytes; `engine-client.ts` lists every method by hand: both need the new calls.
- e2e: `exportZip`, `stripFolder` (`e2e/export.ts`), `importZip` (local to `export.spec.ts`), `readStoredDatabase`, `readFile`, `switcher` (`e2e/projects.ts`), `nodePosition`, `dragNode`, `readSidecar`, `waitSaved`, `SIDECAR` (`e2e/layout.ts`), `createFromTemplate` (`e2e/templates.ts`), `watchForCspViolations` (`e2e/csp.ts`).

## 2. Design

### 2.1 Backup zip layout (format v1)
```
nf-builder-backup.json          manifest, UTF-8 JSON, 0644
<folder-1>/<project files…>     one folder per project, modes as ADR 0062
<folder-2>/…
```
- **Folders:** `exportSlug(name)`, de-duplicated case-insensitively with `-2`, `-3`… in manifest order, and never equal (any case) to the manifest's name. The manifest at the root keeps IO-11's strip rule from firing; a backup re-zipped under one folder still reads, because the strip leaves the manifest at the root.
- **Files:** every stored file, `.nf-builder/layout.json` included, byte for byte (`TextEncoder` of the stored text), via the same entry builder as `zipProject`.
- **Manifest v1:**
  ```json
  { "format": "nf-builder-backup", "version": 1, "createdAt": "2026-11-28T10:00:00.000Z",
    "projects": [ { "folder": "Hello world", "id": "…", "name": "Hello world", "languageVersion": "26.10",
                    "createdAt": 1764320000000, "updatedAt": 1764320000000, "openedAt": 1764320000000,
                    "source": { "kind": "zip", "name": "x.zip", "sha256": "…" } } ] }
  ```
  Order: projects as `listProjects` returns them (most recently opened first). `source` only when set.
- **File name:** `nf-builder-backup-YYYY-MM-DD.zip` (local date; open point 3).

### 2.2 Reading rules and forward compatibility
- A zip is a backup when, after IO-11's strip, a candidate at `nf-builder-backup.json` parses as a JSON object with `format === "nf-builder-backup"`. Anything else (no such file, not JSON, another `format`) is an ordinary zip import, unchanged.
- `version` is a positive integer. `version > 1` refuses the whole zip: "This backup was made by a newer nf-builder. Reload to update, then import it again." Nothing is stored.
- **Additive optional fields don't bump `version`; anything an older reader would misread does** (ADR 0057's rule). Readers ignore unknown fields at every level.
- Per project: `folder` must be a single safe path segment (`entryPath` kind `file`/`folder`, no `/`), unique case-insensitively, else the manifest is invalid ("This backup's manifest is damaged.") and nothing is stored. `name` goes through `normaliseProjectName` (invalid becomes `Restored project`); missing or non-finite times become the restore time; `id` is informational only.
- `source` is validated as ADR 0057 shapes (`github`: non-empty `repo`, `ref` string or null, 40-hex `sha`; `zip`: string `name`, optional 64-hex `sha256`). An unknown `kind` or a bad shape is dropped and noted in the report; the project still restores.
- A project whose `languageVersion` has no installed pack is skipped and listed ("needs Nextflow X, which this version doesn't have").
- Files under a listed folder belong to it (folder prefix removed); files elsewhere (other folders, other root files) are listed as "Not in the backup's manifest" and not stored. A listed folder with no files restores as an empty project.
- Limits and text check: `readZip` as it is (whole zip: 200 MB, 20,000 entries, 200 MB uncompressed; 1 MB per file; binary skipped). Skipped files are listed per project. The ignore list is not applied (F-403 note).

### 2.3 Restore semantics
- Every restored project gets a new id; name, language version, `createdAt`, `updatedAt`, `openedAt` and `source` come from the manifest. Existing projects are never changed; duplicates are allowed (ADR 0045). Open point 4.
- All restored projects are written in **one** IndexedDB transaction: all or nothing (quota errors leave no half restore).
- After restore: the project list refreshes; if no project is open, the restored project with the latest `openedAt` opens; a report dialog lists restored projects and anything skipped. Session-only, like F-401's report.

### 2.4 Export all
- Worker, inside `serial`: `flushAll()`; if the save state is `failed`, refuse "Couldn't save the open project first: <error>". Then `readAllProjects()` in one readonly transaction, so the backup is one consistent snapshot. Page calls `flushEdits()` first, as F-404.
- No projects: refuse "No projects to export."
- `backupStats()` gives projects, files (+1 manifest), and UTF-8 bytes; the dialog warns (and still exports) when the backup would exceed an import limit, since a backup that can't be restored is silent data loss (open point 5).

### 2.5 UI
- **Switcher** gains "Export all projects…" after Delete, enabled when at least one project is stored, with or without an open project; not rendered in read-only. Open point 2.
- **Export all projects dialog:** title "Export all projects"; shows the file name, "N projects, M files"; limit warnings ("This backup has more than 20,000 files, so it can't be imported back in one go." and the 200 MB equivalent); note "Files skipped when projects were imported aren't in the backup." when any project has `source`; "Preparing the zip…"; inline failure "Couldn't export the projects: <message>"; success closes and returns focus.
- **Header Import:** enabled when storage is ready; opens the New project dialog on the Import route, Zip file source (as Templates opens the template route). Open point 1.
- **Backup in the Import route:** when the stage carries a backup, the dialog title reads "Restore backup", the name field, ignore list and Publish docs are hidden, the summary lists each project (name, Nextflow version, files) and skipped groups, and the primary button reads "Restore N projects" (N restorable). Refusals reuse `importErrorMessage`.

## 3. Files

### 3.1 Create
| Path | Exports |
|---|---|
| `packages/sources/src/backup/format.ts` | `BACKUP_MANIFEST = "nf-builder-backup.json"`, `BACKUP_FORMAT = "nf-builder-backup"`, `BACKUP_VERSION = 1`; `type BackupSource = {kind: "github"; repo: string; ref: string \| null; sha: string} \| {kind: "zip"; name: string; sha256?: string}`; `interface BackupProject {folder; id; name; languageVersion; createdAt; updatedAt; openedAt; source?: BackupSource}`; `interface BackupManifest {format: typeof BACKUP_FORMAT; version: number; createdAt: string; projects: readonly BackupProject[]}`; `backupFolders(names: readonly string[]): string[]`; `backupFileName(date: Date): string`; `validSource(value: unknown): BackupSource \| null`; `parseBackupManifest(text: string): {kind: "backup"; manifest: BackupManifest; droppedSources: readonly string[]} \| {kind: "not-backup"} \| {kind: "newer"; version: number} \| {kind: "damaged"; message: string}` |
| `packages/sources/src/backup/zip-backup.ts` | `interface BackupInput {meta: Omit<BackupProject, "folder">; files: readonly ExportEntry[]}`; `zipBackup(projects: readonly BackupInput[], options: {now: Date}): {bytes: Uint8Array; files: number}` |
| `packages/sources/src/backup/read-backup.ts` | `interface RestoredProject {entry: BackupProject; files: readonly ImportedFile[]; skipped: readonly SkipGroup[]}`; `interface BackupRead {manifest: BackupManifest; projects: readonly RestoredProject[]; unlisted: readonly string[]; droppedSources: readonly string[]}`; `readBackup(read: ZipRead): BackupRead \| ImportRefusal \| null` (null: not a backup) |
| `packages/sources/test/backup/format.test.ts`, `zip-backup.test.ts`, `read-backup.test.ts`, `read-backup-fuzz.test.ts` | section 4 |
| `apps/web/src/workspace/backup.ts` | `exportAllProjects(deps): Promise<BackupExportResult \| EngineRefusal>`, `backupStatsOf(projects)`, `restoreFromStage(...)`; keeps `workspace.ts` small |
| `apps/web/src/project/export-all-dialog.tsx` | `ExportAllDialog(props: {stats: () => Promise<BackupStats>; onExport: () => Promise<void>; onClose: () => void})` |
| `apps/web/src/import/backup-summary.tsx` | `BackupSummaryView(props: {backup: BackupSummary})`, `BackupReportDialog(props: {report: RestoredBackup; onClose})` |
| `apps/web/test/backup.test.ts`, `export-all-dialog.test.tsx`, `backup-summary.test.tsx` | section 4 |
| `e2e/backup.spec.ts`, `e2e/backup.ts` | section 4; `e2e/backup.ts`: `exportAll(page): Promise<ExportedZip>`, `clearStorage(page)`, `restoreBackup(page, path, expected: number)` |

### 3.2 Change
- **`packages/sources/src/export/zip-project.ts`:** extract `addEntries(zippable: Zippable, folder: string, files: readonly ExportEntry[], mtime: number): void`, used by `zipProject` and `zipBackup` (bytes unchanged; F-404 tests guard it).
- **`packages/sources/src/export/index.ts`:** export `zipBackup`, `backupFileName`, `BACKUP_MANIFEST`, types. **`src/import/index.ts`:** export `readBackup`, `parseBackupManifest`, types. **`src/index.ts`:** types only, if the page needs `BackupSummary`. No new subpath, no `package.json` change.
- **`packages/sources/src/import/types.ts`, `messages.ts`:** `ImportRefusalCode` gains `"newer-backup"` and `"damaged-backup"` with their messages.
- **`apps/web/src/workspace/types.ts`:** `ProjectSource` becomes an alias of `BackupSource`'s shape or stays and is asserted equal by a type test (open point 7); `BackupSummary {createdAt: string; projects: readonly {name: string; languageVersion: string; files: number; bytes: number; problem: string \| null}[]; skipped: readonly SkipGroup[]; unlisted: number; droppedSources: number}`; `ImportStageResult` ok branch gains `backup: BackupSummary \| null`; `BackupStats {projects: number; files: number; bytes: number; overFiles: boolean; overBytes: boolean}`; `BackupExportResult {ok: true; fileName: string; bytes: Uint8Array; projects: number; files: number}`; `RestoredBackup {projects: readonly ProjectMeta[]; skipped: readonly {name: string; reason: string}[]; files: readonly SkipGroup[]; unlisted: readonly string[]; droppedSources: readonly string[]}`; `WorkspaceApi` gains `backupStats(): Promise<BackupStats>`, `exportAll(): Promise<BackupExportResult \| EngineRefusal>`, `restoreBackup(id: string): Promise<RestoredBackup>`.
- **`apps/web/src/workspace/project-db.ts`:** `readAllProjects(): Promise<{project: ProjectMeta; files: ProjectFile[]}[]>` (one readonly tx); `createProjects(list: readonly {meta: ProjectMeta; files: readonly ProjectFile[]}[]): Promise<void>` (one readwrite tx).
- **`apps/web/src/workspace/import-stage.ts`:** after `readZip`, `readBackup`; a `newer`/`damaged` result is the stage's refusal; `Stage.backup`; `restage` keeps `backup`; new `backup(id): Promise<BackupRead \| ImportRefusal>`.
- **`apps/web/src/workspace/workspace.ts`:** wire the three calls; `createProject` refuses a backup stage ("This zip is a backup. Restore it instead.").
- **`apps/web/src/engine/expose.ts`, `engine-client.ts`:** add the calls; transfer `exportAll`'s bytes.
- **`apps/web/src/project/project-store.ts`:** `ProjectDialog` gains `{kind: "export-all"}`; actions `exportAll()`, `restoreBackup(id)` (refused in read-only), state `backupReport: RestoredBackup \| null`, `closeBackupReport()`.
- **`apps/web/src/project/project-switcher.tsx`, `project-controls.tsx`:** item and dialog wiring. **`zip-import.ts`:** `ready` state carries `backup`. **`new-project-dialog.tsx`:** backup mode (section 2.5).
- **`apps/web/src/shell/app-header.tsx`** (+ its caller): `onImport`, `canImport`; button enabled when `canImport`.
- **`apps/web/test/app-shell.test.tsx`:** comment at line 39 now "Import is disabled until storage is ready (F-406)"; assertion unchanged.
- **`e2e/export.spec.ts`:** move `importZip` into `e2e/export.ts` for reuse (no behaviour change).
- **Docs:** IO-04 text, UX-01 (Import opens the Import route), UX-60 (backup restore), UX-62 or a new UX row for the Export all dialog; ADR 0045's switcher list via the new ADR.
- **Unchanged:** IndexedDB schema (still v1, no migration), runtime dependencies, dependency-cruiser rules, package exports, workflows, AGENTS.md command table.

## 4. Tests (write first)

### 4.1 Sources unit (`pnpm --filter @nf-builder/sources test`)
- `format.test.ts`
  - "F-406 IO-04: backupFolders slugs names and de-duplicates case-insensitively (`A`, `a`, `A` give `A`, `a-2`, `A-3`)".
  - "F-406 IO-04: no folder equals the manifest's name in any case".
  - "F-406 IO-04: backupFileName is nf-builder-backup-YYYY-MM-DD.zip".
  - "F-406 forward compatibility: a v1 manifest with unknown fields at every level parses and ignores them".
  - "F-406 forward compatibility: version 2 is `newer`; version 0, a string or a missing version is `damaged`".
  - "F-406: other JSON, another `format`, or non-JSON is `not-backup`".
  - "F-406 ADR-0057: an unknown source kind or a bad sha is dropped and listed; a valid github and zip source (with and without sha256) are kept".
  - "F-406: a folder with `/`, `..`, a control character, or a case-insensitive duplicate makes the manifest `damaged`".
- `zip-backup.test.ts`
  - "F-406 IO-04 ADR-0062: the manifest sits at the root and every project's files under its own folder, byte for byte, BOM and CRLF kept".
  - "F-406 IO-02 ADR-0008: `.nf-builder/layout.json` is always in the backup".
  - "F-406 ADR-0062: `bin/` and `resources/usr/bin/` entries are 0755 per project folder, others and the manifest 0644" (uses `centralEntries`).
  - "F-406 ADR-0057: the manifest carries each project's meta and source; a project without source has no `source` key".
  - "F-404: zipProject's entries are unchanged by the shared helper" (existing tests stay green; add one comparing entry names and modes before and after).
- `read-backup.test.ts`
  - "F-406 IO-04: zipBackup then readZip then readBackup returns every project, its meta and its files".
  - "F-406 IO-11: a backup re-zipped under one top folder still reads".
  - "F-406 F-403 note: the ignore list isn't applied: `results/x.txt` and `work/a` are restored".
  - "F-406 IO-12: binary and over-1-MB files are skipped and listed under their project".
  - "F-406 IO-12: a backup over 20,000 entries is refused like any zip".
  - "F-406: files outside listed folders are listed as unlisted and not restored".
  - "F-406: an ordinary project zip returns null".
- `read-backup-fuzz.test.ts`: "F-406 property: any list of project names and safe paths round-trips through zipBackup and readBackup" (fast-check, as `read-zip-fuzz`).

### 4.2 Web unit (`pnpm --filter @nf-builder/web test`)
- `project-db.test.ts` (extend): "F-406 ADR-0045: readAllProjects returns every project with its files"; "F-406: createProjects writes all or none (a duplicate id aborts every write)".
- `backup.test.ts` (workspace on `fake-indexeddb`, as `export-project.test.ts`)
  - "F-406 step 1 IO-04 IO-02: export all, delete every project, restore: names, versions, times, sources and every file including layout.json are equal; ids are new".
  - "F-406 IO-01: exportAll includes an edit still waiting for autosave".
  - "F-406: exportAll refuses with no projects, and when the flush fails".
  - "F-406 ADR-0045: restoring into a workspace with projects adds the backup's and leaves the others byte-identical".
  - "F-406 LA-02: a project needing a pack that isn't installed is skipped and reported; the others restore".
  - "F-406 forward compatibility: a newer-version backup is refused at stage and nothing is stored".
  - "F-406: restoreBackup with a discarded or replaced stage refuses; createProject on a backup stage refuses".
  - "F-406 IO-12: backupStats flags more than 20,000 files and more than 200 MB".
- `import-stage.test.ts` (extend): "F-406: stageZip returns a backup summary for a backup and `backup: null` for a project zip".
- `export-all-dialog.test.tsx`: "F-406 IO-04: shows the file name and project and file counts"; "F-406 IO-12: warns when over a limit and still exports"; "F-406: a failure shows inline and keeps the dialog open".
- `backup-summary.test.tsx` and `new-project-dialog.test.tsx` (extend): "F-406 UX-60: a backup stage shows 'Restore backup', the project list and 'Restore N projects', with no name field or ignore list".
- `project-ui.test.tsx` (extend): "F-406 IO-04: the switcher offers Export all projects…, disabled with no projects"; "F-406 ADR-0056: not in read-only".
- `project-store.test.ts` (extend): "F-406: exportAll downloads the backup name"; "F-406 ADR-0056: restoreBackup is refused in read-only"; "F-406: after restore with nothing open, the most recently opened restored project opens".
- `app-shell.test.tsx` (extend): "F-406 UX-01: with storage ready, Import is enabled and opens the Import route".

### 4.3 End-to-end (`pnpm test:e2e -- --grep F-406`)
`e2e/backup.spec.ts`:
- "F-406 step 1 IO-04 IO-02 ADR-0008: export all, clear storage, import the backup: every project restored with layout": create Hello world and Samplesheet to MultiQC from templates, drag a node in each, import a small zip (third project, `source.kind` zip); record for each project its files (`readFile`), sidecar bytes and every node position, and the stored metas (`readStoredDatabase`). Export all; `clearStorage` (`indexedDB.deleteDatabase("nf-builder")`, reload, switcher shows "No project" and the list is empty). Header Import, choose the backup, "Restore 3 projects". For each project: open it, files and sidecar equal, every node position equal, no "Laying out nodes…" notice; stored metas equal apart from `id` (source included).
- "F-406 ADR-0045: the backup restores in a fresh browser context" (origin move).
- "F-406 ADR-0056: read-only shows neither Import nor Export all projects".
- "F-406 QA-30: export all and restore log no CSP violation, at top level and in a cross-origin iframe" (`watchForCspViolations`, as F-404).

## 5. Tasks

Branch `feat/F-406`. `pnpm format` and `pnpm check` before every commit. Settle section 6 first.

1. **Format module.** `backup/format.ts` and `format.test.ts`. Done: `pnpm --filter @nf-builder/sources test`, `pnpm check`.
2. **Writer.** `addEntries` refactor, `zipBackup`, `zip-backup.test.ts`. Done: same, F-404 sources tests unchanged and green.
3. **Reader.** `readBackup`, refusal codes and messages, `read-backup*.test.ts`. Done: same.
4. **Database.** `readAllProjects`, `createProjects`, tests. Done: `pnpm --filter @nf-builder/web test`, `pnpm check`.
5. **Workspace.** Stage carries `backup`; `backupStats`, `exportAll`, `restoreBackup`; `expose.ts`, `engine-client.ts`; `backup.test.ts`, `import-stage.test.ts`. Done: same.
6. **Export all UI.** Store action, switcher item, `ExportAllDialog`, tests. Done: same, plus `pnpm test:e2e -- --grep F-404`.
7. **Import UI.** Header Import, backup mode in the New project dialog, report dialog, tests. Done: same, plus `pnpm test:e2e -- --grep "F-403|F-703"`.
8. **End-to-end.** `e2e/backup.ts`, `e2e/backup.spec.ts`, move `importZip`. Done: `pnpm test:e2e -- --grep F-406` (with `PW_CHROMIUM_EXECUTABLE`), `pnpm smoke` under 60 s, `pnpm build && pnpm check:budget` (QA-01: the backup code sits in the lazy export and import chunks).
9. **Records** (section 7). Done: `pnpm check`.

## 6. Open points (none decided here)

1. **What the header Import opens.** IO-04 and UX-01 name it, nothing defines it. **Recommend:** the New project dialog on the Import route (Zip file), with backup detection there, so one button covers project zips, GitHub and backups. **Alternative:** a dedicated "Restore backup" file picker (simpler dialog, but Import would then do only backups).
2. **Where "Export all projects" lives.** **Recommend:** an item in the project switcher (works with no project open; amends ADR 0045's switcher list). **Alternative:** a second action in the Export dialog (needs an open project, which a backup shouldn't).
3. **Backup file name.** ADR 0062 chose no date for single exports. **Recommend:** `nf-builder-backup-YYYY-MM-DD.zip` (local date): backups are taken repeatedly and dated names sort. **Alternative:** `nf-builder-backup.zip`.
4. **Restore into a non-empty workspace.** **Recommend:** always add as new projects with new ids, never overwrite (duplicates allowed, ADR 0045), and say so in the report. **Alternatives:** skip projects whose id exists; replace by id (destructive; would need a confirm).
5. **Limits for a backup.** IO-12's whole-zip limits (20,000 entries, 200 MB) can make a large workspace's backup unrestorable. **Recommend:** keep IO-12 unchanged for v0.1 (QA-32's bomb bounds stay intact) and warn in the Export all dialog when over. **Alternative:** per-project limits with raised whole-backup caps (changes QA-32 bounds; needs `readZip` limit parameters). The F-404 note "Export doesn't check re-import limits" covered single exports; this warning is new.
6. **Over-1-MB files in a backup** (possible after a Code edit). **Recommend:** skip and list them as IO-12 says. **Alternative:** a higher per-file cap for backups only.
7. **Duplicated source type.** `packages/sources` can't import `apps/web`, so `BackupSource` restates `ProjectSource`. **Recommend:** make `apps/web`'s `ProjectSource` an alias of `BackupSource` (renamed `ProjectSource` and moved into `@nf-builder/sources`). Moves a type across packages but no boundary rule changes. **Alternative:** keep both plus a compile-time equality test.
8. **Timestamps on restore.** **Recommend:** keep `createdAt`, `updatedAt`, `openedAt` from the backup, so the list order survives a move. **Alternative:** set `openedAt` to now.
9. **A backup dropped on the canvas (F-210)** adds its files to the open project today. **Recommend:** leave it in v0.1; note on F-210 that the add preview could say "This is a backup; use Import". Not a step of F-406.
10. **Flush failure before Export all.** **Recommend:** refuse with the save error (the backup would otherwise miss the open project's edits). **Alternative:** read the open project from the engine and the rest from the database.

**AGENTS.md decide-and-record items:**
- **Exported format:** the backup zip and manifest v1 (sections 2.1, 2.2): new ADR.
- **Spec and ADR changes:** IO-04 text (format summary, restore semantics), UX-01/UX-60 (Import opens the Import route; backup restore), a UX row or UX-62 amendment for Export all; ADR 0045's switcher contents; ADRs 0043/0045/0053's API lists (three new `WorkspaceApi` calls, `ImportStageResult.backup`); ADR 0053's refusal codes.
- **Package boundary (minor):** point 7 if the type moves into `@nf-builder/sources`; no dependency-cruiser change.
- **None:** runtime dependencies (fflate already pinned), IndexedDB schema (stays v1), workflows, open questions in `docs/plan/open-questions.md`.

## 7. Records (drafts for the orchestrator)

- **ADR** `Accepted (agent)`, next free number at landing: "Back up every project to one zip with a versioned manifest, and restore it through Import as new projects". Covers sections 2.1 to 2.5 and points 1 to 10 as settled; amends ADR 0045 (switcher list, API list), ADR 0053 (refusal codes, stage result), ADR 0062 (header Import now F-406's, shared entry builder). Row in `docs/adr/README.md`.
- **Spec:** IO-04 amended; UX-01, UX-60 and UX-62 (or a new UX row) amended.
- **`features.json`:** F-406 notes "Verified <date>: step 1 by `e2e/backup.spec.ts` … ADR 00xx", `passes: true`; F-210 note for point 9; F-407 note "binary files in the backup need manifest v2 or a schema-v2 rule".
- **`progress.md`:** entry with the ADR, spec changes and any `@visual` re-approvals (the switcher panel and header with Import enabled may change baselines: re-approve from CI, ADR 0021).
- **Handoff README:** settle the points under "F-406" and delete this plan in the PR that merges F-406.

## 8. Evidence

- Feature and notes: `docs/plan/features.json` F-406 (notes from F-202, F-403, F-703, F-401, F-404).
- Spec: `docs/spec/data-and-io.md` IO-04 (IO-02, IO-11 to IO-13, IO-20 read for context); `docs/spec/ux.md` UX-01, UX-60, UX-62.
- ADRs 0045, 0053, 0056, 0057, 0062; `docs/plan/handoff/README.md` "F-404".
- Code: files listed in section 1.2 on `origin/main` at `3e28b72`.
- No Nextflow syntax is written by this feature, so no oracle case is needed.
