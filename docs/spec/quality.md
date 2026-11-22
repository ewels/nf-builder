# Quality attributes

Testing approach: ADR 0011.

## Performance budgets

CI measures these. A breach fails the build unless the PR raises the budget with a reason.

| ID | Budget |
|---|---|
| QA-01 | Initial JavaScript, gzipped, excluding Monaco and the optional language server: ≤ 450 KB |
| QA-02 | Time to interactive on the CI reference profile (Playwright, 4× CPU throttle): ≤ 3 s |
| QA-03 | While the worker parses and models a project, the canvas and UI stay responsive and show loading progress. Parsing and modelling nf-core/sarek (pinned) in the worker finishes within 30 s on the CI reference profile (ADR 0029). |
| QA-04 | Apply an edit command on a file under 2,000 lines, re-parse and re-project: ≤ 100 ms at p95 |
| QA-05 | Canvas with 300 nodes: pan and zoom without frames over 32 ms in a Playwright trace |
| QA-06 | Registry snapshot index: ≤ 300 KB gzipped |

## Accessibility

| ID | Requirement |
|---|---|
| QA-10 | WCAG 2.2 AA for everything outside the canvas drawing itself. |
| QA-11 | Palette, canvas (node focus, port connection by keyboard), details pane and popup are fully keyboard-operable (UX-70). |
| QA-12 | Colour is never the only signal. Edge kinds differ by dash pattern; node kinds by icon. |
| QA-13 | Text contrast ≥ 4.5:1. Honours `prefers-reduced-motion`. |
| QA-14 | axe checks pass on the main screens in CI. |

## Browsers

| ID | Requirement |
|---|---|
| QA-20 | Latest two versions of Chrome, Edge, Firefox and Safari on desktop. Playwright runs Chromium, Firefox and WebKit. |

## Security

| ID | Requirement |
|---|---|
| QA-30 | Strict Content Security Policy: no inline scripts, `connect-src` limited to the ADR 0002 allow-list. |
| QA-31 | Markdown previews are sanitised. Imported files are never executed. |
| QA-32 | Zip import enforces the IO-12 limits. |
| QA-33 | Tokens never appear in logs, exports or error reports. |
| QA-34 | Dependencies are kept current by Renovate. `pnpm audit` with high-severity findings fails CI. |
