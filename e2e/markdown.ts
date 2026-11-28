// Helpers for the Markdown preview end-to-end tests (F-605). The workspace hook is `window.nfBuilderWorkspace`.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { openProject } from "./canvas.ts";
import { readProject } from "./engine.ts";

export const F605_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f605-library");

/** A README that tries every way into the page: scripts, handlers, bad links, frames, forms, SVG and a refresh (QA-31). */
export const HOSTILE_README = `# Hostile heading

Visible paragraph text.

<script>window.__f605 = 1</script>
<img src="x" onerror="window.__f605 = 2">
<style>body { display: none }</style>
<p style="color:red" class="app-chrome" onclick="window.__f605 = 3">Styled paragraph</p>
<iframe srcdoc="<script>parent.__f605 = 4</script>"></iframe>
<object data="data:text/html,<script>parent.__f605=5</script>"></object>
<embed src="data:text/html,<script>parent.__f605=6</script>">
<svg><script>window.__f605 = 7</script></svg>
<math><mi>x</mi></math>
<form action="https://example.com/x"><button formaction="https://example.com/y">Send</button></form>
<meta http-equiv="refresh" content="0;url=https://example.com/z">
<base href="https://example.com/">
<link rel="stylesheet" href="https://example.com/s.css">
<details ontoggle="window.__f605 = 8"><summary>More</summary>Inside</details>
<picture><source srcset="https://example.com/a.png"><img src="https://example.com/b.png" alt="Remote picture"></picture>

[js](javascript:window.__f605=9) [mixed](JaVaScRiPt:window.__f605=10) [vb](vbscript:x) [data](data:text/html,x)
[web](https://example.com/page) [usage](docs/usage.md) [broken](docs/missing.md)

![Remote badge](https://img.shields.io/badge/a-b-blue)
![Inline pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)

- [x] done
- [ ] todo

| a | b |
|---|---|
| 1 | 2 |
`;

/** Opens the f605 project, with `overrides` replacing or adding files. */
export async function openF605(
  page: Page,
  overrides: { path: string; text: string }[] = [],
): Promise<void> {
  const files = readProject(F605_FIXTURE).filter(
    (f) => !overrides.some((o) => o.path === f.path),
  );
  await openProject(page, [...files, ...overrides]);
}

interface PathHook {
  openPath(path: string): Promise<"workflow" | "file" | "missing">;
}

/** Opens a project file through the store, the path preview links and the Files view take. */
export const openPathInUi = (
  page: Page,
  path: string,
): Promise<"workflow" | "file" | "missing"> =>
  page.evaluate(
    (p) =>
      (
        window as unknown as { nfBuilderWorkspace: PathHook }
      ).nfBuilderWorkspace.openPath(p),
    path,
  );

/** The rendered Markdown of the active file tab. */
export const preview = (page: Page): Locator =>
  page.locator(".markdown-preview");

export interface PreviewAudit {
  forbidden: string[];
  handlerOrStyleAttributes: string[];
  unsafeLinks: string[];
  imageSources: string[];
}

/** What the rendered preview holds that it must not, and every image source it shows. */
export const auditPreview = (page: Page): Promise<PreviewAudit> =>
  preview(page).evaluate((root) => {
    const forbidden = [
      ...root.querySelectorAll(
        "script,style,link,meta,base,iframe,frame,object,embed,form,button,textarea,select,svg,math,template,noscript,video,audio,source",
      ),
    ].map((el) => el.localName);
    const handlerOrStyleAttributes = [...root.querySelectorAll("*")].flatMap(
      (el) =>
        [...el.attributes]
          .filter(
            (a) =>
              a.name.startsWith("on") ||
              a.name === "style" ||
              (a.name === "class" &&
                !el.classList.contains("markdown-image") &&
                !el.classList.contains("visually-hidden")),
          )
          .map((a) => `${el.localName}[${a.name}]`),
    );
    const unsafeLinks = [...root.querySelectorAll("a[href]")]
      .filter((a) => {
        const href = a.getAttribute("href") ?? "";
        return !/^(https?:|mailto:)/i.test(href);
      })
      .map((a) => a.getAttribute("href") ?? "");
    const imageSources = [...root.querySelectorAll("img")].map(
      (img) => img.getAttribute("src") ?? "",
    );
    return { forbidden, handlerOrStyleAttributes, unsafeLinks, imageSources };
  });

/** The value the hostile README's scripts would set; undefined while nothing ran. */
export const sentinel = (page: Page): Promise<unknown> =>
  page.evaluate(() => (window as unknown as { __f605?: unknown }).__f605);

/** Records the URLs of requests to any origin other than the app's (the first request's); call the result to read them. */
export function recordForeignRequests(page: Page): () => string[] {
  const foreign: string[] = [];
  let origin: string | null = null;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!/^https?:$/.test(url.protocol)) return;
    origin ??= url.origin;
    if (url.origin !== origin) foreign.push(request.url());
  });
  return () => foreign;
}
