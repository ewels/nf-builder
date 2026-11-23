# 0053. Import zips in the engine worker with fflate, one shared set of limits, ignore rules and text checks

- Status: Accepted (agent)
- Date: 2026-11-23

## Context

IO-11 asks for zip import in a worker, with the top-level folder stripped. IO-12 asks for an editable ignore list and size limits, shared with the GitHub route (F-401). QA-32 asks for protection against zip bombs. UX-61 asks for a summary before anything is created.

Other ADRs constrain this:
- ADR 0009 ignores run output and test data.
- ADR 0045 stores projects as text only, in schema v1.
- ADR 0043 keeps file text in the engine worker (AR-30).
- ADR 0003 names fflate for zips.
- The policy allows workers from `'self'` only (ADR 0040), so a library that starts `blob:` workers can't run.

Research: the [F-403 plan](https://github.com/ewels/nf-builder/blob/d5d4b7b/docs/plan/handoff/plan-F-403.md).

## Decision

- **fflate 0.8.3**, pinned and MIT, is a runtime dependency of `@nf-builder/sources`. Only `unzipSync` is used. Earlier versions carry GHSA-px8p-9vwx-vf98, and the asynchronous API starts `blob:` workers. A root dev dependency on the same version builds test fixtures, and fast-check 4.11.0 is a dev dependency of `sources`.
- **Where it runs.** The engine worker loads the import modules lazily from `@nf-builder/sources/import`, a subpath with no registry code. The page sees only the summary, paths, counts and messages. The initial JavaScript is unchanged in substance (QA-01).
- **API.** This amends the API lists in ADRs 0043 and 0045.
  - `WorkspaceApi` gains three calls: `stageZip(file, name)`, `restageImport(id, ignore)` and `discardImport(id)`.
  - `NewProject.import` carries `{id, ignore}`. It is never combined with `template` or `files`.
  - `createProject` checks the list again, refuses when no files are selected, and stores the selection.
  - One stage exists at a time, and the newest request wins.
  - The stage is discarded on Create, when another file is chosen, when the route changes and when the dialog closes.
  - Stage ids come from `getRandomValues` (ADR 0044).
- **Limits.** Sizes are in SI units (1 MB = 1,000,000 bytes).

  | Limit | Value | Checked |
  |---|---|---|
  | Zip file | 200 MB | on the file's size, before reading |
  | Entries | 20,000 central-directory records, folders and `__MACOSX/` included | before inflating |
  | Total uncompressed | 200 MB of recorded sizes | before inflating |
  | Per text file | 1 MB | larger files are skipped without inflating |
  | Plausibility | stored entries need equal sizes; deflated entries at most 9/8 of the uncompressed size plus 1,024 bytes | per entry |
  | Time | 30 seconds | between entries |

- **Paths.** Entries with absolute paths, `..`, drive letters, control characters, backslash tricks or reserved names are skipped and listed. Duplicates keep the first entry.
- **Folder rule.** One top-level folder is stripped when every safe entry outside `__MACOSX/` sits under it and at least one file exists. The rule is decided before the ignore list.
- **Ignore list.** The default reads ADR 0009's "test data" as nf-core's root folders:

  ```
  # Run output and caches
  work/
  results/
  null/
  .nextflow*
  .nf-test*
  .lineage/
  # Test data
  /data/
  /testing/
  /test-datasets/
  # Version control and system files
  .git/
  node_modules/
  __MACOSX/
  .DS_Store
  ```

  - `.nf-builder/` is never ignored.
  - The list is editable and uses a `.gitignore` subset, matched without backtracking (its cost is the pattern length times the path length). Lines it doesn't support block Create.
- **Text.** A file is binary if it has a NUL in its first 8,000 bytes or isn't valid UTF-8. Text is kept byte for byte: BOM and CRLF included. Binary files, and text files over 1 MB, are skipped and listed under "Binary or non-UTF-8 files" and "Over 1 MB". They are never stored.
- **Failures.** A damaged entry aborts the whole import. `unzipSync` can't skip one entry.
- **Summary (UX-61).** It shows the files kept and their total size, each skipped group (up to 100 paths each), and the removed folder. While the summary is updating after an ignore-list edit, Create waits. The report after import is F-401's.

## Consequences

- **Bombs are bounded.**
  - Memory is limited by each entry's recorded size.
  - CPU is limited by deflate's ratio times the plausibility cap: about 5 seconds per entry. In the tests a 1 GB entry recorded as 1 MB came back cut to 1 MB in 5.2 seconds.
  - The whole import is limited by the 30-second deadline, about 35 seconds at worst.
  - There is no CRC check.
  - While a zip unpacks, the engine worker, autosave included, waits.
- **Not kept:** binary files, executable bits, empty folders, and symlinks, which come in as a text file holding the target. The deferred M8 feature "Binary files in projects" covers binaries.
- **Edge cases.** Encrypted entries are refused as damaged or binary, never decrypted. File names without the UTF-8 flag decode as Latin-1.
- **Reuse.** F-401 reuses the limits, the ignore list, the text check and the summary. F-210 reuses the staging for dropped zips. F-404 and F-406 build on the same rules.

## Alternatives

- **`DecompressionStream` with our own zip reader:** exact byte counting, but we would own a binary parser and still need a writer for export.
- **A separate or nested worker:** file text would have to cross the main thread or a hand-built channel.
- **Storing binary files now:** an IndexedDB schema v2, now deferred.
- **Test data by file extension:** would drop the template's own test files on re-import.
- **No test-data patterns:** would import nf-core's test data folders, against ADR 0009.
