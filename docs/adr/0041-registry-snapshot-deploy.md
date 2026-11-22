# 0041. Deploy the registry snapshot with the site from Actions

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

ADR 0035 publishes the daily registry snapshot to the `registry-snapshot` branch. Netlify builds copied it in, and a `NETLIFY_BUILD_HOOK` secret was meant to redeploy after each snapshot (#27). Netlify couldn't read the branch while the repository was private (#31). Production now moves to GitHub Pages, deployed from Actions (ADR 0040). A push made with `GITHUB_TOKEN`, such as the snapshot publish, doesn't start other workflows. A `workflow_run` trigger does, but only when the triggering workflow's file is on the default branch. Research: [GitHub Pages hosting](../research/2026-11-22-github-pages.md).

## Decision

- **Trigger.** `pages.yml` runs on `workflow_run` of `Registry snapshot` (completed, on `main`). Its build job runs only when `github.event_name != 'workflow_run' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event != 'pull_request')`.
- **Combining.**
  - The build checks with `git ls-remote` whether the `registry-snapshot` branch exists.
  - If it does, the build checks the branch out without credentials into an absolute `REGISTRY_SNAPSHOT_DIR`, and the existing plugin copies `registry/**` into the site.
  - If it doesn't, the deploy goes ahead without `/registry/`, so a deploy never depends on the snapshot.
  - A full `pnpm check:registry` runs on the built `dist` before the upload.
- **Deployed check.** On snapshot-triggered runs, `verify` runs `pnpm check:registry --url` on a cache-busted sample: the index, `ports.json`, 20 evenly spaced bundles and 5 plugin files. `--all` checks every file on a manual run.
- **Plugin.** The plugin is host-neutral: `REGISTRY_SNAPSHOT_DIR` first, else a shallow anonymous clone of `REGISTRY_SNAPSHOT_REPO`'s branch. The `NETLIFY` switch and `REGISTRY_SNAPSHOT_TOKEN` are gone.
- **`registry-snapshot.yml`.** It loses its `verify` job and the hook, and stops writing `netlify.toml` to the branch. Its own git calls keep the job token.
- **What stands from ADR 0035, which this supersedes:**
  - format v1 and its files;
  - the builder and its dependency-cruiser exception;
  - the failure policy;
  - `pnpm check:registry` and QA-06;
  - the daily schedule, dispatch, and the dry run on pull requests;
  - publishing a single orphan commit of `registry/**` to `refs/heads/registry-snapshot`, never to `main`;
  - "not part of CI green";
  - Playwright's preview using the golden fixture snapshot;
  - the build-time hosts (ADR 0017): `registry.nextflow.io`, `public-cr-prod.seqera.io`, and `github.com` from the workflow and the Pages build.

## Consequences

- **No secret.** #27 and #31 are closed, and the snapshot goes live minutes after each successful daily run.
- **Limits.** `workflow_run` fires only from the default branch's file and chains at most three workflows deep. A run that concurrency leaves pending is covered by the next deploy.
- **Netlify.** A Netlify development site serves the snapshot only if its environment sets `REGISTRY_SNAPSHOT_REPO`.
- **Scheduling.** GitHub disables scheduled workflows in a public repository after 60 days without activity; re-enable `Registry snapshot` if it stops.

## Alternatives

- A push trigger on `registry-snapshot`: pushes made with `GITHUB_TOKEN` don't start workflows.
- `workflow_call` from the snapshot workflow: it would grant `pages` and `id-token` beside a long third-party job.
- `gh workflow run`: needs an extra `actions: write`.
- One combined workflow, or a second cron: they mix deploy and snapshot failures, or are fragile.
- Building the snapshot on every deploy: about two hours against a third-party registry.
