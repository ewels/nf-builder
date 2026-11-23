# Spikes

Throwaway spike pages that needn't be deployed use `spikes/<id>/` (ADR 0024). They are outside the pnpm workspace and are not built by `pnpm build`. A deployed probe follows ADR 0023; S4's was deleted by F-502.

- Only `e2e/` and `test/` import them.
- Each `spikes/<id>/` has a README saying how to run it and which feature and ADR it serves.
- A spike folder is deleted by the feature that ships the real thing.

Current spikes: [`s5-nf-metro`](s5-nf-metro/README.md) (F-010).
