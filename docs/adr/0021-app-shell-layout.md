# 0021. Hand-roll the resizable shell and keep its layout in localStorage

- Status: Accepted (agent)
- Date: 2026-11-22

## Context

F-201 builds the app shell (UX-01 to UX-03): a header, three columns whose side columns resize and collapse, a tab strip and a status bar. UX-02 says widths persist; AR-30 puts panel sizes in Zustand. The spec doesn't give minimum or maximum widths, the collapse affordance, keyboard steps, placeholder copy, or how a visual baseline is approved while the agent works autonomously. The CSP allows no inline `<style>` (ADR 0014). `react-resizable-panels` 4.x measured 15.4 kB gzipped for the parts we would use, sizes panels in percentages rather than the px UX-02 uses, and brings its own layout storage, which would duplicate the Zustand store.

## Decision

- **Resizing is hand-rolled:** each side column has an `<hr>` separator (implicit `separator` role, WAI-ARIA splitter pattern) overlapping the column edge, so it takes no grid width. Pointer drag, arrow keys (16 px), Home and End (minimum and maximum) and Enter (collapse) resize it. Grid widths are set through a React `style` prop (CSSOM, allowed by `style-src 'self'`).
- **Limits:** left 200 to 480 px (default 256), right 240 to 480 px (default 296). A collapsed column is a 32 px rail with a 24 px expand button; its separator is removed while collapsed. The centre column has no minimum.
- **State:** `zustand` 5.1.0 (named in ADR 0003) holds the layout. It persists to localStorage under `nf-builder:layout` in Zustand's persist envelope, version 1: `{"state":{"left":{"width":256,"collapsed":false},"right":{"width":296,"collapsed":false}},"version":1}`. Values are validated and clamped on read; anything invalid, and any storage error, falls back to the defaults. localStorage rather than IndexedDB because hydration is synchronous, so the layout never flashes. Panel layout is per-browser UI state (AR-30), not one of the projects, files or settings ADR 0002 keeps in IndexedDB; those stay there.
- **Language versions without literals (LA-02):** `@nf-builder/lang-core` exports a minimal `LanguagePack { version }`, each pack exports `pack`, and `@nf-builder/engine` exports `installedPackVersions()`. The shell's version control and status bar read it.
- **Placeholders:** British English, sentence case; disabled controls until the features that own them land. System fonts; small inline SVG icons, no icon font.
- **Visual baselines:** PNG baselines live in `e2e/__screenshots__/` and are rendered only in CI, on the Chromium e2e leg pinned to `ubuntu-24.04` so rendering doesn't move with `ubuntu-latest`. Playwright never writes baselines implicitly (`updateSnapshots: "none"`); the `@visual` tests run only in CI or with `PW_VISUAL=1`. When a `@visual` test fails because a baseline is missing or the UI changed on purpose, the agent downloads the `playwright-chromium` artifact, views the `-actual.png` against the spec and mockups, and commits it at the expected path; the PR shows the image. That is an approved baseline under ADR 0011. Bumping the runner image or Playwright means re-approving the baselines the same way.
- **Deferred:** a single-pointer alternative to dragging (WCAG 2.2 SC 2.5.7) and target-size checks go to F-701, which owns QA-10; the narrow-screen mode stays with F-703.

## Consequences

- No new dependency beyond Zustand, and no inline styles under the CSP.
- The layout format is versioned; a future change bumps `version` and migrates or resets.
- Once packs carry the parser and catalogue, importing the pack list on the main thread would pull them into the initial bundle; F-113 moves the list behind the worker API or a light export, and QA-01 catches it if not.

## Alternatives

- `react-resizable-panels`: a new dependency, percentage sizes and its own storage.
- IndexedDB for the layout: asynchronous, so the shell would render once with defaults.
- A label-triggered workflow that renders baselines and commits them to the branch: needs `contents: write` in a workflow, and downloading the CI artifact now works from the agent sandbox.
- Rendering baselines locally: the sandbox's Chromium build and fonts differ from CI's.
- A bare version constant in lang-2610: smaller, but diverges from Q10's "the entry exports a LanguagePack".
