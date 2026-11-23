# Plan: F-502, the registry client (live and snapshot implementations, automatic fallback) and the palette's source and age

Planner output, 2026-11-23. I didn't change anything in the repository.

**Sources:**
- `origin/main` at `2c3cc69`, read from a detached worktree in the scratchpad. The worktree has since been removed.
- Branches `origin/feat/F-206` and `origin/feat/F-208`, for ADR numbers only.
- Live checks with `curl` against `registry.nextflow.io` and `https://ewels.github.io/nf-builder/`, on 2026-11-23 between 00:51 and 00:57 UTC (section 8).

F-502 cites IO-30 and UX-14 and depends on F-501, which passes. Its notes carry instructions from F-008, F-501 and F-011, and ADR 0023 says F-502 deletes the S4 probe.

## 0. Scope

**In scope:**
- **`packages/sources`.** The `RegistryClient` interface (IO-30), with:
  - a snapshot implementation that reads `registry/index.json` from the site;
  - a live implementation that reads `registry.nextflow.io` API v1;
  - `createRegistryClient`, which falls back automatically from live to the snapshot.
- **The gate.** Live stays off until the registry sends CORS headers (section 2.1). The live client is still built and tested.
- **Palette (UX-14).** A `registry.nextflow.io` section after the generic categories:
  - a refresh button;
  - a line that shows the source (live or snapshot) and its age;
  - states for loading, unavailable, failed and a failed refresh;
  - interim flat lists of module names and plugin ids.
- **Fallback states**, including "no snapshot on this site", which ADR 0035 hands to F-502.
- **Offline and in frames** (ADR 0044): the behaviour is defined and tested.
- **The S4 probe is deleted** (ADR 0023's lifetime clause). First it is re-run once, as the F-502 notes require.
- **A test hook** `window.nfBuilderRegistry`, so end-to-end tests can drive the live path against routed responses.

**Out of scope:**

| What | Owner |
|---|---|
| Namespace groups, process or workflow tag, `typed` tag, registry search, lazy loading of the full lists, final open-state persistence | F-503 |
| Ports (`ports.json`) and bundles (`modules/<name>/<version>.json`) through the client; inserting | F-504 |
| Plugin files (`plugins/<id>/<version>.json`); adding plugins | F-505 |
| Registry version, upstream link, "update available" (UX-32) | F-506 |
| `.module-info` | F-504 |
| Registry pipelines | out of v0.1 (ADR 0009) |

## 1. Findings

### 1.1 Spec and ADRs

- **IO-30:** "One `RegistryClient` with live and snapshot implementations (ADR 0009)."
- **UX-14:** "Then a registry.nextflow.io section: Modules (grouped by namespace, lazy-loaded, process or workflow marked, typed modules tagged `typed`) and Plugins. A refresh button shows the data source (live or snapshot) and its age."
  - F-503 owns everything before "A refresh button".
- **ADR 0009:**
  - It says "The app prefers live and falls back to the snapshot; the palette shows which is in use and how old the snapshot is."
  - Its S4 spike result says the live client "can't work today: the snapshot … is the registry source, and module bundles come from it. F-502's live step applies only if a re-run of the S4 probe shows access." The decision stands.
- **ADR 0002 and IO-41:**
  - The allow-list is `api.github.com`, `raw.githubusercontent.com` and `registry.nextflow.io` (`scripts/allow-list.ts`).
  - `public-cr-prod.seqera.io`, where the registry redirects bundle downloads, is not on it.
- **ADR 0040 and QA-30:**
  - The meta CSP allows `connect-src 'self' … https://registry.nextflow.io`.
  - Workers make no cross-origin requests: the document fetches and passes them data.
  - Runtime URLs use `import.meta.env.BASE_URL`.
  - There is no single-page-app fallback, so a missing file is a 404 with `text/html`.
  - End-to-end tests fail on any CSP violation or console error.
- **ADR 0043:** the main thread keeps palette search. The palette data, parser and model live in the worker.
- **ADR 0044:** the app must load and work in cross-origin iframes. Storage there is partitioned.
- **ADRs 0035 and 0041:**
  - Format v1 is defined in `packages/lang-core/src/registry-snapshot.ts`, whose comment says "packages/sources reads it".
  - When no snapshot is deployed the site serves no `/registry/`, and "the palette shows that no snapshot is available (F-502)".
  - Playwright's preview serves the golden fixture (`tools/registry-snapshot/test/fixtures/expected`).
- **ADR 0023:** "the probe stays for re-runs until F-502 builds the registry client, which deletes it."
- **ADR 0003:** `packages/sources` holds "GitHub, zip and registry clients" and may import only `lang-core`. `apps/web` may import it, and dependency-cruiser already allows both.
- **Notes the feature carries:**
  - From F-008: delete the probe, and re-run it first.
  - From F-501: check `format === 1` and a JSON content type; the age is `generatedAt`.
  - From F-011: use `BASE_URL`, never `/registry/`; keep the content-type check; fetch in the document, not a worker.

### 1.2 What "live" can mean: evidence

1. **No CORS today.** I re-checked on 2026-11-23 (section 8) with `Origin: https://ewels.github.io`.
   - Neither HEAD (`curl -sI`) nor GET returned `Access-Control-Allow-Origin` on any endpoint I tried: `service-info`, `modules/nf-core%2Ffastqc`, `modules/list`, the `modules` search, `plugins` and `plugins/nf-schema`.
   - An `OPTIONS` preflight returns 401.
   - The bundle download still redirects (307) to `public-cr-prod.seqera.io`.
   - The registry also sends its own CSP and `ratelimit-limit: 100` with `ratelimit-reset: 59`.
   - This matches the S4 result of 2026-11-22: browsers block every read.
2. **Even with CORS, the list endpoints can't replace the snapshot** (OpenAPI 0.14.0, `/openapi/openapi-latest.yaml`).
   - `GET /api/v1/modules/list` is paged: `page` is 1-based and `size` is at most 100. It returns only `Process` modules unless `kind=Workflow` is passed.
   - Its items carry `name`, `kind`, `description`, `revoked`, `commitId` and timestamps. They carry no version, component, keywords or typed flag.
   - `GET /api/v1/plugins` items carry only `id` and download counts. The live total is 112 plugins, while the snapshot keeps 104: those with a release that admits Nextflow 26.10.7.
   - So a live-only index would lose the palette's `typed` tags (which come from parsing `main.nf` with the pack) and the version needed to insert a module.
   - Plugin details would take 112 more requests, over the 100-per-minute limit.
   - A full live list is about 26 requests: 22 Process pages, 2 Workflow pages and 2 plugin pages.
3. **Bundles can never be live in v0.1.** They come from `public-cr-prod.seqera.io`, which has no CORS headers and isn't on the allow-list.
4. **A blocked fetch is visible.**
   - Browsers log CORS failures to the console, and the S4 report notes it ("a live attempt shows CORS errors in the console").
   - Every app end-to-end test asserts `consoleErrors` is empty. Trying live on each load would break them and spam users' consoles.
   - Page code can't detect CORS without making the request: `no-cors` responses are opaque.

**Conclusion.** A useful live client is an overlay on the snapshot:
- it keeps the snapshot's details;
- it adds modules published since the last snapshot, with an unknown version and typed flag;
- it drops modules and plugins the registry no longer lists or has revoked.

Live must not be attempted until the registry is known to allow it.

### 1.3 Code facts (origin/main `2c3cc69`)

**`packages/sources`**
- Today it is an empty `export {}` with one test.
- It has no dependencies, and its tsconfig has neither the `DOM` lib nor Node types.

**`packages/lang-core/src/registry-snapshot.ts`**
- It defines `RegistrySnapshotIndex`: `format: 1`, `generatedAt`, `registry`, `apiVersion`, `language`, `nextflow`, `modules` and `plugins`.
- It also defines `SnapshotModule`, `SnapshotPlugin`, the ports types and the bundle types.

**The live snapshot on Pages (2026-11-23)**
- `generatedAt` is `2026-11-22T20:11:31.626Z`. It has 2,322 modules (127 workflows, 10 typed, 1 with typed unknown) and 104 plugins.
- It is 751,005 bytes, and 171,991 bytes gzipped as sent.
- Response headers: `content-type: application/json; charset=utf-8`, `cache-control: max-age=600`, an `etag`, a `last-modified` and `access-control-allow-origin: *`.
- A missing file returns 404 with `text/html`.
- `JSON.parse` of the index takes about 1.5 ms in Node 22.

**The fixture snapshot**
- `tools/registry-snapshot/test/fixtures/expected/registry/` has `generatedAt` `2026-11-22T00:00:00.000Z`.
- Modules: `nextflow-io/hello` (typed process), `nf-core/bam_applybqsr` (legacy workflow) and `nf-core/fastqc` (legacy process).
- Plugins: `nf-ffq` and `nf-schema`.
- `playwright.config.ts` passes it as `REGISTRY_SNAPSHOT_DIR` to the preview.
- The recorded API responses in `tools/registry-snapshot/test/fixtures/recorded/requests.json` don't include the list endpoints, and the recorder drops `access-control-*` headers.

**`scripts/registry-snapshot-site.ts`** is build-only (`apply: "build"`), so `pnpm dev` serves no `/registry/`.

**Palette (`apps/web/src/palette/`)**
- `PalettePanel` renders the search box, then either a `PaletteMessage` or a `PaletteTree`. The tree is a `<section aria-labelledby="palette-heading">` with an `h2` ("Nextflow language · 26.10") and `h3` category buttons.
- `usePaletteView` and `requestPaletteView` memoise one engine request per version. `apps/web/src/project/templates.ts` follows the same pattern.
- `palette-store.ts` persists the open generic categories in `localStorage` (`nf-builder:palette`, v1).

**Web tests** run in Node with `renderToStaticMarkup` and no DOM. `test/app-shell.test.tsx` and `test/palette-tree.test.tsx` render `AppShell` and `PalettePanel` statically, so a new section must not touch `window` at import or render time.

**Test hooks** are defined in `apps/web/src/main.tsx` with `Object.defineProperty(window, …)`: `nfBuilderEngine` and `nfBuilderWorkspace`.

**Visual baselines**
- `e2e/__screenshots__/app-shell-layout.spec.ts/app-shell-default-chromium-linux.png` is a full page at 1440 × 900.
- The palette ends at "Plugins & config" around y = 832, so a section after it will partly show.
- The other baselines capture only the canvas.

**S4 probe files**
- `.github/workflows/s4-probe.yml` (dispatch only)
- `apps/web/public/spike/s4/{index.html,probe.js}`, the only public files
- `e2e/s4-probe/{deployed.probe.ts,page.ts,report.ts,server.ts,targets.ts}`
- `e2e/s4-probe.config.ts`
- `e2e/s4-probe-page.spec.ts` (F-008 tests)
- `test/s4-probe.test.ts` (F-008 tests)

**Other references to the probe**
- `e2e/pages-hosting.spec.ts`: the F-011 step 2 test loops over `"./"` and `"spike/s4/"`.
- `test/check-site.test.ts` line 68 uses a synthetic `spike/s4/index.html` in a temporary directory. It doesn't depend on the probe and can stay.
- `spikes/README.md` line 3.
- `test/security-policy-meta.test.ts` line 66 already covers stamping a public HTML file.

**ADR numbers:** 0048 is claimed on `feat/F-208` and 0049 on `feat/F-206`. The F-207 and F-209 plans each add one. F-502 takes the next free number when it lands.

### 1.4 Collisions with existing end-to-end tests

**`e2e/palette.spec.ts`**
- F-204 step 1 asserts that `palette(page).getByRole("heading", { level: 3 })` are exactly the seven generic categories. Registry `h3` toggles would break it.
- Two F-204 tests call `palette(page).getByRole("status")` and expect it to be the generic "No components match" message. A second `role="status"` element would make them fail in strict mode.
- Several tests count or read `.palette-item`, `.palette-item-label` and `.badge-preview` across the whole palette.

**`e2e/pages-hosting.spec.ts`**
- The F-011 step 2 loop includes `spike/s4/`.

Section 2.8 avoids these collisions. The one test edit F-502 still needs is a locator narrowing in F-204 step 1.

## 2. Design

### 2.1 How to read the feature (needs an ADR; open point 1)

**IO-30 is kept in full.** One interface, two implementations, and a combinator with automatic fallback.

**The live client is built, unit-tested and tested end to end against routed CORS responses, but off in production.**
- `LIVE_REGISTRY = false` in `packages/sources`, recorded in an ADR, because the registry sends no CORS headers (1.2).
- Turning it on is a reviewed PR:
  - re-check CORS (the ADR records the `curl` command);
  - flip the constant;
  - run the routed tests against the real registry once.
- Why not try live on every load and fall back: it logs console errors on every load, breaks every end-to-end console check, and sends about 26 third-party requests per load against a limit of 100 per minute, to add almost nothing (1.2).

**Step 1** ("Block the registry host in Playwright: palette still lists modules from the snapshot and says so") is tested twice:
- in the production configuration: no request reaches the registry host, and the palette shows "Snapshot";
- with live forced on through the test hook and the host blocked: the client falls back, and the palette says "Snapshot" and that the live registry couldn't be reached.

**Step 2** ("With live access (if S4 allowed it): palette shows live"):
- Its condition is false. A re-run of the S4 probe (task 0) and the 2026-11-23 `curl` show no access.
- A routed test still shows that, with access, the palette says "Live".
- Recording this as passing is open point 2.

**The S4 probe is deleted after the re-run** (ADR 0023).

**Alternative A** (open point 1) adds automatic switch-on. The daily snapshot build would send `Origin: https://ewels.github.io` on its `service-info` call and record the `Access-Control-Allow-Origin` it gets back in an optional `index.json` field. The app would try live only when that value is `*` or its own origin. The costs:
- a change to the F-501 tool and to stored format v1 (decide and record);
- an update to the golden fixture (`UPDATE_GOLDEN=1`);
- a `check:registry` rule;
- a recorder change to keep `access-control-allow-origin`.

### 2.2 The interface, and where it runs

**It runs in the document, on the main thread.**
- The live client is cross-origin, and ADR 0040 and QA-30 keep cross-origin requests out of workers.
- The snapshot is same-origin, but one code path is simpler.
- F-503's registry search belongs with palette search on the main thread (ADR 0043).
- Parsing costs about 1.5 ms for 751 kB.
- F-504 will fetch bundles in the document and pass the files to the worker with `writeFiles`.

**The engine is not involved.** `EngineApi` doesn't change.

`packages/sources/src/registry/types.ts`:

```ts
import type { SnapshotModule, SnapshotPlugin } from "@nf-builder/lang-core";

export type RegistrySource = "live" | "snapshot";

/** `version` is null only for a module the live registry lists and the snapshot lacks: it has no bundle yet. */
export type RegistryModule = Omit<SnapshotModule, "version"> & {
  readonly version: string | null;
};

export type RegistryErrorCode =
  | "unavailable" // 404 or 410: the site serves no snapshot
  | "invalid" //     not a JSON content type, unparsable, or not format 1
  | "http" //        any other non-2xx
  | "network" //     fetch rejected: offline, DNS or CORS (browsers don't say which)
  | "timeout";

export interface RegistryFailure {
  readonly code: RegistryErrorCode;
  readonly message: string;
}

export interface RegistryIndex {
  readonly source: RegistrySource;
  /** ISO UTC: the snapshot's generatedAt, or when the live lists were read. UX-14's age. */
  readonly asOf: string;
  /** ISO UTC: the snapshot's generatedAt (live data overlays the snapshot). */
  readonly snapshotAt: string;
  /** From the snapshot: the pack that classified typed and legacy, and the Nextflow plugin releases were chosen for. */
  readonly language: string;
  readonly nextflow: string;
  /** Sorted by name. */
  readonly modules: readonly RegistryModule[];
  /** Sorted by id. Always snapshot entries: the live list can only remove plugins (1.2). */
  readonly plugins: readonly SnapshotPlugin[];
  /** Set when live was tried and failed, so this index is the snapshot. */
  readonly liveFailure: RegistryFailure | null;
}

export interface RegistryReadOptions {
  /** Skip the copy held in memory and revalidate with the server (fetch cache mode "no-cache"). */
  readonly refresh?: boolean;
}

export interface RegistryClient {
  /** The source this client prefers; RegistryIndex.source says which one answered. */
  readonly source: RegistrySource;
  index(options?: RegistryReadOptions): Promise<RegistryIndex>;
}
```

**Later features extend the interface:** `ports(name)` (F-503 or F-504), `bundle(name, version)` (F-504, snapshot only) and `plugin(id, version)` (F-505). The combinator falls back per call, and the live client rejects calls it can't serve.

### 2.3 Snapshot client

- **URL.** `index.json` is resolved against `snapshotUrl`. The app passes `new URL(`${import.meta.env.BASE_URL}registry/`, window.location.href).href`.
- **Request.** `fetch(url, { credentials: "omit", cache: refresh ? "no-cache" : "default" })`.
  - Keep `fetch` in a local constant and call it bare, or bind it. Calling `options.fetch(...)` as a method throws "Illegal invocation" in browsers.
- **Validation.**

| Response | Result |
|---|---|
| 404 or 410 | `unavailable` |
| Any other non-2xx | `http` |
| `content-type` without `json` (a host with a single-page fallback answers HTML with 200) | `invalid` |
| JSON that doesn't parse | `invalid` |
| `format !== 1`, a `generatedAt` that `Date.parse` can't read, or `modules` or `plugins` not arrays | `invalid` |
| `fetch` rejects | `network` |

- **Memory.** The client keeps one promise per client. A rejected read is forgotten, as in `requestPaletteView`. `refresh` starts a new read, which replaces the copy only if it succeeds.
- **`fromSnapshot(index)`** maps the index to a `RegistryIndex` with `source: "snapshot"`, `asOf` and `snapshotAt` both set to `generatedAt`, and `liveFailure: null`.

### 2.4 Live client (dormant)

- **Requests** go to `${registryUrl}/api/v1/modules/list?size=100&page=N&kind=Process`, then `kind=Workflow`, then `/api/v1/plugins?size=100&page=N`. Pages continue until `last !== false`, as `tools/registry-snapshot/src/api.ts` does. The three lists are read in parallel, and each list's pages in order.
- **No preflight.** These are simple GETs with no custom headers and `credentials: "omit"`.
- **Timeout:** 10 s overall, with `AbortSignal.timeout`.
- **Overlay** (`overlayLive`):
  - For each live module that isn't revoked: the snapshot entry if the name exists there, else `{ name, version: null, kind, component: null, typed: null, description, keywords: [] }`.
  - Snapshot modules the live list doesn't contain are dropped.
  - Plugins are the snapshot entries whose id the live list contains. None are added, because the snapshot leaves out plugins with no release for 26.10.7 on purpose.
  - Kinds map `Process` to `process` and `Workflow` to `workflow`.
  - `asOf` is `now()`; `snapshotAt` is the snapshot's `generatedAt`.
- **Errors.** A rejected fetch gives `network`, a non-2xx gives `http`, a body that isn't JSON or has the wrong shape gives `invalid`, and an abort gives `timeout`.

### 2.5 Automatic fallback

`createRegistryClient({ snapshotUrl, live = LIVE_REGISTRY, … })`:

1. Read the snapshot. If it fails, reject with the snapshot's error. A live-only index without the snapshot is not offered (open point 9).
2. If `live` is false, return `fromSnapshot`.
3. Otherwise read live and return the overlay. On any live failure, return `fromSnapshot` with `liveFailure` set.

`refresh` passes through to both clients.

### 2.6 Caching

- **In memory.** One index per session, held by the client and mirrored in the web store. It survives switching to the Files tab, because the store is a module-level Zustand store.
- **HTTP cache.**
  - Pages sends `max-age=600` with an ETag and Last-Modified (observed). A reload within 10 minutes reads from cache; after that, a conditional request usually returns 304.
  - The refresh button uses `cache: "no-cache"`, which forces revalidation.
  - The first visit transfers about 172 kB gzipped.
- **No IndexedDB or Cache API copy.** The HTTP cache already covers reloads. A copy would duplicate 751 kB per origin under the quota the project store watches (IO-03), and it would add a stored format.
- **Live (dormant):** in memory only.

### 2.7 Offline and in frames

**Offline**
- There is no offline copy beyond the HTTP cache. The app has no service worker, and the spec has no offline requirement.
- A load while offline:
  - uses a cached index younger than 10 minutes;
  - otherwise shows the `network` message, and the refresh button retries.
- A refresh while offline keeps the index in memory, and the line under it says the refresh failed.
- The age always comes from `generatedAt`, so it stays truthful whatever the cache served.
- A retry with `cache: "force-cache"` was considered and left out (open point 7).

**Frames**
- `BASE_URL` makes the snapshot request same-origin inside any frame, and no storage is used.
- The HTTP cache is partitioned by top-level site, so a framed copy fetches once on its own.
- If live were on, the `Origin` a frame sends is the app's own, so CORS would behave as at top level.
- An end-to-end test covers a cross-origin iframe.

### 2.8 What the palette shows in F-502, and what F-503 changes

**Structure.** `PalettePanel` renders `<RegistrySection searching={…} />` after the generic tree or message. It renders even when the generic palette failed to load.

- **Section.** A `<section aria-labelledby="registry-heading">`, which gives a region named "registry.nextflow.io".
  - `h2.palette-heading` reads "registry.nextflow.io"; CSS uppercases it, as in the mockup.
  - To the right of the heading is an icon button: accessible name "Refresh registry data", `aria-describedby` pointing at the source line, and `title` giving the exact build time, for example "Snapshot built 22 Nov 2026, 00:00 UTC".
  - While a refresh runs it is disabled with `aria-busy`.
- **Source line.** A `<p aria-live="polite">`, not `role="status"`, so the F-204 status locators stay unique.

| State | Source line |
|---|---|
| Ready | "Snapshot · updated 5 hours ago" or "Live · updated just now" |
| Loading | "Loading registry modules…" |
| Refreshing | "Refreshing…" |

Ages use `Intl.RelativeTimeFormat("en-GB", { numeric: "auto" })`: just now, minutes, hours, "yesterday", days. A time in the future reads "just now". A 60-second clock keeps the age current.

- **Notes under the source line, as plain text:**
  - after a live failure: "The live registry couldn't be reached.";
  - after a failed refresh: "Couldn't refresh the registry data."
- **Failure messages, in place of the lists:**

| Code | Message |
|---|---|
| `unavailable` | "No registry snapshot is available on this site." |
| `network` or `timeout` | "Couldn't load registry modules. Check your connection, then refresh." |
| `invalid` or `http` | "The registry snapshot couldn't be read." |

- **Interim lists.**
  - "Modules" and "Plugins" are `h3` toggle buttons, as the generic categories are. Modules is open by default and Plugins closed. The state is session-only, so the persisted palette format doesn't change.
  - Each shows the first `REGISTRY_LIST_LIMIT = 50` names in index order (module names; plugin ids), with the description as the row's `title`.
  - When a list is capped, a note follows: "Showing 50 of 2,322 modules."
  - Rows use their own classes (`registry-item`, `registry-item-label`) and never `.palette-item*`.
  - No icons or tags: those are F-503's.
- **While searching,** both lists are hidden. The heading and source line stay. Registry search is F-503's.
- **The one test edit.** F-204 step 1's heading locator is narrowed to the generic region (`palette(page).getByRole("region", { name: /^Nextflow language · / })`). The assertion is unchanged.

**F-503 replaces the interim lists** with:
- namespace groups;
- process or workflow tags and `typed` tags;
- search;
- lazy loading;
- possibly persisted open state;
- the mockup's search placeholder, "Search components and modules".

### 2.9 Test hook

- `window.nfBuilderRegistry` is a getter in `main.tsx`, like the existing hooks. It returns `{ reload(options: { live: boolean }): Promise<void> }`.
- `reload` builds a new client with that `live` value and reads it again. It is used only by end-to-end tests, to drive the live path through the real UI, and it does nothing unless called.

### 2.10 Deleting the S4 probe (ADR 0023)

Re-run it first (task 0), then delete:
- `.github/workflows/s4-probe.yml` (a workflow edit: decide and record);
- `apps/web/public/spike/s4/`;
- `e2e/s4-probe/`, `e2e/s4-probe.config.ts` and `e2e/s4-probe-page.spec.ts`;
- `test/s4-probe.test.ts`.

These tests go with the behaviour they covered (ADR 0023), and the PR lists them. F-011 step 2's loop drops `"spike/s4/"`; public-HTML stamping stays covered by `test/security-policy-meta.test.ts:66`. Edit `spikes/README.md` line 3. `test/check-site.test.ts` keeps its synthetic page.

## 3. Files

### 3.1 Create

**`packages/sources/src/registry/types.ts`:** as in 2.2.

**`packages/sources/src/registry/errors.ts`:**

```ts
export class RegistryError extends Error implements RegistryFailure {
  readonly code: RegistryErrorCode;
  readonly url: string;
  readonly status: number | null;
  constructor(code: RegistryErrorCode, url: string, message: string, status?: number | null);
}
/** A RegistryError as plain data; anything else becomes { code: "network", message }. */
export function toFailure(error: unknown): RegistryFailure;
```

**`packages/sources/src/registry/snapshot.ts`:**

```ts
export interface SnapshotClientOptions {
  /** Absolute URL of the snapshot directory, ending in "/". */
  readonly snapshotUrl: string;
  readonly fetch?: typeof fetch;
}
export interface SnapshotRegistryClient extends RegistryClient {
  readonly source: "snapshot";
  /** The validated index.json: read once per client; `refresh` revalidates. */
  snapshot(options?: RegistryReadOptions): Promise<RegistrySnapshotIndex>;
}
export function createSnapshotClient(options: SnapshotClientOptions): SnapshotRegistryClient;
/** Throws RegistryError("invalid") unless format 1 with a parseable generatedAt and module and plugin arrays. */
export function parseSnapshotIndex(value: unknown, url: string): RegistrySnapshotIndex;
export function fromSnapshot(index: RegistrySnapshotIndex, liveFailure?: RegistryFailure | null): RegistryIndex;
```

**`packages/sources/src/registry/live.ts`:**

```ts
export const REGISTRY_URL = "https://registry.nextflow.io";
export interface LiveModule {
  readonly name: string;
  readonly kind: "process" | "workflow";
  readonly description: string;
  readonly revoked: boolean;
}
export interface LiveLists {
  readonly modules: readonly LiveModule[];
  readonly pluginIds: readonly string[];
}
export interface LiveClientOptions {
  readonly snapshot: SnapshotRegistryClient;
  readonly registryUrl?: string; // REGISTRY_URL
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number; // 10_000
  readonly now?: () => Date;
}
export function createLiveClient(options: LiveClientOptions): RegistryClient; // source "live"
export function overlayLive(snapshot: RegistrySnapshotIndex, live: LiveLists, asOf: string): RegistryIndex;
```

**`packages/sources/src/registry/client.ts`:**

```ts
/** Off: registry.nextflow.io sends no CORS headers (spike S4; re-checked 2026-11-23; ADR 00NN). */
export const LIVE_REGISTRY = false;
export interface RegistryClientOptions extends SnapshotClientOptions {
  readonly live?: boolean; // LIVE_REGISTRY
  readonly registryUrl?: string;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}
export function createRegistryClient(options: RegistryClientOptions): RegistryClient;
```

**Live test fixtures:** `packages/sources/test/fixtures/live/{modules-process-1.json, modules-workflow-1.json, plugins-1.json}`.
- They are small and shaped like `ListModulesResponse` and `ListPluginsResponse`.
- They use the fixture snapshot's names, plus one module the snapshot lacks (`nf-core/newtool`) and one revoked module. They leave out `nf-ffq`, to show pruning.

**Tests:**
- `packages/sources/test/registry-snapshot.test.ts`
- `packages/sources/test/registry-live.test.ts`
- `packages/sources/test/registry-client.test.ts`

These read the F-501 golden `index.json` through `node:fs` with `new URL("../../../tools/registry-snapshot/test/fixtures/expected/registry/index.json", import.meta.url)`. Reading a file is not an import, so dependency-cruiser is unaffected.

**`apps/web/src/registry/registry-client.ts`:**

```ts
/** The app's client: the snapshot under BASE_URL, live only when asked (the test hook) or when LIVE_REGISTRY is on. */
export function appRegistryClient(live: boolean): RegistryClient;
```

**`apps/web/src/registry/registry-store.ts`.** The default store creates its client on the first `load()`, never at import.

```ts
export type RegistryState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly index: RegistryIndex;
      readonly refreshing: boolean;
      readonly refreshFailure: RegistryFailure | null;
    }
  | {
      readonly status: "failed";
      readonly failure: RegistryFailure;
      readonly refreshing: boolean;
    };
export interface RegistryStore {
  readonly state: RegistryState;
  /** No-op unless idle (StrictMode calls effects twice). */
  load(): void;
  /** Keeps the current index while refreshing and on failure. From "failed", it retries. */
  refresh(): void;
  /** Test hook: a new client with `live`, then a fresh read. */
  reload(options: { readonly live: boolean }): Promise<void>;
}
export function createRegistryStore(makeClient: (live: boolean) => RegistryClient): StoreApi<RegistryStore>;
export const registryStore: StoreApi<RegistryStore>;
export function useRegistry<T>(selector: (store: RegistryStore) => T): T;
```

**`apps/web/src/registry/age.ts`:**

```ts
/** "just now", "5 minutes ago", "5 hours ago", "yesterday", "3 days ago" (en-GB); a future time is "just now". */
export function formatAge(iso: string, now: Date): string;
/** "22 Nov 2026, 00:00 UTC" */
export function formatBuildTime(iso: string): string;
/** "Snapshot · updated 5 hours ago" or "Live · updated just now". */
export function sourceLine(index: RegistryIndex, now: Date): string;
```

**`apps/web/src/registry/registry-section.tsx`:**

```ts
export const REGISTRY_LIST_LIMIT = 50;
export interface RegistrySectionViewProps {
  readonly state: RegistryState;
  readonly now: Date;
  readonly searching: boolean;
  readonly open: { readonly modules: boolean; readonly plugins: boolean };
  readonly onToggle: (list: "modules" | "plugins") => void;
  readonly onRefresh: () => void;
}
/** Presentational; static-markup tested. */
export function RegistrySectionView(props: RegistrySectionViewProps): JSX.Element;
/** Wires the store, a 60 s clock and session-only open state; calls load() in an effect. */
export function RegistrySection({ searching }: { readonly searching: boolean }): JSX.Element;
```

**Other web tests:**
- `apps/web/test/registry-age.test.ts`
- `apps/web/test/registry-store.test.ts`
- `apps/web/test/registry-section.test.tsx`

**`e2e/registry-palette.spec.ts`**, with a small console listener that records `{ text, url: message.location().url }`. Chromium's message for a failed fetch may not name the URL in its text.

### 3.2 Change

- **`packages/sources/src/index.ts`:** export the types, `RegistryError`, `toFailure`, `createSnapshotClient`, `parseSnapshotIndex`, `fromSnapshot`, `createLiveClient`, `overlayLive`, `REGISTRY_URL`, `LIVE_REGISTRY` and `createRegistryClient`.
- **`packages/sources/package.json`:** add `"@nf-builder/lang-core": "workspace:*"` as a dependency and `"@types/node": "22.20.5"` as a dev dependency, for fixture reads.
- **`packages/sources/tsconfig.json`:** `lib: ["ES2024", "DOM"]` and `types: ["node"]`.
- **`packages/sources/README.md`:** a line on the registry client.
- **`packages/sources/test/index.test.ts`:** keep the ADR-0003 test, and add that `createRegistryClient` is exported.
- **`apps/web/package.json`:** add `"@nf-builder/sources": "workspace:*"`. This is a workspace package that ADR 0003 already lists, not a new third-party dependency. `pnpm-lock.yaml` changes with it.
- **`apps/web/src/palette/palette-panel.tsx`:** render `<RegistrySection searching={searching} />` after the tree or message.
- **`apps/web/src/palette/palette.css`:** styles for `.palette-registry`, its heading row, `.registry-source`, `.registry-note` and `.registry-item`. Reuse the palette tokens.
- **`apps/web/src/shell/icons.tsx`:** add `RefreshIcon()`.
- **`apps/web/src/main.tsx`:** add the `window.nfBuilderRegistry` getter.
- **`e2e/palette.spec.ts`:** narrow F-204 step 1's heading locator to the generic region. Nothing else changes.
- **`e2e/app-shell-layout.spec.ts`:** in the `@visual` default-shell test, call `page.clock.setFixedTime(new Date("2026-11-22T05:00:00Z"))` before `goto`, so the age is deterministic. Re-approve the baseline from CI (ADR 0021).
- **`e2e/pages-hosting.spec.ts`:** F-011 step 2 loops over `"./"` only.
- **`spikes/README.md`:** line 3 no longer points at `e2e/s4-probe/`.
- **Docs:** listed in section 7.

### 3.3 Delete

The S4 probe files in 2.10.

## 4. Tests (written first in each task; IDs in the names)

### `packages/sources/test/registry-snapshot.test.ts`

1. **"F-502 IO-30 IO-31: the snapshot client reads index.json under snapshotUrl and returns its modules and plugins as source snapshot, with asOf and snapshotAt = generatedAt"**
   - Uses a fake `fetch` serving the F-501 golden.
   - Asserts the requested URL, three modules in order and two plugins.
2. **"F-502 IO-30 ADR-0035: a 404 rejects with code unavailable; a 500 with code http"**
3. **"F-502 IO-30 ADR-0040: an HTML 200, unparsable JSON, format 2 or a bad generatedAt each reject with code invalid"**
4. **"F-502 IO-30: a rejected fetch rejects with code network"**
5. **"F-502 UX-14: one request per client; a rejected read is forgotten; refresh re-reads with cache no-cache and replaces the copy only on success"**
6. **"F-502 IO-30: requests omit credentials"**

### `packages/sources/test/registry-live.test.ts`

7. **"F-502 IO-30 ADR-0009: the live client pages modules/list for kind Process and Workflow and plugins with size 100 until last, as OpenAPI 0.14.0 describes"**
   - Asserts the exact URLs.
8. **"F-502 IO-30: the overlay keeps snapshot details for modules still listed, adds unlisted ones with version, component and typed null, drops revoked and missing modules, and only prunes plugins"**
9. **"F-502 IO-30: live requests are simple GETs: no custom headers and credentials omitted, so no preflight"**
10. **"F-502 IO-30: a TypeError (as CORS gives), HTTP 429 or 5xx, a non-JSON body or the timeout rejects with network, http, invalid or timeout"**

### `packages/sources/test/registry-client.test.ts`

11. **"F-502 step 1 IO-30 ADR-0009: with live off, index() reads only the snapshot and requests nothing from registry.nextflow.io"**
12. **"F-502 step 2 IO-30: with live on and the registry answering, index() returns source live and asOf = now"**
13. **"F-502 step 1 IO-30: with live on and the registry failing, index() falls back to the snapshot and sets liveFailure"**
14. **"F-502 IO-30: when the snapshot fails, index() rejects with its error, even with live on"**
15. **"F-502 ADR-00NN: LIVE_REGISTRY is off until the registry sends CORS headers"**

### `apps/web/test/registry-age.test.ts`

16. **"F-502 UX-14: formatAge says just now, minutes, hours, yesterday and days in British English, and just now for a future time"**
17. **"F-502 UX-14: formatBuildTime gives the build time in UTC, and sourceLine names the source and the age"**

### `apps/web/test/registry-store.test.ts`

Uses a fake client.

18. **"F-502 UX-14: load() reads once; a second load() is a no-op"**
19. **"F-502 UX-14: refresh() keeps the index while refreshing and on failure, and records refreshFailure"**
20. **"F-502 IO-30: a failed first load records the failure, and refresh() retries"**
21. **"F-502 IO-30: reload({ live: true }) builds a live client and reads again"**

### `apps/web/test/registry-section.test.tsx`

Static markup.

22. **"F-502 step 1 UX-14: a snapshot index shows the registry.nextflow.io heading, 'Snapshot · updated 5 hours ago' and a Refresh registry data button described by that line"**
23. **"F-502 step 2 UX-14: a live index says 'Live · updated just now'"**
24. **"F-502 step 1 IO-30: after a live failure the section says the live registry couldn't be reached"**
25. **"F-502 IO-30 ADR-0035: unavailable, network and invalid failures each show their message and keep the refresh button"**
26. **"F-502 UX-14: lists show at most 50 names with a 'Showing 50 of N' note, are hidden while searching, and use no palette-item classes and no role=status"**
27. **"F-204 F-502: before the store loads, PalettePanel still renders statically"**
   - The existing test, extended so it also renders the registry section in its loading state.

### `e2e/registry-palette.spec.ts`

All tests run on the preview with the fixture snapshot. The clock is fixed at `2026-11-22T05:00:00Z` where an age is asserted.

28. **"F-502 step 1 IO-30 UX-14: with registry.nextflow.io blocked, the palette lists the snapshot's modules and says Snapshot · updated 5 hours ago, with no request to the registry and no console error or CSP violation"**
29. **"F-502 step 1 IO-30 ADR-0009: with live forced on and the registry blocked, the palette falls back to the snapshot and says the live registry couldn't be reached"**
   - Only console errors from registry URLs are tolerated.
30. **"F-502 step 2 UX-14: with live forced on and the registry routed with Access-Control-Allow-Origin, the palette says Live, lists a module the snapshot lacks, and drops the revoked one"**
31. **"F-502 UX-14: refresh re-reads the snapshot and shows its new age; offline, a refresh keeps the lists and says it couldn't refresh"**
32. **"F-502 IO-30 ADR-0035: when the site serves no snapshot, the palette says no registry snapshot is available"**
    - `index.json` is routed to a 404 with `text/html`. Only that 404 console error is tolerated.
33. **"F-502 ADR-0044 QA-30: inside a cross-origin iframe the palette shows the registry snapshot"**
    - Matches `/^Snapshot · /`, so the test doesn't depend on the frame's clock.

### Existing tests changed

- F-204 step 1: the locator is narrowed.
- F-011 step 2: `spike/s4/` is dropped.
- The `@visual` default shell test: the clock is fixed, and the baseline is re-approved from CI.
- Deleted: the F-008 tests in 2.10, removed with their behaviour (ADR 0023).

## 5. Tasks (in order, one builder run each; branch `feat/F-502`)

**Task 0 (orchestrator, docs only).** Re-run the S4 probe, as the F-502 note requires.
- Run `gh workflow run "S4 probe" -f url=https://ewels.github.io/nf-builder/`, wait for it, and download the `s4-probe` artefact.
- Append a dated addendum to `docs/research/2026-11-22-spike-s4-cors.md` with the run id, the verdicts and the 2026-11-23 `curl` results (section 8).
- If any registry target is allowed, stop and re-plan: turn live on, and step 2 becomes real.
- Done when: the run has concluded, the addendum is on `main` (ADR 0031), and `pnpm check` is green.

**Task 1.** Set up `packages/sources` (package.json, tsconfig), then add `types.ts`, `errors.ts`, `snapshot.ts` and their exports, with tests 1 to 6 first.
- Done when: `pnpm --filter @nf-builder/sources test` and `pnpm check` are green.

**Task 2.** Add `live.ts`, `client.ts` and the live fixtures, with tests 7 to 15 first.
- Done when: `pnpm --filter @nf-builder/sources test` and `pnpm check` are green.

**Task 3.** In `apps/web`: add the `@nf-builder/sources` dependency, `registry-client.ts`, `registry-store.ts`, `age.ts` and the `window.nfBuilderRegistry` hook, with tests 16 to 21 first.
- Done when: `pnpm install`, `pnpm --filter @nf-builder/web test` and `pnpm check` are green.

**Task 4.** Add `registry-section.tsx`, `RefreshIcon`, the CSS and the `PalettePanel` change, with tests 22 to 27 first. Narrow F-204 step 1's locator.
- Done when: `pnpm check`, `pnpm build && pnpm check:budget && pnpm check:hosts`, and `pnpm test:e2e -- --grep "F-204|F-011"` are green.

**Task 5.** Add `e2e/registry-palette.spec.ts` (tests 28 to 33) and the fixed clock in the `@visual` shell test.
- Done when: `pnpm test:e2e -- --grep F-502` is green locally (export `PW_CHROMIUM_EXECUTABLE`) and `pnpm check` is green.
- The baseline is re-approved from CI's `playwright-chromium` artefact after the first CI run (ADR 0021).

**Task 6.** Delete the S4 probe (2.10), update F-011 step 2 and `spikes/README.md`.
- Done when: `pnpm check` and `pnpm test:e2e -- --grep "F-011|F-502"` are green, and `git grep -n -e "spike/s4" -e "s4-probe" -- . ':!docs'` matches only the synthetic page in `test/check-site.test.ts`.

**Task 7 (orchestrator).** Records (section 7).
- Done when: `pnpm check` is green (`check:adr`, `check:features`) and the PR template is complete.

## 6. Open points (each with a recommendation; none decided here)

1. **The live gate.**
   - **Recommendation:** a constant `LIVE_REGISTRY = false`, recorded in an ADR, plus the test hook (2.1, 2.9).
   - **Alternative A:** a CORS check recorded daily by the snapshot build, so live switches on by itself (2.1). It changes F-501's tool and adds an optional field to the stored format.
   - Either one needs an ADR. A also needs a format decision.
2. **Step 2 and `passes`.** The step's condition ("if S4 allowed it") is false.
   - **Recommendation:** set `passes: true`. Notes cite the task 0 run, the `curl` check and test 30, which shows the live UI path end to end.
   - Don't reword the step, so no `scope-change` label is needed.
3. **Deleting the S4 probe now.**
   - **Recommendation:** yes, after task 0, as ADR 0023 says. Removing `.github/workflows/s4-probe.yml` is a workflow edit: decide and record.
   - Afterwards, re-checking means the `curl` command in the ADR, or alternative A.
4. **The interim lists.**
   - **Recommendation:** 50 names each; Modules open and Plugins closed; session-only open state; hidden while searching; distinct classes. F-503 replaces them.
5. **Copy.**
   - **Recommendation:** the strings in 2.8, in British English and sentence case.
6. **A staleness warning.**
   - **Recommendation:** none. The spec has no threshold, and the age is always shown.
   - If the daily run stops (GitHub disables schedules after 60 days without activity, ADR 0041), the age shows it.
7. **Offline.**
   - **Recommendation:** HTTP cache only, with no `force-cache` retry and no IndexedDB copy (2.6, 2.7).
8. **`pnpm dev` has no `/registry/`.**
   - **Recommendation:** leave it. Dev shows "No registry snapshot is available on this site." Serving `REGISTRY_SNAPSHOT_DIR` in dev can come later.
9. **Live on with no snapshot.**
   - **Recommendation:** reject with the snapshot's error, with no live-only index. This can only happen once live is turned on.
10. **`version: null` modules.**
    - **Recommendation:** add notes to F-503 (show them without a typed tag) and F-504 (not insertable until the next snapshot). This only matters once live is on.
11. **The client surface.**
    - **Recommendation:** `index()` only for now. `ports`, `bundle` and `plugin` arrive with F-503 or F-504, F-504 and F-505.
12. **The F-204 locator and the visual re-approval.**
    - **Recommendation:** accept both, and record them in the PR. The F-204 locator is narrowed with its assertion unchanged, and the baseline changes because the shell now shows the section.
13. **The ADR number.**
    - Take the next free number when this lands. 0048 and 0049 are claimed by F-208 and F-206, and F-207 and F-209 each add one.
14. **A licences row for the live fixtures.**
    - **Recommendation:** extend row 19 in `docs/licences.md` (recorded registry data, MIT and Apache-2.0) to cover `packages/sources/test/fixtures/live/`.
    - Alternatively, use only synthetic descriptions.

## 7. Records (drafts for the orchestrator)

**ADR `00NN-registry-client.md`, Accepted (agent).** Title: "Read the registry from the snapshot, with a live client kept off until the registry allows cross-origin reads".
- **Context:** sections 1.2 and 8.
- **Decision:**
  - sections 2.1 to 2.10;
  - `LIVE_REGISTRY` and how to turn it on;
  - the re-check command;
  - the overlay rules;
  - no stored copy;
  - the probe deletion and the tests removed with it.
- **Consequences:**
  - ADR 0040's "Spike S4" line lapses;
  - ADR 0023's lifetime is fulfilled;
  - the browser makes no request to `registry.nextflow.io` today;
  - F-503, F-504 and F-505 extend the client.
- **Alternatives:**
  - trying live on every load;
  - alternative A;
  - a live-only index;
  - a client in the worker;
  - an IndexedDB copy.
- Add its row to `docs/adr/README.md`.

**IO-30 in `docs/spec/data-and-io.md`, amended:** "One `RegistryClient` with live and snapshot implementations and automatic fallback (ADR 0009). The app reads live only when the registry allows cross-origin reads; until then the snapshot is its source (ADR 00NN)."

**`features.json`** (`passes` set and notes appended only):
- **F-502:** passing. Note the step 1 tests, step 2's false condition with the run id and the `curl` date, test 30, and the probe deletion.
- **F-008:** "The probe page, workflow and tests were deleted by F-502 (ADR 0023); re-check CORS as ADR 00NN says."
- **F-503:**
  - the client is `useRegistry` in `apps/web/src/registry/`;
  - replace the interim lists (`REGISTRY_LIST_LIMIT`) and keep the heading, refresh button and source line;
  - registry rows use `registry-item` classes;
  - F-204 tests scope to the generic region;
  - `version: null` means a module the live registry has and the snapshot doesn't;
  - the mockup's placeholder is "Search components and modules".
- **F-504:**
  - add `bundle(name, version)` to `RegistryClient`, snapshot only (`public-cr-prod.seqera.io` has no CORS headers and isn't on the allow-list);
  - fetch in the document and pass files to the worker;
  - `version: null` isn't insertable.
- **F-505:** add `plugin(id, version)` to `RegistryClient`.

**`progress.md` Decisions:**
- the ADR;
- `.github/workflows/s4-probe.yml` deleted;
- tests removed with their behaviour under ADR 0023, listed;
- `@nf-builder/sources` added to the web app's dependencies, as ADR 0003 allows, with no dependency-cruiser change;
- the F-204 locator narrowed;
- the app-shell baseline re-approved from CI.

**Other records:**
- **`docs/plan/handoff/README.md`:** add the F-502 row and its settled points.
- **Research addendum:** task 0.
- **`docs/licences.md`:** open point 14.
- **PR:** "Decisions made for the maintainer" lists all of the above. The "No tests … deleted" checkbox is answered with the ADR 0023 list.

## 8. Evidence

**Registry headers** (2026-11-23, about 00:51 UTC, with `-H "Origin: https://ewels.github.io"`):
- **HEAD with `curl -sS -I`:**
  - `/api/v1/service-info`, `/api/v1/modules/nf-core%2Ffastqc`, `/api/v1/modules/list?search=fastqc&size=5` and `/api/v1/plugins/nf-schema` all returned `HTTP/2 200`.
  - None sent an `access-control-*` header. They sent `ratelimit-limit: 100`, `ratelimit-reset: 59` and the registry's own `content-security-policy`.
- **GET with `curl -sS -D - -o /dev/null`:**
  - On `modules/nf-core%2Ffastqc`: 200, `content-type: application/json`, no `access-control-*`.
  - Same result on `service-info`, `plugins?size=1` and `modules?query=fastqc&limit=1`.
- **`OPTIONS` preflight** (`Access-Control-Request-Method: GET`) on `modules/nf-core%2Ffastqc`: `HTTP/2 401`, no `access-control-*`.
- **Download:** `GET …/nf-core%2Ffastqc/0.0.0-6d1763b/download` returned `HTTP/2 307` with `location: https://public-cr-prod.seqera.io/docker/registry/v2/blobs/sha256/f9/f9be…/data`.

**List shapes:**
- `modules/list` items: `id`, `name`, `repositoryPath`, `commitId`, `revoked`, `description`, `downloadCount`, `createdAt`, `updatedAt` and `kind: "Process"`, plus paging fields. There is no version, component, keywords or typed flag.
- `plugins?size=1` returned `{"plugins":[{"id":"nf-agent","downloadCount":24,"downloadGhCount":0}],"totalSize":112,…}`.
- The OpenAPI document is `/openapi/openapi-latest.yaml`, and `versions.txt` says `0.14.0`.
  - `modules/list` takes `search`, `page` (1-based), `size` (default 20, max 100) and `kind`, which returns only `Process` modules when omitted.
  - `plugins` takes `search`, `page` and `size` (max 100).

**Pages snapshot:**
- `https://ewels.github.io/nf-builder/registry/index.json` returned `HTTP/2 200` with:
  - `content-type: application/json; charset=utf-8`;
  - `cache-control: max-age=600`;
  - `etag: "6b038400-b759d"`;
  - `last-modified: Mon, 23 Nov 2026 00:08:32 GMT`;
  - `access-control-allow-origin: *`;
  - `content-encoding: gzip` and `content-length: 171991`.
- Body: `format: 1`, `generatedAt: "2026-11-22T20:11:31.626Z"`, `apiVersion: "0.29.1"`, `language: "26.10"`, `nextflow: "26.10.7"`, 2,322 modules and 104 plugins.
- `registry/does-not-exist.json` returned 404 with `text/html; charset=utf-8`.
- `JSON.parse` of the 751,005-byte index took 1.46 ms at best (Node 22.23.5, 20 runs).

**Repository** (`origin/main` `2c3cc69`):
- **Snapshot format and reading notes:**
  - `packages/lang-core/src/registry-snapshot.ts`
  - `docs/plan/features.json` (F-502 notes)
  - `docs/adr/0009`, `0023`, `0035`, `0040`, `0041`, `0043`, `0044`
  - `docs/research/2026-11-22-spike-s4-cors.md` ("a live attempt shows CORS errors in the console")
- **Serving and recording:**
  - `scripts/registry-snapshot-site.ts` (`apply: "build"`)
  - `playwright.config.ts` (`REGISTRY_SNAPSHOT_DIR`)
  - `tools/registry-snapshot/src/{api.ts,recording.ts}` (`listAll` paging; `KEPT_HEADERS` without `access-control-*`)
- **Palette and app:**
  - `apps/web/src/palette/*`
  - `apps/web/src/main.tsx`
  - `e2e/palette.spec.ts`: lines 74 and 186 to 209 are the collisions
  - `e2e/pages-hosting.spec.ts`
  - `e2e/app-shell-layout.spec.ts`
- **Mockup:** `docs/mockup/1-main.png` shows "REGISTRY.NEXTFLOW.IO" with a refresh icon on the right, a Modules accordion and an nf-core group.

My planning worktree and downloads in the scratchpad have been removed.