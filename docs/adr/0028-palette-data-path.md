# 0028. Load the palette from the pack and the catalogue lazily

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

F-204 shows the palette (UX-10 to UX-13) from the pack's `palette.json` and catalogue (ADR 0025). The web app reaches packs only through the engine, and the engine only through a pack's entry module (ADR 0003, Q10). `palette.json` is 1.3 kB gzipped; the catalogue is about 43 kB gzipped, which would land in the initial bundle if the pack entry imported it. F-113 will later move the engine into a worker, so whatever the UI gets should be plain data.

## Decision

- `LanguagePack` gains `palette` (the parsed `palette.json`, small and static) and `loadCatalogue(): Promise<Catalogue>`, which the pack implements with a dynamic import, so the catalogue is a lazy chunk loaded when the palette column first needs it.
- The engine exports `loadPalette(version)`, memoised per pack, returning a serialisable `PaletteView` built by a pure `resolvePaletteView` (labels, descriptions, badges and docs links joined from the palette and the catalogue), plus pure `searchPalette` and `paletteItemCount`. React components only render the view.
- Which categories are open persists in localStorage under `nf-builder:palette`, version 1 (`{"state":{"open":["processes",…]},"version":1}`), validated on read and ignored on storage errors, like the layout (ADR 0021). The first time, Processes, Workflows and Operators are open, as the mockup shows.
- An end-to-end test checks the catalogue is in no initial JavaScript file and is in a lazy chunk.
- The catalogue's descriptions contain documentation links; the palette strips them from the text it shows and never fetches them. This amends ADR 0015's IO-41 scan: it skips built chunks whose source in the Vite manifest is a `.json` file (data, not code). Code chunks are scanned as before, and the CSP still limits what the app can fetch. Palette documentation links under `https://docs.seqera.io/nextflow/` (kept in the view for later use) join the never-fetched list.

## Consequences

- The initial bundle stays small, and the palette view can move into the worker unchanged (F-113).
- The palette shows a short loading state on first open while the catalogue chunk loads.

## Alternatives

- The web app importing a pack sub-entry: breaks the Q10 boundary.
- A precomputed, self-contained palette view written by `gen:palette`: no lazy chunk, but one more generated artefact; kept as the fallback if the lazy load proves slow.
- Keeping accordion state for the session only: F-204's first step asks for it to persist.
- Listing every documentation host found in the catalogue as never fetched instead of skipping data chunks: about 25 hosts that change with each catalogue regeneration.
