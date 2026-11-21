# @nf-builder/corpus

Build-time tool (ADR 0003, ADR 0011): pins the real pipelines the corpus tests use and fetches them. Standalone: it imports no workspace package.

- `corpus.yaml`: one entry per pipeline: `id`, GitHub `repo`, human `ref` (tag or branch) and the full commit `sha` that is fetched. Bump pins in their own PR.
- `pnpm corpus:fetch` checks out each pin with git into `.cache/corpus/<id>/` (git-ignored). A second run makes no network call; `pnpm corpus:fetch --check` only verifies the cache.
- `fixtures/`: committed, intentionally malformed Nextflow files. `fixtures/fixtures.yaml` says what each breaks and the expected outcome (ADR 0004).
- Delete `.cache/corpus` to fetch everything again.
