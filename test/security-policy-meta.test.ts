import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  POLICY_META_TAGS,
} from "../scripts/security-policy.ts";
import {
  policyMetaHtml,
  prependPolicyMeta,
  securityPolicyMeta,
} from "../scripts/security-policy-meta.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY.replaceAll("'", "&#39;")}">`;
const REFERRER_META = '<meta name="referrer" content="no-referrer">';

describe("security policy meta plugin", () => {
  it("F-011 step 2 QA-30: securityPolicyMeta applies only to builds and injects the CSP meta then the referrer meta with head-prepend", () => {
    const plugin = securityPolicyMeta();
    expect(plugin.name).toBe("nf-builder:security-policy-meta");
    expect(plugin.apply).toBe("build");
    const hook = plugin.transformIndexHtml as {
      order: string;
      handler: () => unknown;
    };
    expect(hook.order).toBe("post");
    expect(hook.handler()).toEqual(
      POLICY_META_TAGS.map((t) => ({
        tag: "meta",
        attrs: t.attrs,
        injectTo: "head-prepend",
      })),
    );
  });

  it("F-011 step 2 QA-30: prependPolicyMeta puts both elements directly after <head>, before charset, scripts and links, and leaves a stamped page unchanged", () => {
    expect(policyMetaHtml()).toBe(`${CSP_META}${REFERRER_META}`);
    const html =
      '<!doctype html><html><head lang="en"><meta charset="UTF-8"><script src="a.js"></script><link href="b.css"></head><body></body></html>';
    const stamped = prependPolicyMeta(html);
    expect(stamped).toBe(
      `<!doctype html><html><head lang="en">${CSP_META}${REFERRER_META}<meta charset="UTF-8"><script src="a.js"></script><link href="b.css"></head><body></body></html>`,
    );
    expect(prependPolicyMeta(stamped)).toBe(stamped);
  });

  it("F-011 QA-30: prependPolicyMeta throws on HTML without <head>", () => {
    expect(() => prependPolicyMeta("<html><body></body></html>")).toThrow(
      /<head>/,
    );
  });

  it("F-011 step 2 QA-30: a Vite build of a page plus a public HTML file starts both pages' <head> with the policy", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-builder-meta-"));
    dirs.push(root);
    writeFileSync(
      join(root, "index.html"),
      '<!doctype html><html><head><meta charset="UTF-8"><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>',
    );
    writeFileSync(join(root, "main.js"), "console.log(1);\n");
    mkdirSync(join(root, "public/spike"), { recursive: true });
    writeFileSync(
      join(root, "public/spike/page.html"),
      '<!doctype html><html><head><meta charset="UTF-8"></head><body></body></html>',
    );
    const outDir = join(root, "dist");
    await build({
      root,
      logLevel: "silent",
      configFile: false,
      plugins: [securityPolicyMeta()],
      build: { outDir, emptyOutDir: true },
    });
    for (const file of ["index.html", "spike/page.html"]) {
      const html = readFileSync(join(outDir, file), "utf8");
      // Vite pretty-prints the tags it injects, so ignore whitespace between tags.
      const head = html
        .slice(html.indexOf("<head>") + "<head>".length)
        .replace(/>\s+</g, "><")
        .trimStart();
      expect(head.startsWith(`${CSP_META}${REFERRER_META}`), file).toBe(true);
      expect(html.split("Content-Security-Policy").length, file).toBe(2);
    }
  });
});
