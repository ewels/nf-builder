# Data, import and export

## Storage

| ID | Requirement |
|---|---|
| IO-01 | Projects persist in IndexedDB (ADR 0002, ADR 0045: schema v1, written from the engine worker). Autosave runs 500 ms after each applied command. The header shows saved, saving or failed. |
| IO-02 | Layout lives in `.nf-builder/layout.json` inside the project (ADR 0008). |
| IO-03 | The app requests persistent storage on first save and warns at 80% of quota. Where persistence is refused (for example in an embedded frame) it says so quietly (ADR 0045). |
| IO-04 | "Export all projects" downloads one zip of every project as a backup. "Import" accepts that zip back. |

## Import

| ID | Requirement |
|---|---|
| IO-10 | GitHub import takes `owner/repo` or a github.com URL, an optional ref (default branch if empty) and an optional token. It follows ADR 0009: two API calls, contents from raw, blobs API for private repos. |
| IO-11 | Zip import unzips in a worker and strips a single top-level folder. |
| IO-12 | Both routes apply the size limit (1 MB per text file) and the default ignore list, editable before confirming. Limits guard against zip bombs: at most 20,000 entries and 200 MB uncompressed. |
| IO-13 | The project records its source (repo and commit SHA, or zip name and hash). |
| IO-14 | Import never fails because of code the app can't model (ADR 0004). Only I/O errors and limit breaches abort an import. |
| IO-15 | Tokens are held in memory unless the user ticks "Remember on this device". |

## Export

| ID | Requirement |
|---|---|
| IO-20 | Export writes a zip of all project files, with the layout sidecar optional. Files the user did not change are equivalent to what was imported (see glossary). |
| IO-21 | Exported projects pass `nextflow lint` with no errors when the imported project did (CI oracle, ADR 0011). |

## Registry

| ID | Requirement |
|---|---|
| IO-30 | One `RegistryClient` with live and snapshot implementations (ADR 0009). |
| IO-31 | The snapshot is built daily by a GitHub Action and served with the site: a module index (with `meta.yml` inputs and outputs, process or workflow, and legacy or typed), per-module bundles, a plugin index and plugin specs. The module index is split into `index.json` and `ports.json` (ADR 0035). |
| IO-32 | Inserting a module copies its bundle to `modules/<namespace>/<name>/` and adds `include { NAME } from '<namespace>/<name>'`. A module already present is reused, never duplicated. |
| IO-33 | Adding a plugin writes `id '<name>@<version>'` into the `plugins` block of `nextflow.config`. The plugin's functions, operators and factories join the palette, and its config scopes join the config editor. |

## Privacy

| ID | Requirement |
|---|---|
| IO-40 | No telemetry and no third-party analytics. |
| IO-41 | Network calls go only to the hosts on the allow-list in ADR 0002. A CI check enforces this. |
