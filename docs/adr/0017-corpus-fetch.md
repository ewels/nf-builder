# 0017. Fetch the corpus by commit SHA with git and cache it in Actions

- Status: Accepted (agent)
- Date: 2026-11-21

## Context

ADR 0011 tests the parser and engine against pinned real pipelines that must not be committed. F-009 needs a way to fetch them reproducibly, offline on a second run, and cheaply in CI. From the agent sandbox, `git` over `https://github.com` and `raw.githubusercontent.com` work, but the GitHub REST API for other repositories and `codeload.github.com` (tarballs) are refused. ADR 0002's host allow-list was written for the shipped app. Research: pins and fetch methods were checked on 2026-11-21 (nf-core tags are lightweight, so tag SHA equals commit SHA).

## Decision

- `tools/corpus/corpus.yaml` lists each pipeline with an `id`, `repo`, a human `ref` (tag or branch) and the full commit `sha`. Pins change only in their own PR.
- `pnpm corpus:fetch` (`tools/corpus`, a standalone build-time tool) fetches each pin by SHA with `git fetch --depth 1`, checks that HEAD equals the pin, removes `.git`, and writes `.cache/corpus/<id>/` plus `.cache/corpus/<id>.complete` (the SHA, written last). A second run that finds every marker makes no network call.
- `tools/corpus/fixtures/` holds committed, intentionally malformed Nextflow files; `fixtures.yaml` records what each breaks, the expected `nextflow lint` result and which declarations the engine should keep unparsed or still model (ADR 0004). Those expectations are hypotheses until the oracle (ADR 0011) and the parser (F-104) confirm them; a PR that changes one says why.
- CI restores `.cache/corpus` with `actions/cache`, keyed on a hash of `corpus.yaml` (bump the key's version prefix by hand if the cache layout changes), then runs the fetch. A `corpus` job proves the cache works; later jobs reuse the composite action.
- ADR 0002's allow-list governs what the shipped app contacts at runtime (IO-41 scans the built bundle only). Build-time tools in development and CI may use `github.com` over git, the npm registry, Docker Hub and other hosts their job needs, recorded in the ADR that adds them.
- `yaml` (dev dependency of `tools/corpus`) parses the YAML files; it is already in ADR 0003's stack.

## Consequences

- Fetching the corpus needs only `git`, works in the sandbox and in Actions, and is immutable per pin.
- A work-in-progress branch pin (`nextflow-io/rnaseq-nf@static-typing`) can disappear if force-pushed; the CI cache hides that until `corpus.yaml` changes, when the pin must be bumped.

## Alternatives

- Git submodules or committing the corpus: ADR 0011 rejects bloating the repository.
- GitHub tarballs (`api.github.com/.../tarball`, redirecting to `codeload.github.com`): unreachable from the agent sandbox.
- One raw download per file: about 580 requests and still needs the tree API.
