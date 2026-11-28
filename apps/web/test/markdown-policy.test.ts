import { describe, expect, it } from "vitest";
import {
  classifyLink,
  isAllowedImageSource,
  MARKDOWN_ATTRIBUTES,
  MARKDOWN_TAGS,
  resolveProjectPath,
} from "../src/markdown/markdown-policy";

describe("F-605 Markdown policy", () => {
  it("F-605 FI-30 QA-31: classifyLink opens http, https and mailto links outside the app, sends relative paths to the project, and makes fragments and every other scheme inert", () => {
    expect(classifyLink("HTTPS://x.org/a", "README.md")).toEqual({
      kind: "external",
      url: "HTTPS://x.org/a",
      newTab: true,
    });
    expect(classifyLink("http://x.org", "README.md")).toMatchObject({
      kind: "external",
      newTab: true,
    });
    expect(classifyLink("mailto:a@b.c", "README.md")).toEqual({
      kind: "external",
      url: "mailto:a@b.c",
      newTab: false,
    });
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "\tjavascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
    ]) {
      expect(classifyLink(href, "README.md"), href).toEqual({
        kind: "inert",
        reason: "scheme",
      });
    }
    expect(classifyLink("//host/x", "README.md")).toEqual({
      kind: "inert",
      reason: "scheme",
    });
    expect(classifyLink("#frag", "README.md")).toEqual({
      kind: "inert",
      reason: "fragment",
    });
    expect(classifyLink("  ", "README.md")).toEqual({
      kind: "inert",
      reason: "empty",
    });
    expect(classifyLink("./a.md?x#y", "README.md")).toEqual({
      kind: "project",
      path: "a.md",
    });
    expect(classifyLink("../../x.md", "docs/a.md")).toEqual({
      kind: "inert",
      reason: "outside",
    });
  });

  it("F-605 FI-30: resolveProjectPath resolves against the Markdown file's folder, treats a leading slash as the project root, decodes percent escapes and refuses paths that leave the project", () => {
    expect(resolveProjectPath("docs/a.md", "b.md")).toBe("docs/b.md");
    expect(resolveProjectPath("docs/a.md", "../c/d.md")).toBe("c/d.md");
    expect(resolveProjectPath("docs/a.md", "/lib/x.nf")).toBe("lib/x.nf");
    expect(resolveProjectPath("README.md", "my%20file.md")).toBe("my file.md");
    expect(resolveProjectPath("README.md", "a/./b.md#h")).toBe("a/b.md");
    expect(resolveProjectPath("README.md", "../x.md")).toBeNull();
    expect(resolveProjectPath("docs/a.md", "../../x.md")).toBeNull();
    expect(resolveProjectPath("README.md", "%E0%A4%A")).toBeNull();
    expect(resolveProjectPath("README.md", "")).toBeNull();
  });

  it("F-605 FI-30 IO-41: only data: images of raster or SVG types are shown", () => {
    for (const ok of [
      "data:image/png;base64,AAAA",
      "data:image/svg+xml;utf8,<svg/>",
      "data:image/gif;base64,AA",
      "data:image/jpeg;base64,AA",
      "data:image/webp;base64,AA",
      "data:image/avif;base64,AA",
    ]) {
      expect(isAllowedImageSource(ok), ok).toBe(true);
    }
    for (const bad of [
      "https://img.shields.io/x.svg",
      "//host/x.png",
      "docs/x.png",
      "blob:https://x/1",
      "data:text/html,<script>",
      "data:image/x-icon;base64,AA",
      "",
    ]) {
      expect(isAllowedImageSource(bad), bad).toBe(false);
    }
  });

  it("F-605 QA-31 ADR-0048: the allowlists hold no element that runs, loads, submits or restyles, and no style, class, on* or fetching attribute", () => {
    for (const tag of [
      "script",
      "style",
      "link",
      "meta",
      "base",
      "iframe",
      "frame",
      "object",
      "embed",
      "form",
      "button",
      "textarea",
      "select",
      "svg",
      "math",
      "template",
      "noscript",
      "video",
      "audio",
      "source",
    ]) {
      expect(MARKDOWN_TAGS, tag).not.toContain(tag);
    }
    for (const attr of [
      "style",
      "class",
      "srcset",
      "background",
      "poster",
      "ping",
      "action",
      "formaction",
      "xlink:href",
    ]) {
      expect(MARKDOWN_ATTRIBUTES, attr).not.toContain(attr);
    }
    expect(MARKDOWN_ATTRIBUTES.filter((a) => a.startsWith("on"))).toEqual([]);
  });
});
