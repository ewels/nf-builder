# Spike S5: nf-metro in the browser

Serves feature F-010 (ADR 0013, FI-54, ADR 0024). A throwaway test page that renders two nf-core example maps with nf-metro 2.1.0 in a Web Worker under Pyodide, then compares them with the nf-metro CLI output. It is not deployed and `apps/web` is untouched.

## Run

- `pnpm spike:s5` fetches the pinned files, renders the CLI references, builds the page and serves it on http://localhost:4175 (needs Python 3.11+).
- `SPIKE_S5_CSP=production pnpm spike:s5` serves with netlify.toml's exact headers. Pyodide then never starts, because the CSP lacks `'wasm-unsafe-eval'`.
- `pnpm test:e2e -- --grep F-010` runs the end-to-end tests, which prepare, build and serve in `beforeAll`.

## Cache

Everything lives in `.cache/spikes/s5/` (git-ignored):

- `public/pyodide`, `public/wheels`, `public/examples`: the files pinned in `assets.json`, checked by sha256.
- `public/reference/`: the CLI's SVGs and `manifest.json`, from `venv/` (nf-metro and its dependencies pinned in `requirements-cli.txt`).
- `dist/`: the built page. `metrics/`: one JSON file per cold-load test run.

## Re-pin

Change the URL, sha256 and size in `assets.json` (and `requirements-cli.txt` to the same versions) in its own PR.

## Licences of the fetched files

Pyodide MPL-2.0; CPython stdlib PSF; nf-metro MIT (Inter fonts OFL-1.1); lark MIT; drawsvg MIT; networkx BSD-3-Clause; Pillow MIT-CMU. The nf-core logos are fetched for the test only and never committed.
