# 0044. Let the app load and work inside frames

- Status: Accepted
- Date: 2026-11-22

## Context

ADR 0040 accepted that GitHub Pages can't send `X-Frame-Options` or `frame-ancestors`. In their place it made the app refuse to start inside a frame and show an "Open in a new tab" link. The maintainer wants the site to load and work in as many places as possible, including embedded in another page's iframe.

Those headers guard against clickjacking: a hostile page frames a site and tricks a signed-in user into acting in it. Little of that applies to nf-builder:
- there is no account, server or session;
- cross-site frames get partitioned storage, so an embedded copy can't see or change the projects of the top-level site;
- the embedding page can't read the frame's content.

## Decision

- **No frame guard.** The app renders the same way at top level and inside any frame. ADR 0040's clickjacking clause is amended; the rest of ADR 0040 stands.
- **No frame restriction anywhere.** The meta policy carries no `frame-ancestors`, and nothing is added that would block embedding.
- **Tested in a frame.** An end-to-end test loads the app inside a cross-origin iframe and checks that it starts, loads the palette through the engine worker, and logs no CSP violation or console error.
- **Partitioned storage.** An embedded copy keeps its own projects. Features that store or export data say so where it matters; F-202's storage notice covers browsers that refuse persistence in a frame.
- **Embedders grant browser features.** Features that need permissions inside a frame degrade gracefully when the embedder hasn't granted them. For example, the clipboard needs `allow="clipboard-read; clipboard-write"`.

## Consequences

- Anyone can embed the app, for example in documentation or training pages.
- A framed copy is a separate workspace, which can surprise a user who expects their projects there. The UI can explain this when it detects a frame, without blocking anything.
- Clickjacking stays an accepted risk, with low impact for the reasons above.

## Alternatives

- **Keep the guard:** blocks legitimate embedding for little security gain.
- **Allow only listed embedders:** needs `frame-ancestors`, which a meta policy can't carry, and a list to maintain.
