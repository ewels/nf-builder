# 0002. Browser-only static app, projects stored in IndexedDB

- Status: Accepted
- Date: 2026-11-21

## Context

The tool must be free to host, open source, and keep users' code on their machine.

## Decision

- A static single-page app. Netlify builds it from `main` using `netlify.toml` and serves it at https://nf-builder.netlify.app; pull requests get deploy previews. `netlify.toml` also sets the security headers (QA-30). No backend, accounts or telemetry.
- At runtime it talks only to:
  - GitHub (API and raw content);
  - `registry.nextflow.io`;
  - its own origin;
  - the CheerpJ CDN, if ADR 0010 is adopted.
- Anything that needs a server step runs in GitHub Actions at build time and ships as static files. That covers registry snapshots and language catalogues.
- Projects live in IndexedDB (via Dexie): projects, files, settings.
  - Autosave 500 ms after each edit.
  - Request persistent storage on first save.
  - Warn at 80% of quota.
  - "Export all projects" gives a zip backup.

## Consequences

- Nothing to operate.
- Cross-origin rules decide what can be fetched live (ADR 0009).
- Clearing site data deletes projects; the UI says so.
- CI fails if the bundle calls a host outside the list above.

## Alternatives

- GitHub Pages: free and simple, but it can't set response headers, so no real Content-Security-Policy, and no deploy previews.
- Serverless proxy: solves CORS, but adds an account, a bill and an attack surface.
- Desktop app: could run Java locally, but loses zero-install.
- OPFS for storage: fine, but weaker tooling. Revisit if IndexedDB is slow.
