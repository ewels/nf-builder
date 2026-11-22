import { readFileSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";
import { htmlFiles } from "./check-common.ts";
import { POLICY_META_TAGS } from "./security-policy.ts";

/** Escapes as Vite does for attribute values (escape-html). */
function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Both policy elements, serialised as Vite serialises injected tags. */
export function policyMetaHtml(): string {
  return POLICY_META_TAGS.map(
    (tag) =>
      `<meta ${Object.entries(tag.attrs)
        .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
        .join(" ")}>`,
  ).join("");
}

/** Inserts the policy right after the `<head>` start tag; a page that already has it is unchanged. */
export function prependPolicyMeta(html: string): string {
  const meta = policyMetaHtml();
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head === null)
    throw new Error("cannot add the security policy: no <head>");
  const end = head.index + head[0].length;
  // Vite's own injection puts whitespace between the tags, so test for the CSP element, not the exact text.
  if (/^\s*<meta\s+http-equiv="Content-Security-Policy"/i.test(html.slice(end)))
    return html;
  return html.slice(0, end) + meta + html.slice(end);
}

/**
 * ADR 0040, QA-30: GitHub Pages sends no headers, so the policy travels in <meta> elements at the start of
 * every page's <head>. Pages Vite processes get it from transformIndexHtml; public HTML files are copied
 * as they are, so writeBundle stamps them.
 */
export function securityPolicyMeta(): Plugin {
  return {
    name: "nf-builder:security-policy-meta",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: () =>
        POLICY_META_TAGS.map((tag) => ({
          tag: "meta",
          attrs: { ...tag.attrs },
          injectTo: "head-prepend" as const,
        })),
    },
    writeBundle({ dir }) {
      if (dir === undefined) return;
      for (const file of htmlFiles(dir)) {
        const html = readFileSync(file, "utf8");
        const stamped = prependPolicyMeta(html);
        if (stamped !== html) writeFileSync(file, stamped);
      }
    },
  };
}
