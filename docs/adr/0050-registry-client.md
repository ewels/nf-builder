# 0050. Read the registry from the snapshot, with a live client gated off until the registry allows cross-origin reads

- Status: Accepted (agent)
- Date: 2026-11-23

## Context

IO-30 asks for a registry client with live and snapshot implementations and automatic fallback, and ADR 0009 says the app prefers live data. UX-14 asks the palette to show where its registry data came from and how old it is.

Spike S4 (ADR 0023) found that `registry.nextflow.io` sends no `Access-Control-Allow-Origin` header, so a browser can't read it. Its bundle downloads redirect to `public-cr-prod.seqera.io`, which also sends none and isn't on the ADR 0002 allow-list. The snapshot built by F-501 and deployed with the site (ADR 0035, ADR 0041) is therefore the browser's only registry source.

The probe ran again on 2026-11-23 ([run 45093395128](https://github.com/ewels/nf-builder/actions/runs/45093395128)) with the same verdicts in Chromium, Firefox and WebKit. A `curl` the same day showed the header still missing.

The list endpoints don't carry module versions or whether a module is typed. A full live index takes about 26 requests against a limit of 100 a minute.

Research: the [F-502 plan](https://github.com/ewels/nf-builder/blob/6291f4e/docs/plan/handoff/plan-F-502.md) and the [S4 note](../research/2026-11-22-spike-s4-cors.md).

## Decision

- **Client surface** (`packages/sources`):
  - `RegistryClient { source; index() }` returns a `RegistryIndex`: the snapshot's modules and plugins, its build time, and the source (`snapshot` or `live`).
  - Failures are `RegistryError`s with the codes `unavailable`, `network`, `http`, `timeout` and `invalid`.
  - The package exports `createSnapshotClient`, `createLiveClient`, `overlayLive`, `createRegistryClient` and `LIVE_REGISTRY`.
  - Only `index()` exists for now. `ports`, `bundle` and `plugin` come with F-503, F-504 and F-505.
- **Snapshot reading:**
  - The document reads `${BASE_URL}registry/index.json`; workers make no cross-origin requests (QA-30).
  - The file is validated:
    - 404 or 410 means `unavailable` ("No registry snapshot is available on this site.");
    - any other non-2xx response is `http`;
    - a non-JSON response, an unknown `format`, an unreadable build time or missing lists is `invalid`.
- **Caching:** one copy in memory, plus the browser's HTTP cache. There is no IndexedDB copy and no stored format. Refresh reads again with `no-cache`.
- **The live gate.** `LIVE_REGISTRY = false`. The live client is built and tested against recorded responses, and a test hook (`window.nfBuilderRegistry`) drives the live path end to end. The app makes no browser request to `registry.nextflow.io` while the gate is off.
  - To turn it on, do all of these in a reviewed PR:
    - show with `curl -sI -H 'Origin: https://ewels.github.io'` that the registry now sends the header;
    - check the paths against `/openapi/openapi-latest.yaml`;
    - run the routed end-to-end tests and one run against the real registry;
    - flip the constant.
- **Live behaviour, once on:**
  - Live lists overlay the snapshot: they can add and remove names.
  - Versions and the typed flag come from the snapshot; a live-only module has `version: null` and can't be inserted until the next snapshot.
  - Pages after the first are read in parallel, at most six at a time.
  - Fallback: the snapshot is read first, and a live failure keeps the snapshot with a notice.
- **Palette** (UX-14):
  - A registry.nextflow.io section shows a refresh button and a source line: "Snapshot · built …", or the live equivalent.
  - It covers four states: loading, unavailable, failed (refresh retries) and a failed refresh.
  - Interim lists show 50 module names and the plugin ids until F-503.
- **S4 probe deleted** (ADR 0023's lifetime clause). This deletes:
  - `.github/workflows/s4-probe.yml`;
  - `apps/web/public/spike/s4/`;
  - the probe's end-to-end tests and its unit tests.
  
  F-011 step 2's test now checks the app page only, because the probe page was the other one; the `site` job still scans every page. The re-check is the `curl` above.

## Consequences

- This amends ADR 0009's "the app prefers live" to "the app prefers live once `LIVE_REGISTRY` is on". ADR 0023's probe lifetime is fulfilled, and ADR 0040's bullet about the spike page lapses.
- A site without a snapshot, such as `pnpm dev`, shows "No registry snapshot is available on this site."
- F-503 to F-505 add methods to the same client, and F-504's bundle reads stay snapshot-only.

## Alternatives

- **Try live on every load:** a CORS error on every start, for no data.
- **Let the snapshot build record a daily CORS check and switch live on by itself:** it changes F-501's tool and the snapshot format, and turns the gate on without a review.
- **A live-only index when the snapshot is missing:** it can't happen while the gate is off.
- **The client in the engine worker:** workers make no cross-origin requests (QA-30, ADR 0040).
- **An IndexedDB copy for offline use:** a stored format for data the HTTP cache already keeps.
