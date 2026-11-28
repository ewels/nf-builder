// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { projectLinkOf, renderMarkdown } from "../src/markdown/render-markdown";

const HOSTILE = `# Title kept

<script>window.__x = 1</script>
<img src="x" onerror="window.__x = 2" alt="boom">
[js](javascript:alert(1)) [JS](JaVaScRiPt:alert(2)) [d](data:text/html,x) [v](vbscript:x)

<style>body { display: none }</style>
<p style="color: red" class="app-shell">styled paragraph</p>
<iframe srcdoc="<script>1</script>"></iframe>
<object data="x"></object><embed src="x">
<svg><script>window.__x = 3</script></svg>
<math><mi>x</mi></math>
<form action="/x"><button formaction="/y">go</button></form>
<meta http-equiv="refresh" content="0;url=https://evil.example">
<base href="https://evil.example/">
<link rel="stylesheet" href="https://evil.example/x.css">
<details ontoggle="window.__x = 4" open><summary>More</summary>body text</details>
<picture><source srcset="https://evil.example/a.png"><img src="https://evil.example/b.png" alt="pic"></picture>
<noscript><p title="</noscript><img src=x onerror=window.__x=5>"></noscript>
<template><img src=x onerror="window.__x=6"></template>
`;

function render(text: string, path = "README.md"): HTMLElement {
  const host = document.createElement("div");
  host.replaceChildren(renderMarkdown(text, { path }));
  return host;
}

describe("F-605 renderMarkdown", () => {
  it("F-605 step 1 FI-30 QA-31: a README with script tags, event handlers, javascript: links, frames, forms, SVG and a meta refresh renders with none of them and keeps its text", () => {
    const host = render(HOSTILE);
    for (const tag of [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "svg",
      "math",
      "form",
      "button",
      "meta",
      "base",
      "link",
      "source",
      "noscript",
      "template",
    ]) {
      expect(host.querySelector(tag), tag).toBeNull();
    }
    for (const el of host.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        expect(attr.startsWith("on"), attr).toBe(false);
        expect(["style", "srcset", "formaction"], attr).not.toContain(attr);
      }
      // only the two classes the renderer adds itself, after sanitising
      expect(["", "visually-hidden", "markdown-image"]).toContain(
        el.getAttribute("class") ?? "",
      );
    }
    expect(host.querySelector("h1")?.textContent).toBe("Title kept");
    expect(host.textContent).toContain("styled paragraph");
    expect(host.textContent).toContain("More");
    expect(host.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(host.querySelectorAll("a[href]")).toHaveLength(0);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect((globalThis as { __x?: unknown }).__x).toBeUndefined();
  });

  it("F-605 ADR-0048 QA-30: style elements and style and class attributes are stripped", () => {
    const host = render(
      '<style>p{color:red}</style><p style="color:red" class="x">a</p><span class="y" style="top:0">b</span>',
    );
    expect(host.querySelector("style")).toBeNull();
    expect(host.querySelector("[style]")).toBeNull();
    expect(host.querySelector("[class]")).toBeNull();
    expect(host.textContent).toContain("a");
  });

  it("F-605 FI-30: GitHub-flavoured Markdown renders headings, lists, tables, task lists with disabled checkboxes, code blocks, strikethrough and autolinks", () => {
    const host = render(
      [
        "## Two",
        "- one\n- two",
        "1. first",
        "| a | b |\n|---|---|\n| 1 | 2 |",
        "- [x] done\n- [ ] todo",
        "```nf\nworkflow {}\n```",
        "~~gone~~ and https://example.org/x",
      ].join("\n\n"),
    );
    expect(host.querySelector("h2")?.textContent).toBe("Two");
    expect(host.querySelectorAll("ul li").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector("ol li")?.textContent).toBe("first");
    expect(host.querySelectorAll("table th")).toHaveLength(2);
    const boxes = host.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    for (const box of boxes)
      expect((box as HTMLInputElement).disabled).toBe(true);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect(host.querySelector("pre code")?.textContent).toContain(
      "workflow {}",
    );
    expect(host.querySelector("del")?.textContent).toBe("gone");
    expect(
      host.querySelector('a[href="https://example.org/x"]'),
    ).not.toBeNull();
  });

  it("F-605 FI-30 IO-41: remote and relative images become their alt text with the source as a title, data: images stay, and srcset and picture sources are dropped", () => {
    const host = render(
      [
        "![Badge](https://img.shields.io/x.svg)",
        "![Local](docs/images/map.svg)",
        '![Inline](data:image/png;base64,iVBORw0KGgo= "Tiny")',
        '<picture><source srcset="https://e.example/a.png"><img src="https://e.example/b.png" alt="pic"></picture>',
      ].join("\n\n"),
    );
    const placeholders = [...host.querySelectorAll(".markdown-image")];
    expect(placeholders.map((p) => p.textContent)).toEqual([
      "[Badge]",
      "[Local]",
      "[pic]",
    ]);
    expect(placeholders[0]?.getAttribute("title")).toBe(
      "Image not shown: https://img.shields.io/x.svg",
    );
    const images = [...host.querySelectorAll("img")];
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute("src")).toMatch(/^data:image\/png/);
    expect(images[0]?.getAttribute("title")).toBe("Tiny");
    expect(host.querySelector("source, [srcset]")).toBeNull();
  });

  it("F-605 FI-30: external links open in a new tab with noopener and noreferrer, mailto has no target, project links carry their resolved path and no href, and unsafe or fragment links lose their href", () => {
    const host = render(
      "[ext](https://example.org) [mail](mailto:a@b.c) [doc](usage.md) [up](../../x.md) [frag](#top) [bad](javascript:alert(1))",
      "docs/README.md",
    );
    const link = (text: string) =>
      [...host.querySelectorAll("a")].find((a) =>
        a.textContent?.startsWith(text),
      ) as HTMLAnchorElement;
    const ext = link("ext");
    expect(ext.getAttribute("href")).toBe("https://example.org");
    expect(ext.getAttribute("target")).toBe("_blank");
    expect(ext.getAttribute("rel")).toBe("noopener noreferrer");
    expect(ext.textContent).toContain("(opens in a new tab)");
    const mail = link("mail");
    expect(mail.getAttribute("href")).toBe("mailto:a@b.c");
    expect(mail.hasAttribute("target")).toBe(false);
    expect(mail.getAttribute("rel")).toBe("noopener noreferrer");
    const doc = link("doc");
    expect(doc.hasAttribute("href")).toBe(false);
    expect(doc.getAttribute("data-path")).toBe("docs/usage.md");
    expect(doc.getAttribute("role")).toBe("link");
    expect(doc.getAttribute("tabindex")).toBe("0");
    expect(projectLinkOf(doc)).toBe("docs/usage.md");
    expect(projectLinkOf(ext)).toBeNull();
    expect(projectLinkOf(null)).toBeNull();
    for (const text of ["up", "frag", "bad"]) {
      const a = link(text);
      expect(a.hasAttribute("href"), text).toBe(false);
      expect(a.hasAttribute("data-path"), text).toBe(false);
    }
  });

  it("F-605 QA-31: ids and names gain the user-content- prefix, so content can't clobber document properties", () => {
    const host = render(
      '<p id="cookie">a</p><a name="location">b</a><div id="x">c</div>',
    );
    expect(host.querySelector("#cookie")).toBeNull();
    expect(host.querySelector("[id='user-content-cookie']")).not.toBeNull();
    expect(host.querySelector("[name='user-content-location']")).not.toBeNull();
  });

  it("F-605 QA-31: the preview modules never write HTML strings into the page", () => {
    const sources = import.meta.glob<string>("../src/markdown/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(2);
    for (const [file, source] of Object.entries(sources)) {
      for (const sink of [
        "innerHTML",
        "outerHTML",
        "insertAdjacentHTML",
        "dangerouslySetInnerHTML",
        "document.write",
      ]) {
        expect(source.includes(sink), `${file} ${sink}`).toBe(false);
      }
    }
  });
});
