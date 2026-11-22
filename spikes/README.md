# Spikes

Throwaway spike pages (ADR 0024). They are not in the pnpm workspace and are not built by `pnpm build` or deployed.

- Only `e2e/` and `test/` import them.
- Each `spikes/<id>/` has a README saying how to run it and which feature and ADR it serves.
- A spike folder is deleted by the feature that ships the real thing.
- F-007 and F-008 may add `spikes/s3-*` and `spikes/s4-*` lines here; whoever merges second rebases.

Current spikes: [`s5-nf-metro`](s5-nf-metro/README.md) (F-010).
