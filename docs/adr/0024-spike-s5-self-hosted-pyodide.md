# 0024. Run spike S5 as a local test page with pinned, self-hosted Pyodide

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

Spike S5 (F-010, ADR 0013, FI-54) must show that nf-metro renders SVG in a Web Worker under Pyodide, and measure size and time. Pyodide and its wheels total about 17 MB, too much to commit. Loading them from a CDN at runtime would add a host to ADR 0002's allow-list. WebAssembly needs `'wasm-unsafe-eval'` in `script-src` (ADR 0014). Research: [spike S5 report](../research/2026-11-22-spike-s5-nf-metro.md).

## Decision

- Spike S5 lives in `spikes/s5-nf-metro/`, outside the pnpm workspace, not built by `pnpm build` and not deployed; only `e2e/` and `test/` import it. Other spikes that needn't be deployed may use `spikes/<id>/` the same way (a deployed probe, like S4's, follows ADR 0023 instead). A spike folder is deleted by the feature that ships the real thing (FI-54 for S5).
- `spikes/s5-nf-metro/assets.json` pins every file the page serves (Pyodide 314.0.8 core, five wheels, nf-metro 2.1.0 examples) by URL and sha256. `prepare.ts` fetches them into `.cache/spikes/s5/` and renders the CLI references with nf-metro 2.1.0 in a venv there. It needs Python 3.11+.
- Build-time hosts (ADR 0017): `cdn.jsdelivr.net`, `pypi.org`, `files.pythonhosted.org`, `raw.githubusercontent.com`. At runtime the page contacts only its own origin. ADR 0002 is unchanged.
- The spike's `vite preview` (port 4175) sends netlify.toml's headers with `'wasm-unsafe-eval'` added to `script-src`. netlify.toml is unchanged until a shipped feature needs it.
- The browser installs nf-metro with `pyodide.loadPackage` on wheel URLs: nf-metro, lark, drawsvg, networkx and Pillow. Nothing is dependency-resolved, so av and resvg-py are never fetched.
- CI's Chromium e2e job runs the spike with the runner's python3. There is no workflow change.

## Consequences

- No production change, no new npm dependency, no runtime host.
- Each CI Chromium e2e run fetches about 17 MB of browser assets and about 50 MB of CLI wheels (PyAV alone is 35 MB), taking about 15 s on a cold cache, until FI-54's test replaces the spike.
- The licences of fetched files (Pyodide MPL-2.0, nf-metro MIT, Inter OFL-1.1, lark MIT, drawsvg MIT, networkx BSD-3-Clause, Pillow MIT-CMU) become obligations only when FI-54 ships them, with `docs/licences.md` entries.

## Alternatives

- Pyodide from cdn.jsdelivr.net at runtime: a new runtime host (supersedes ADR 0002) and a path-specific CSP.
- The spike inside `apps/web`: the production build would download 17 MB or commit binaries.
- npm `pyodide` as a dev dependency: 6.5 MB on every install, and the CDN is still needed for the Pyodide-built wheels.
- micropip with `deps=False`: works, but also downloads micropip (115 kB).
