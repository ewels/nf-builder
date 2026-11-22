# 0045. Store projects in IndexedDB from the engine worker, without a library

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0002 keeps projects in IndexedDB "via Dexie", in stores for projects, files and settings. IO-01 asks for autosave after every applied command, and IO-03 asks for persistent storage and a quota warning. AR-30 keeps file text out of the main thread: the engine runs in a worker (ADR 0043). The app is served from `https://ewels.github.io/nf-builder/` (ADR 0040), and the maintainer has chosen no custom domain for the foreseeable future (#35). The app also runs inside cross-origin iframes (ADR 0044). Research: the [F-202 plan](https://github.com/ewels/nf-builder/blob/9db5fcf/docs/plan/handoff/plan-F-202.md).

## Decision

- **No library.** A hand-written wrapper (`apps/web/src/workspace/project-db.ts`) replaces Dexie; Dexie would cost about 31 kB gzipped for three transactions. This amends ADR 0002's "via Dexie" clause. There is no settings store yet.
- **Schema v1:** database `nf-builder`, version 1, with no indexes.
  - `projects`, keyed by `id`, holds `{id, name, languageVersion, createdAt, updatedAt, openedAt}`. Times are milliseconds since the epoch.
  - `files`, keyed by `[projectId, path]`, holds `{projectId, path, text}`: text only, relative POSIX paths. The layout sidecar is an ordinary file. Binary content will need a version bump.
- **Migrations:**
  - Each version has one `MIGRATIONS[v](db, transaction)` step. A shipped step is never edited, and a missing step is an error.
  - If the database has a newer version, storage reports it and nothing is written.
  - On `versionchange`, a closed connection, or eviction, the app closes the connection and storage becomes unavailable, with "Reload this page".
- **Transactions.** There is one transaction per create, rename, touch, delete and autosave write. An autosave writes every dirty file plus each touched project's `updatedAt`, all or nothing. A write for a project deleted in another tab fails with a message; it is not dropped silently.
- **Placement.** Storage and autosave run in the worker: the workspace wraps the engine service, and `WorkspaceApi` extends `EngineApi` with project calls, `watch` and `flush`. `persist()` and `estimate()` stay on the main thread. `EngineApi` gains `readFile` and `close`, which amends ADR 0043's API list.
- **IO-01, autosave:**
  - A trailing 500 ms debounce runs after each applied command or raw write, with no maximum wait. "Saving…" covers both the wait and the write.
  - A failed write keeps its changes and retries on the next change or flush. Refused commands save nothing.
  - On `visibilitychange` to hidden and on `pagehide`, the app flushes as a best effort. Edits made in the last moment before the page is killed may be lost.
- **IO-03, storage:**
  - `persist()` is requested once per page load, after the first successful save, and never awaited.
  - The quota warning appears at 80%, as a "Storage N% full" alert in the header. The quota is checked at start and after each create, save and delete.
  - When persistence is refused, as it may be in a frame, a quiet note says the browser may clear the projects.
- **UX:**
  - A disclosure switcher in the header holds New, Open, Rename and Delete. Rename and Delete act on the open project.
  - Names are trimmed to 1 to 100 characters, and duplicates are allowed.
  - Dialogs are native `<dialog>` elements whose submit calls `preventDefault` (`form-action 'none'`).
  - Loading shows the phase and file counts.
  - The most recently opened project reopens on load.
  - Until F-203, a blank project has no files.
- **Several tabs:** there is no coordination, and the last write wins per file.

## Consequences

- **Shared origin.** Projects share the `ewels.github.io` origin with the account's other project sites. `estimate()` and a granted `persist()` cover the whole origin. A move to another origin would orphan projects unless they are exported and re-imported (F-406).
- **Embedded copies.** An embedded copy has partitioned storage, so it keeps its own project list, and the UI says so.
- **Future format changes** go through `MIGRATIONS` and are decide-and-record changes.
- **Tests** use `fake-indexeddb` 6.2.8 (Apache-2.0), a dev dependency of `@nf-builder/web`.

## Alternatives

- **Dexie or idb:** a dependency for little gain.
- **Storage on the main thread:** file text would cross into the UI (AR-30).
- **OPFS:** not available in every browser and context, frames included.
