import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS } from "../scripts/allow-list.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { classifyUrl, findUrls, scanDist } from "../scripts/check-hosts.ts";
import { NON_FETCHED_URLS } from "../scripts/non-fetched-urls.ts";
import {
  CONNECT_SRC_ALLOW_LIST,
  CONTENT_SECURITY_POLICY,
} from "../scripts/security-policy.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nf-builder-hosts-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

const kind = (url: string) => classifyUrl(url).kind;

describe("IO-41 host scan", () => {
  it("IO-41: finds http, https, ws and wss URLs in any quote style, including JSON-escaped slashes", () => {
    const text = [
      `a("https://a.example/x")`,
      `b('http://b.example/y')`,
      `c(\`wss://c.example/z\`)`,
      `{"u":"ws:\\/\\/d.example\\/p"}`,
    ].join("\n");
    const found = findUrls(text);
    expect(found.map((f) => f.url)).toEqual([
      "https://a.example/x",
      "http://b.example/y",
      "wss://c.example/z",
      "ws://d.example/p",
    ]);
    expect(found[0]).toMatchObject({ line: 1, column: 4 });
    expect(found[1]).toMatchObject({ line: 2, column: 4 });
    expect(found[3]).toMatchObject({ line: 4 });
  });

  it("IO-41: allows the ADR 0002 origins over https only", () => {
    expect(kind("https://api.github.com/repos/x")).toBe("allowed");
    expect(kind("https://raw.githubusercontent.com/a")).toBe("allowed");
    expect(kind("https://registry.nextflow.io/api")).toBe("allowed");
    expect(kind("http://api.github.com")).toBe("forbidden");
    expect(kind("https://api.github.com:8443/")).toBe("forbidden");
    expect(kind("https://api.github.com.evil.example/")).toBe("forbidden");
    for (const url of [
      "https://api.github.com@evil.example/x",
      "https://api.github.com_x.evil.example/",
      "https://api.github.com%2eevil.example/",
    ])
      expect(kind(url), url).not.toBe("allowed");
  });

  it("IO-41: skips the listed non-fetched URLs and nothing broader", () => {
    for (const url of [
      "http://www.w3.org/2000/svg",
      "http://www.w3.org/1999/xlink",
      "http://www.w3.org/1998/Math/MathML",
      "http://www.w3.org/XML/1998/namespace",
      "https://react.dev/errors/418",
    ])
      expect(kind(url)).toBe("ignored");
    expect(kind("https://react.dev/learn")).toBe("forbidden");
    expect(kind("https://www.w3.org/2000/svg")).toBe("forbidden");
  });

  it("IO-41: skips URLs with no literal host", () => {
    expect(kind("https://")).toBe("no-host");
    expect(kind(`https://\${h}/x`)).toBe("no-host");
    expect(findUrls(`"https://"+h`).map((f) => kind(f.url))).toEqual([
      "no-host",
    ]);
  });

  it("IO-41: classifies template and malformed URLs by their literal prefix", () => {
    const cases: [string, string][] = [
      [`\`https://evil.example\${p}\``, "forbidden"],
      [`\`https://evil.example:\${port}\``, "forbidden"],
      [`\`https://api.github.com\${path}\``, "allowed"],
      [`\`https://\${host}/x\``, "no-host"],
      [`"https://evil.example]x"`, "forbidden"],
      [`"https://evil.example%zz"`, "forbidden"],
    ];
    for (const [text, expected] of cases) {
      const found = findUrls(text);
      expect(found, text).toHaveLength(1);
      expect(kind(found[0]?.url ?? ""), text).toBe(expected);
    }
    expect(classifyUrl(`https://evil.example\${p}`)).toMatchObject({
      kind: "forbidden",
      host: "evil.example",
    });
    expect(classifyUrl("https://evil.example%zz")).toMatchObject({
      kind: "forbidden",
      host: "evil.example%zz",
    });
    expect(kind(`https://api.github.com:\${port}`)).toBe("forbidden");
  });

  it("F-003 step 2: IO-41 fails on a fetch to an unlisted host, naming the host, file, column and both fixes", () => {
    const dist = makeDist({
      "assets/index-abc.js": `x;fetch(\`https://telemetry.example.com/collect\`)`,
    });
    const { problems } = scanDist(dist);
    expect(problems).toHaveLength(1);
    const message = problems[0]?.message ?? "";
    expect(message).toContain("telemetry.example.com");
    expect(message).toContain("scripts/allow-list.ts");
    expect(message).toContain("scripts/non-fetched-urls.ts");
    expect(message).toContain("ADR");
    expect(problems[0]).toMatchObject({
      file: join(dist, "assets/index-abc.js"),
      line: 1,
      column: 10,
    });
  });

  it("IO-41: scans .js, .mjs, .cjs, .css and .html files and nothing else", () => {
    const dist = makeDist({
      "a.json": `{"u":"https://json.example/x"}`,
      "a.js.map": `"https://map.example/x"`,
      "a.css": `a{background:url(https://fonts.example/x)}`,
      "a.html": `<a href="https://html.example/x">`,
      "a.mjs": `"https://mjs.example/x"`,
      "a.cjs": `"https://cjs.example/x"`,
      ".vite/m.js": `"https://hidden.example/x"`,
    });
    const { problems, files } = scanDist(dist);
    const text = problems.map((p) => p.message).join("\n");
    expect(files).toBe(5);
    expect(text).not.toContain("json.example");
    expect(text).not.toContain("map.example");
    for (const host of ["fonts", "html", "mjs", "cjs", "hidden"])
      expect(text).toContain(`${host}.example`);
  });

  describe("chunks built from JSON data", () => {
    const manifest = (src: string, file: string) =>
      JSON.stringify({ [src]: { file, src, isDynamicEntry: true } });
    const code = `x="https://docs.example.com/x"`;

    it("F-204 IO-41: a chunk whose manifest source is a .json file is data and is not scanned", () => {
      const dist = makeDist({
        ".vite/manifest.json": manifest(
          "../pack/catalogue/script.json",
          "assets/script-1.js",
        ),
        "assets/script-1.js": code,
      });
      expect(scanDist(dist).problems).toEqual([]);
    });

    it("F-204 IO-41: the same host in a chunk from a .ts source still fails", () => {
      const dist = makeDist({
        ".vite/manifest.json": manifest(
          "../pack/src/catalogue.ts",
          "assets/catalogue-1.js",
        ),
        "assets/catalogue-1.js": code,
      });
      expect(scanDist(dist).problems).toHaveLength(1);
    });

    it("F-204 IO-41: a .ts chunk that imports JSON is still scanned, and so is a chunk missing from the manifest", () => {
      const dist = makeDist({
        ".vite/manifest.json": manifest("src/index.ts", "assets/index-1.js"),
        "assets/index-1.js": `import d from "./script-1.js";${code}`,
        "assets/other-1.js": code,
      });
      expect(scanDist(dist).problems).toHaveLength(2);
    });
  });

  it("IO-41: notes ignore-list entries that matched nothing without failing", () => {
    const dist = makeDist({ "a.js": `"https://api.github.com/x"` });
    const { problems, unusedIgnores } = scanDist(dist);
    expect(problems).toEqual([]);
    expect(unusedIgnores).toEqual([...NON_FETCHED_URLS]);
  });

  it("IO-41: every non-fetched URL entry has a reason and none is an allow-listed origin", () => {
    for (const entry of NON_FETCHED_URLS) {
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(
        ALLOWED_ORIGINS.some((o) => entry.url.startsWith(o)),
        entry.url,
      ).toBe(false);
    }
  });

  it("IO-41 QA-30: the CSP connect-src and the host scan share the ADR 0002 allow-list", () => {
    expect(CONNECT_SRC_ALLOW_LIST).toEqual(["'self'", ...ALLOWED_ORIGINS]);
    const connect = CONTENT_SECURITY_POLICY.split(";")
      .map((p) => p.trim().split(/\s+/))
      .find(([name]) => name === "connect-src")
      ?.slice(1);
    expect(new Set(connect)).toEqual(new Set(CONNECT_SRC_ALLOW_LIST));
  });

  it("F-003 step 2: node scripts/check-hosts.ts exits 1 on an unlisted host and 2 without a build", () => {
    const run = (dist: string) =>
      spawnSync("node", ["scripts/check-hosts.ts", "--dist", dist], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" },
      });
    const bad = run(makeDist({ "a.js": `fetch("https://evil.example/x")` }));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("evil.example");
    const good = run(makeDist({ "a.js": `fetch("https://api.github.com/x")` }));
    expect(good.status).toBe(0);
    const missing = run(join(tmpdir(), "nf-builder-no-such-dist"));
    expect(missing.status).toBe(2);
    expect(missing.stdout + missing.stderr).toContain("run pnpm build");
  });
});
