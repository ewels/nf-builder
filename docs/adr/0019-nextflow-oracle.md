# 0019. Run the Nextflow oracle from the pinned release, locally and in CI

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0011 uses real Nextflow as an oracle, from the Docker image `nextflow/nextflow:26.10.x`, in CI only. ADR 0018 lets agents also run Nextflow locally and says F-005 pins the version and adds a wrapper. Spike S1 (F-005) is the oracle's first user; templates (F-203), the printer (F-110) and exports (F-301, F-404, F-504) follow. The agent sandbox has Java 21 and no Docker daemon. Each release ships `nextflow-<version>-dist`, the launcher with the runtime jar appended, which runs offline on Java 17 to 26. The release publishes no checksum. Research: [spike S1 report](../research/2026-11-22-spike-s1-typed-legacy-interop.md).

## Decision

This amends ADR 0011's Nextflow oracle row and ADR 0018's local-run rule; everything else in them stands.

| Layer | What | Runs |
|---|---|---|
| Nextflow oracle | `pnpm oracle` (`tools/oracle`) runs `nextflow lint -o json` and `nextflow run -stub` on a manifest of cases with the pinned release; later features add templates, edit outputs, edited corpus exports and `lint -format` diffs | locally, and CI (`oracle` job) |

- **Pin:** `packages/lang-2610/upstream.json` holds the Nextflow version (`nextflow.version`) and the URL and SHA-256 of its `-dist` asset (`nextflowDist`). It is the pack's one home for upstream pins (ADR 0006, LA-02); the grammar and language server pins join it (F-006). Nothing else names the Nextflow version. Bumps go in their own PR. The oracle reads the file by path, so `tools/oracle` stays standalone (ADR 0003).
- **Entry points:** `pnpm nextflow -- <args>` downloads the asset into `.cache/nextflow/<version>/` with curl, checks the SHA-256 and runs it with `NXF_HOME=.cache/nextflow/home`, `NXF_OFFLINE=true`, `NXF_DISABLE_CHECK_LATEST=true`, `NXF_ANSI_LOG=false` and `NXF_SYNTAX_PARSER=v2`, dropping inherited `NXF_VER` and launcher variables. `pnpm oracle` runs each case in a fresh copy under `.cache/oracle/runs/` and compares the exit status and expected messages with `tools/oracle/cases/cases.yaml`.
- **CI:** the `oracle` job in `ci.yml` sets up Temurin 21 with `actions/setup-java`, caches `.cache/nextflow` keyed on `upstream.json`, prints `nextflow -version`, runs `pnpm oracle` and uploads `.cache/oracle/` even on failure.
- **Cases:** each case cites the sources its Nextflow code follows. Expectations must match real Nextflow; a PR that changes one says why.
- **Layout:** `tools/oracle` joins ADR 0003's standalone build-time tools.
- **Hosts:** build-time only (ADR 0017's rule): `github.com` release downloads, redirected to `release-assets.githubusercontent.com`.

## Consequences

- Agents check Nextflow code locally before CI; CI and local runs use the same file and flags.
- Docker isn't needed. Java 17 to 26 is needed for the oracle, not for `pnpm check`.
- Renovate doesn't bump the pin; bumping it means a new SHA-256 from a fresh download, cross-checked in CI.
- Offline mode means a case that needs a plugin fails until the oracle pre-fetches plugins; F-203 will meet this first.

## Alternatives

- Docker image `nextflow/nextflow:26.10.7` pinned by digest: CI only (no Docker daemon in the sandbox) and a second artefact to pin.
- `get.nextflow.io` launcher with `NXF_VER`: downloads the framework at first run from an unpinned source.
- `nf-core/setup-nextflow` action: third-party, CI only.
- The pin in `tools/oracle/oracle.yaml`: a second home for the version once the pack carries its own pins.
