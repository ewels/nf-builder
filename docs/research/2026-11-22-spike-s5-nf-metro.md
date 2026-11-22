# Spike S5: nf-metro in a Web Worker under Pyodide

2026-11-22, F-010, [ADR 0024](../adr/0024-spike-s5-self-hosted-pyodide.md). Can nf-metro render the nf-core example maps to SVG in the browser, without its native PNG and animation dependencies, and how large and slow is it (ADR 0013, FI-54)?

## Answer

Yes, with no patches. nf-metro 2.1.0 renders the nf-core rnaseq and sarek maps in a module worker under Pyodide 314.0.8, self-hosted, under the production CSP plus `'wasm-unsafe-eval'` only. The SVG is identical to `nf-metro render`: 0 differing pixels and identical text apart from the CLI's final newline. A cold load serves 16.5 MB (10.5 MB gzip) and the first SVG arrives after about 8.6 s.

## Setup

- Pins: `spikes/s5-nf-metro/assets.json` (Pyodide 314.0.8 core files, five wheels, the two example maps and their logos, each by URL and SHA-256); `requirements-cli.txt` pins the CLI's dependencies to the browser's versions.
- `prepare.ts` fetches the assets into `.cache/spikes/s5/` (a second run makes no request) and renders the reference SVGs with the nf-metro CLI in a venv there.
- Build-time hosts: `cdn.jsdelivr.net`, `pypi.org`, `files.pythonhosted.org`, `raw.githubusercontent.com`. At run time the page contacts only its own origin.
- Browsers: the sandbox's Chromium headless shell and CI's Playwright Chromium (`ubuntu-24.04`). CLI references: Python 3.13.18 locally, 3.12.3 in CI; Pyodide runs Python 3.14.2. All produced identical SVG.
- Reproduce: `pnpm spike:s5` (serves the page on port 4175), `pnpm test:e2e -- --grep F-010`.

## Install route

- The worker calls `pyodide.loadPackage` with five wheel URLs: nf-metro 2.1.0 (pure Python, bundles the Inter fonts), lark, drawsvg, networkx and Pillow. URLs are never dependency-resolved, so `av` (PyAV, animation), `resvg-py` (PNG) and `click` (CLI) are never fetched; the library entry point `nf_metro.render_string` doesn't import them.
- **Pillow is needed for SVG too.** `nf_metro/parser/directives.py` (`_is_color`) imports `PIL.ImageColor` to validate every colour in `%%metro line:`, and `render/legend.py` reads logo PNGs with it. Pyodide ships Pillow 12.2.0 as a wasm wheel (1 MB). ADR 0013's Context lists Pillow only as a PNG dependency.
- networkx is loaded by URL because Pyodide's lock file pulls numpy and matplotlib when it is loaded by name.
- Also verified during planning: `micropip.install(urls, deps=False)` (downloads micropip, 115 kB) and `pyodide.unpackArchive` give the same result. nf-metro's own playground uses Pyodide 0.27.2 from the CDN with mocked `av` and `resvg-py`.

## Results

Cold load, median of three local runs (one CI run in brackets):

| Phase | Time |
|---|---|
| Pyodide runtime ready | 2.4 s (2.6 s) |
| Wheels installed | 0.5 s (0.8 s) |
| `import nf_metro` | 3.8 s (3.4 s) |
| rnaseq render | 1.6 s (1.7 s) |
| sarek render | 0.6 s (0.7 s) |
| **First SVG, from navigation** | **8.6 s (8.7 s)** |

| Download | Bytes |
|---|---|
| Served by `vite preview` (JS and JSON gzipped, wasm, zip and wheels raw) | 16.52 MB |
| Decoded | 17.67 MB |
| All files gzipped | 10.46 MB |
| All files brotli (planning measurement) | 9.10 MB |

The largest files are `pyodide.asm.wasm` (9.6 MB raw, 3.6 MB gzip), `python_stdlib.zip` (2.5 MB, already compressed), the nf-metro wheel (1.4 MB), networkx (1.1 MB) and Pillow (1.0 MB).

| Map | Size | Differing pixels (tolerance 0.1%) | Text identical |
|---|---|---|---|
| rnaseq_metro | 2028 × 708 | 0 (0.0000%) | yes, apart from the final newline |
| sarek_metro | 2342 × 1039 | 0 (0.0000%) | yes, apart from the final newline |

Changing one line's colour in a reference gave 0.99% differing pixels during planning, so the diff is sensitive.

## CSP

- Under the exact `netlify.toml` policy, `WebAssembly.instantiateStreaming()` fails with a `script-src 'self'` violation and `loadPyodide` never settles: it hangs rather than rejecting. The worker therefore has a boot timeout.
- With `'wasm-unsafe-eval'` added to `script-src`, there are no violations and no console errors. `'unsafe-eval'` isn't needed. ADR 0014 already allows `'wasm-unsafe-eval'`.

## Patches needed

None.

## Implications for FI-54

- Self-host Pyodide and the five wheels; load the worker lazily, only when the user opens the metro map, with a boot timeout.
- Add `'wasm-unsafe-eval'` to `netlify.toml` then (allowed by ADR 0014).
- `pyodide.mjs` contains a default `cdn.jsdelivr.net` URL that the IO-41 scan would flag if shipped; set the package base URL explicitly and list the string as never fetched.
- Possible savings: a small `ImageColor` shim instead of Pillow (about 1 MB), precompiled `.pyc` files to cut the 3.8 s import.
- Licences when shipped: Pyodide MPL-2.0, CPython stdlib PSF, nf-metro MIT (Inter fonts OFL-1.1), lark MIT, drawsvg MIT, networkx BSD-3-Clause, Pillow MIT-CMU.
- CI cost meanwhile: the Chromium e2e job fetches about 17 MB and installs the CLI (about 25 s) until FI-54's test replaces the spike.

## Outcome

ADR 0013 stands; see its spike result.
