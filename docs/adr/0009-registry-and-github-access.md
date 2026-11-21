# 0009. Read the registry and GitHub straight from the browser, with a snapshot fallback

- Status: Accepted (spike S4 to confirm)
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
