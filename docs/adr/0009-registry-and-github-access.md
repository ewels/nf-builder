# 0009. Read the registry and GitHub straight from the browser, with a snapshot fallback

- Status: Accepted
- Date: 2026-11-21

## Context

The palette needs registry modules (ports from `meta.yml`) and plugins (definitions from plugin spec JSON). Imports need GitHub repos and zips. A static app can only call hosts that allow cross-origin requests. The GitHub API does. The registry and `raw.githubusercontent.com` are unverified.

## Decision

**Registry:**
- One `RegistryClient`, with live and snapshot implementations. The app prefers live and falls back to the snapshot; the palette shows which is in use and how old the snapshot is.
- A daily GitHub Action builds the snapshot:
  - module index, including ports and whether each module is typed;
  - one bundle per module, loaded lazily;
  - plugin index and specs.
- Inserting a module writes it to `modules/<namespace>/<name>/` and includes it by name, as `nextflow module install` does. Write `.module-info` only once spike S1 confirms its format.
- Registry pipelines are out of scope.

**GitHub import:**
1. Resolve the ref to a SHA.
2. List the tree recursively. That is two API calls in all.
3. Fetch the files from `raw.githubusercontent.com`.

Private repos use a token and the blobs API. The token is held in memory unless the user ticks "remember".

**Zip import:** unzip in a worker and strip a single top-level folder.

**Both import routes:**
- Text files up to 1 MB.
- An editable ignore list (`work/`, `results/`, test data).
- Limits of 20,000 entries and 200 MB.
- A summary shown before creating the project.
- The source repo and SHA recorded on the project.

## Consequences

- Works whatever the registry's CORS policy turns out to be. The snapshot may be a day stale.
- No token is needed for public repos.

## Alternatives

- Proxy service: ruled out by ADR 0002.
- isomorphic-git or archive zips: need a proxy, or have unverified CORS.

## Spike result

2026-11-22, spike S1 ([report](../research/2026-11-22-spike-s1-typed-legacy-interop.md)), Nextflow 26.10.7 source: `.module-info` is a Java properties file (written with `Properties.store`, so a `#<date>` comment line comes first and `:` in values is escaped as `\:`) with two keys: `checksum`, the SHA-256 of the installed module directory without `.module-info`, and `registryUrl`, the URL the bundle was downloaded from. Nextflow writes it on `module install`, uses it as the marker for `module list`, and compares the checksum to detect local changes; without it, `module remove` refuses the folder unless `-force` is given. The checksum comes from `io.seqera:npr-client` (`ModuleChecksum.computeDirectory`), whose file order and normalisation the spike couldn't read. Inserting a module therefore doesn't write `.module-info` yet; F-504 decides once the algorithm is verified with the oracle (`nextflow module list` on a written module). Spike S4 is still open.

2026-11-22, spike S4 ([report](../research/2026-11-22-spike-s4-cors.md)), probe page on deploy preview #14 (commit dd44cf4) in Chromium 159, Firefox 159 and WebKit 27.2, all three agreeing:
- `registry.nextflow.io` sends no `Access-Control-Allow-Origin` on any endpoint the app would use and answers preflights with 401, so browsers block every read from the app's origin. Module bundle downloads redirect (307) to `public-cr-prod.seqera.io`, which sends no CORS headers either. The live `RegistryClient` can't work today: the snapshot, this decision's fallback, is the registry source, and module bundles come from it. F-502's live step applies only if a re-run of the S4 probe shows access.
- `raw.githubusercontent.com` and `api.github.com` (commits, recursive trees) send `Access-Control-Allow-Origin: *`: the GitHub import route stands as written.
- `codeload.github.com` answers with `Access-Control-Allow-Origin: https://render.githubusercontent.com`, so archive downloads (direct, through the `zipball` API or through `github.com/.../archive/...`) are blocked. Zip import stays a user upload, and ADR 0014's possible `codeload.github.com` loosening isn't needed.
- Endpoint paths were verified against the registry's OpenAPI 0.14.0: every path is under `/api/v1/`, and module names must be URL-encoded (`nf-core%2Ffastqc`).

The decision stands.
