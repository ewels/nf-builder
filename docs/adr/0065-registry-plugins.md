# 0065. Add plugins from the palette with F-601's command, read plugin specs from the snapshot in the document, and merge their scopes in the worker

- Status: Accepted (agent)
- Date: 2026-11-28

## Context

IO-33 says adding a plugin writes `id '<name>@<version>'` into the `plugins` block of `nextflow.config`, that the plugin's functions, operators and factories join the palette, and that its config scopes join the config editor. FI-01 takes scopes and options from the catalogue and plugin specs; FI-04 shows an option's description, type and docs link.

The registry snapshot (F-501, IO-31) holds `plugins/<id>/<version>.json` for one release per plugin, the highest admitted by the pinned Nextflow. ADR 0050 reads the snapshot in the document, same-origin, and left `plugin(id, version)` to F-505; ADR 0058 kept plugin rows unfocusable until then. F-601 (ADR 0061) built `AddConfigPlugin` and `RemoveConfigPlugin`, the free-text "Add plugin…" dialog, the config rules, `configView`, `configSchema` and the `config-unknown-option` warning over the pack's catalogue only, so options of plugin scopes such as `validation.*` were flagged as unknown. F-301 (ADR 0060) made palette rows draggable buttons with a queued add, an undo group and a discard rollback.

ADR 0043 lists the worker API and ADR 0054 pulls diagnostics per revision. Plugin specs are fetched in the document, so a spec arriving changes the worker's results without a new revision.

The spec doesn't say where plugin functions sit in the palette, what adding one does, which version to use for a plugin declared at another version or none, whether plugins in profiles or included configs count, or what docs link a plugin option gets.

Research: the F-505 plan (deleted in the PR that merged F-505; settled in `docs/plan/handoff/README.md`, "F-505"); docs.seqera.io/nextflow/plugins/using-plugins and /developing-plugins, fetched 2026-11-28.

## Decision

- **Reading specs** (amends ADR 0050's client surface). `RegistryClient.plugin(id, version)` reads `plugins/<id>/<version>.json` from the snapshot, same-origin (ADR 0002), with `credentials: "omit"` and the JSON content type checked. It is snapshot-only: the combined and live clients delegate, as for `ports`. The file is shape-checked (`format` 1, `id` and `version` equal to the request, `definitions` an array); a definition that doesn't match the snapshot's shape is dropped rather than failing the file. A 404 or 410 is `unavailable`. Reads are held per `id@version`, and a failed read is dropped so a later call reads again. Specs are never read at palette load, only for declared plugins.
- **Declared plugins.** Only `id` statements in top-level `plugins` blocks of the root `nextflow.config` count, in source order, split at the first `@`; plugins in profiles or included configs don't (IO-33 names that file). `EngineApi.plugins()` returns them with the revision (amends ADR 0043's API list), and the page pulls it on each new revision.
- **Versions.** The snapshot has one release per plugin. A plugin declared at another version, or with none, uses the snapshot release's spec, and its palette heading says "spec from <version>". A plugin with no snapshot entry, or whose release has no definitions, gets no functions or scopes. Plugin `requires` ranges aren't checked: the snapshot only admits releases for the pinned Nextflow. The palette doesn't change a declared plugin's version in v0.1.
- **Plugin scopes in the worker** (amends ADR 0043's API list; clarifies ADR 0054). `EngineApi.setPluginScopes(scopes)` sends the declared plugins' `ConfigScope` definitions, as catalogue nodes, to the worker, which keeps them for the open project and clears them on open and close. They are merged into the pack's config catalogue (a scope the pack already has keeps its nodes and gains only missing children) and the merged catalogue is used by the diagnoser, the config rules, `configView` and `configSchema`. Their results carry a `pluginsKey`, and the problems and config stores pull again when the plugin store's key changes as well as on a new revision. Diagnostics stay keyed by revision for staleness (ADR 0054); a `config-unknown-option` warning on a plugin option can show briefly until the spec loads.
- **Plugin option docs** (FI-04). Description and types come from the spec. The docs link is the plugin's `projectUrl` from the snapshot index when it is an `https` URL, else there is none; the docs.seqera.io rule of ADR 0061 covers the pack's catalogue only.
- **Adding a plugin** (IO-33, UX-15). Registry plugin rows are F-301 buttons, draggable with the palette MIME type. Enter or a drop on the canvas runs F-601's `AddConfigPlugin` with `<id>@<version>` at the snapshot's version, through the canvas store's queued task, as one undo step labelled "Add plugin <id>@<version>". With no `nextflow.config`, `CreateFile` runs first in the same undo group; if the add is then refused, or creating the file throws, the group is discarded and nothing changes. No node is drawn and the viewport is untouched. Messages in the palette's live region: "Added plugin <id>@<version> to nextflow.config.", "<id> is already in nextflow.config." and "Couldn't add <id>: <message> Nothing was changed."
- **Duplicates.** A plugin already declared at any version is refused ("already in nextflow.config"), and its row shows an "added" text badge matched by id (QA-12).
- **Plugin items in the palette.** Each declared plugin's functions, operators and factories are listed in a "From plugins" list at the end of the "Plugins & config" category, one sub-heading per plugin, with overloads folded into one item and found by the shared search (UX-11). They are focusable and described by their summary but `aria-disabled`: inserting them, with `include { x } from 'plugin/<id>'` and a call, is F-314's.
- **F-601's "Add plugin…" stays.** The free-text dialog on the plugins card remains; the palette is the registry picker.
- **Read-only** (ADR 0056). Registry plugin rows are `aria-disabled`, not draggable, and a press adds nothing.
- **Syntax.** `plugins { id 'nf-schema@3.1.0' }` follows docs.seqera.io/nextflow/plugins/using-plugins; oracle case `f505-plugin` lints the blank template after the add clean, lint only because a run downloads the plugin.

## Consequences

- Adding nf-schema from the palette writes its `id` line, lists its functions and clears the unknown-option warnings on `validation.*`; adding a plugin by the form, in Code or by import has the same effect on the palette and the config editor.
- A project declaring a plugin at an older release sees the snapshot release's functions and options, which may differ; the heading says so.
- Plugin functions can't be inserted until F-314. Plugins in profiles or included configs get no scopes or palette items.
- Every declared plugin costs one same-origin read per session; no new host, stored or exported format, runtime dependency, package boundary, dependency-cruiser rule or workflow.

## Alternatives

- **Exact version or nothing:** a project declaring `nf-schema@2.5.1` would get no functions or scopes.
- **Merge plugin items into the pack's palette categories:** changes lang-core's palette view types for no gain in v0.1.
- **Pass plugin scopes with every engine call:** every caller would need the plugin store.
- **A second, minimal plugin command in F-505:** two writers of the same text; F-601's command is reused instead, so F-601 and F-301 join F-505's `depends_on`.
- **Replace "Add plugin…" with a registry picker:** the palette already is one.
