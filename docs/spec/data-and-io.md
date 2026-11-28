# Data, import and export

## Storage

| ID | Requirement |
|---|---|
| IO-01 | Projects persist in IndexedDB (ADR 0002, ADR 0045: schema v1, written from the engine worker). Autosave runs 500 ms after each applied command. The header shows saved, saving or failed. |
| IO-02 | Layout lives in `.nf-builder/layout.json` inside the project (ADR 0008). Format v1 is written only by the engine; positions follow nodes across edits and undo (ADR 0052). |
| IO-03 | The app requests persistent storage on first save and warns at 80% of quota. Where persistence is refused (for example in an embedded frame) it says so quietly (ADR 0045). |
| IO-04 | "Export all projects" downloads one zip of every project as a backup. "Import" accepts that zip back. |

## Import

| ID | Requirement |
|---|---|
| IO-10 | GitHub import takes `owner/repo` or a github.com repository URL (with `.git`, a trailing slash, `www.` or `/tree/<ref>`), an optional branch, tag or commit (default branch if empty) and an optional token. It follows ADR 0009: two API calls, contents from raw, blobs API for private repos. Only github.com is accepted, and a whole repository is imported. The token, private repositories and the blobs API arrive with F-402 (ADR 0057). |
| IO-11 | Zip import unzips in the engine worker and strips a single top-level folder: one level, when every safe entry outside `__MACOSX/` lies under one folder and at least one file exists, decided before the ignore list (ADR 0053). |
| IO-12 | Both routes apply the size limit (1 MB per text file) and the default ignore list, editable before confirming; unsupported ignore lines block Create. Binary files (a NUL in the first 8,000 bytes, or not UTF-8) and text files over 1 MB are skipped and listed, never stored. Limits guard against zip bombs: at most 20,000 entries (folders included), 200 MB uncompressed (recorded sizes) and a 200 MB zip. 1 MB is 1,000,000 bytes, shown in SI units (ADR 0053). For a GitHub import the file and size limits apply to the files selected after filtering, binaries are also skipped by extension before download, and a truncated tree listing aborts the import (ADR 0057). Files added to an open project (UX-16) take the same limits: at most 20,000 files and 200 MB at a time, 1 MB per text file, binary files skipped; loose files have no ignore list (ADR 0055). |
| IO-13 | The project records its source (repo and commit SHA, or zip name and hash) on the project record as `source`. GitHub imports record `{kind: "github", repo, ref, sha}` (ADR 0057); zip imports record `{kind: "zip", name, sha256}`, with `sha256` absent in insecure contexts. |
| IO-14 | Import never fails because of code the app can't model (ADR 0004). Only I/O errors and limit breaches abort an import. |
| IO-15 | Tokens are held in memory unless the user ticks "Remember on this device". |

## Export

| ID | Requirement |
|---|---|
| IO-20 | Export writes a zip of all project files, with the layout sidecar optional. Files the user did not change are equivalent to what was imported (see glossary). Entries sit under one folder named after the project; files under the root `bin/` and under `resources/usr/bin/` are executable; names are UTF-8; every file is the stored text byte for byte (ADR 0062). |
| IO-21 | Exported projects pass `nextflow lint` with no errors when the imported project did (CI oracle, ADR 0011). For v0.1 this is checked on a CI-linted oracle pair exported after an edit; linting edited corpus exports is a follow-up (ADR 0062). |

## Registry

| ID | Requirement |
|---|---|
| IO-30 | One `RegistryClient` with live and snapshot implementations and automatic fallback to the snapshot (ADR 0009). The app reads live only once the registry allows cross-origin reads; until then the snapshot is its only source (ADR 0050). |
| IO-31 | The snapshot is built daily by a GitHub Action and served with the site: a module index (with `meta.yml` inputs and outputs, process or workflow, and legacy or typed), per-module bundles, a plugin index and plugin specs. The module index is split into `index.json` and `ports.json` (ADR 0035). |
| IO-32 | Inserting a module copies its bundle to `modules/<namespace>/<name>/` and adds `include { NAME } from '<namespace>/<name>'`. A module already present is reused, never duplicated. |
| IO-33 | Adding a plugin writes `id '<name>@<version>'` into the `plugins` block of `nextflow.config`. The plugin's functions, operators and factories join the palette, and its config scopes join the config editor. |

## Privacy

| ID | Requirement |
|---|---|
| IO-40 | No telemetry and no third-party analytics. |
| IO-41 | Network calls go only to the hosts on the allow-list in ADR 0002. A CI check enforces this. |
