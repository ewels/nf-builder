// F-011, ADR 0040, QA-30: checks the built site (a directory) or the deployed site (a URL).
// - Every page starts <head> with the CSP <meta http-equiv>, then the no-referrer <meta>.
// - Every asset URL in index.html sits under the base path, is not relative and exists.
// - version.json carries a string commit and context.
// The deployed check polls version.json until it shows the commit, then checks the served page and entry script.
// Imports only node: built-ins and sibling scripts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { basePath } from "./base-path.ts";
import {
  distExists,
  isMain,
  type Problem,
  reportProblems,
  WEB_DIST,
} from "./check-common.ts";
import {
  CONTENT_SECURITY_POLICY,
  metaPolicyProblems,
  REFERRER_POLICY,
} from "./security-policy.ts";

type Element = { name: string; attrs: Record<string, string> };

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1]?.toLowerCase() === "x"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of text.matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const name = (m[1] ?? "").toLowerCase();
    if (!(name in attrs))
      attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Start tags in document order, comments skipped, attribute values entity-decoded. */
function elementsIn(html: string): Element[] {
  const elements: Element[] = [];
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of text.matchAll(
    /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g,
  ))
    elements.push({
      name: (m[1] ?? "").toLowerCase(),
      attrs: parseAttrs(m[2] ?? ""),
    });
  return elements;
}

function headOf(html: string): string | undefined {
  const start = /<head(?:\s[^>]*)?>/i.exec(html);
  if (start === null) return undefined;
  const from = start.index + start[0].length;
  const end = html.search(/<\/head>/i);
  return html.slice(from, end < from ? undefined : end);
}

/** Problems with the policy elements at the start of a page's <head>. */
export function headPolicyProblems(html: string): string[] {
  const head = headOf(html);
  if (head === undefined) return ["the page has no <head>"];
  const problems: string[] = [];
  const [first, second] = elementsIn(head);
  const isCsp = (e: Element | undefined): boolean =>
    e?.name === "meta" &&
    e.attrs["http-equiv"]?.toLowerCase() === "content-security-policy";
  if (!isCsp(first))
    problems.push(
      'the first element in <head> is not <meta http-equiv="Content-Security-Policy">',
    );
  else {
    const content = first?.attrs.content ?? "";
    if (content !== CONTENT_SECURITY_POLICY)
      problems.push(
        `the Content-Security-Policy meta differs from scripts/security-policy.ts: "${content}"`,
      );
    for (const problem of metaPolicyProblems(content))
      problems.push(`QA-30: ${problem}`);
  }
  if (
    second?.name !== "meta" ||
    second.attrs.name?.toLowerCase() !== "referrer" ||
    second.attrs.content !== REFERRER_POLICY
  )
    problems.push(
      `the second element in <head> is not <meta name="referrer" content="${REFERRER_POLICY}">`,
    );
  for (const [i, e] of elementsIn(head).entries()) {
    if (e.name !== "meta" || e.attrs["http-equiv"] === undefined) continue;
    if (i === 0 && isCsp(e)) continue;
    problems.push(
      `unexpected <meta http-equiv="${e.attrs["http-equiv"]}">: only the Content-Security-Policy meta is allowed`,
    );
  }
  const charset = /<meta\s[^>]*\bcharset\s*=/i.exec(html);
  if (charset === null) problems.push("there is no <meta charset>");
  else if (Buffer.byteLength(html.slice(0, charset.index)) >= 1024)
    problems.push("<meta charset> is not within the first 1024 bytes");
  return problems;
}

/**
 * Problems with `src` and `href` paths: each must start with `base`, must not be relative, and its file must exist.
 * `data:` URLs, fragments and absolute URLs (IO-41 covers hosts) are skipped.
 */
export function assetPathProblems(
  html: string,
  base: string,
  exists: (distPath: string) => boolean = () => true,
): string[] {
  const problems: string[] = [];
  for (const element of elementsIn(html)) {
    for (const name of ["src", "href"]) {
      const value = element.attrs[name];
      if (value === undefined || value === "") continue;
      if (value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
      if (value.startsWith("//")) continue;
      if (value.startsWith("./") || value.startsWith("../")) {
        problems.push(
          `${name}="${value}" is relative; use a path under ${base}`,
        );
        continue;
      }
      if (!value.startsWith(base)) {
        problems.push(`${name}="${value}" is outside the base path ${base}`);
        continue;
      }
      const distPath = value.slice(base.length).replace(/[?#].*$/, "");
      if (distPath !== "" && !distPath.endsWith("/") && !exists(distPath))
        problems.push(`${name}="${value}" is not in the build`);
    }
  }
  return problems;
}

function htmlFiles(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      found.push(...htmlFiles(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".html")) found.push(rel);
  }
  return found.sort();
}

export function checkSiteDir(
  dir: string,
  base: string,
): { ok: boolean; problems: Problem[] } {
  const problems: Problem[] = [];
  const indexFile = join(dir, "index.html");
  if (!existsSync(indexFile))
    problems.push({ file: indexFile, message: "index.html not found" });
  else
    for (const message of assetPathProblems(
      readFileSync(indexFile, "utf8"),
      base,
      (p) => existsSync(join(dir, p)),
    ))
      problems.push({ file: indexFile, message });
  for (const rel of htmlFiles(dir)) {
    const file = join(dir, rel);
    for (const message of headPolicyProblems(readFileSync(file, "utf8")))
      problems.push({ file, message });
  }
  const versionFile = join(dir, "version.json");
  if (!existsSync(versionFile))
    problems.push({ file: versionFile, message: "version.json not found" });
  else {
    let body: unknown;
    try {
      body = JSON.parse(readFileSync(versionFile, "utf8"));
    } catch {
      problems.push({ file: versionFile, message: "not valid JSON" });
    }
    if (body !== undefined) {
      const v = body as { commit?: unknown; context?: unknown } | null;
      if (typeof v?.commit !== "string" || typeof v.context !== "string")
        problems.push({
          file: versionFile,
          message: "version.json needs a string commit and a string context",
        });
    }
  }
  return { ok: problems.length === 0, problems };
}

export type DeployedSiteOptions = {
  commit: string;
  context?: string;
  timeoutMs: number;
  intervalMs: number;
  log?: (message: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function checkDeployedSite(
  siteUrl: string,
  o: DeployedSiteOptions,
): Promise<{ ok: boolean; liveCommit: string | null; problems: string[] }> {
  const doFetch = o.fetch ?? fetch;
  const sleep =
    o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const site = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const base = new URL(site).pathname;
  const problems: string[] = [];
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const deadline = now() + o.timeoutMs;
  let live: { commit: string; context: string | null } | null = null;
  let last = "no response";
  for (;;) {
    try {
      const response = await doFetch(
        `${site}version.json?ts=${now()}`,
        noStore,
      );
      if (response.status !== 200) last = `status ${response.status}`;
      else {
        const body = (await response.json()) as {
          commit?: unknown;
          context?: unknown;
        } | null;
        if (typeof body?.commit !== "string")
          last = "version.json has no commit";
        else {
          live = {
            commit: body.commit,
            context: typeof body.context === "string" ? body.context : null,
          };
          last = `commit ${body.commit}`;
        }
      }
    } catch (error) {
      last = `error: ${reason(error)}`;
    }
    log(`version.json: ${last}`);
    if (live?.commit === o.commit) break;
    if (now() + o.intervalMs > deadline) {
      return {
        ok: false,
        liveCommit: live?.commit ?? null,
        problems: [
          `Timed out after ${Math.round(o.timeoutMs / 1000)} s: ${site}version.json never reported commit ${o.commit}. Last response: ${last}`,
        ],
      };
    }
    await sleep(o.intervalMs);
  }
  const liveCommit = live.commit;
  if (o.context !== undefined && live.context !== o.context)
    problems.push(
      `version.json context is "${live.context}", expected "${o.context}"`,
    );

  const get = async (
    url: string,
    expectedType: string,
    typeOk: (type: string) => boolean,
  ): Promise<string | null> => {
    try {
      const response = await doFetch(url, noStore);
      const type = response.headers.get("content-type") ?? "";
      const body = await response.text();
      if (response.status !== 200)
        problems.push(`${url}: status is ${response.status}, expected 200`);
      if (!typeOk(type))
        problems.push(
          `${url}: content-type is "${type}", expected ${expectedType}`,
        );
      return response.status === 200 ? body : null;
    } catch (error) {
      problems.push(`${url}: request failed: ${reason(error)}`);
      return null;
    }
  };

  const pageUrl = `${site}?ts=${now()}`;
  const html = await get(pageUrl, "text/html", (t) =>
    t.startsWith("text/html"),
  );
  if (html !== null) {
    for (const p of headPolicyProblems(html)) problems.push(`${pageUrl}: ${p}`);
    for (const p of assetPathProblems(html, base))
      problems.push(`${pageUrl}: ${p}`);
    const entry = elementsIn(html).find(
      (e) => e.name === "script" && e.attrs.src !== undefined,
    )?.attrs.src;
    if (entry === undefined)
      problems.push(`${pageUrl}: no entry <script src> found in the page`);
    else
      await get(new URL(entry, site).href, "JavaScript", (t) =>
        t.includes("javascript"),
      );
  }
  return { ok: problems.length === 0, liveCommit, problems };
}

async function main(argv: string[]): Promise<number> {
  const usage =
    "usage: node scripts/check-site.ts [<dir>] | --url <site> --commit <sha> [--context <c>] [--timeout-minutes 10] [--interval-seconds 15]";
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    console.error(reason(error));
    console.error(usage);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.url !== undefined) {
    if (!values.commit) {
      console.error(usage);
      return 2;
    }
    const timeout = Number(values["timeout-minutes"]);
    const interval = Number(values["interval-seconds"]);
    if (!(timeout > 0) || !(interval > 0)) {
      console.error(
        "--timeout-minutes and --interval-seconds must be positive",
      );
      return 2;
    }
    try {
      new URL(values.url);
    } catch {
      console.error(`--url is not a URL: ${values.url}`);
      return 2;
    }
    const result = await checkDeployedSite(values.url, {
      commit: values.commit,
      context: values.context,
      timeoutMs: timeout * 60_000,
      intervalMs: interval * 1000,
      log: console.log,
    });
    if (!result.ok) {
      for (const problem of result.problems) console.error(`FAIL ${problem}`);
      return 1;
    }
    console.log(
      `Deployed site check passed: ${values.url} is at ${result.liveCommit}`,
    );
    return 0;
  }
  const dir = positionals[0] === undefined ? WEB_DIST : resolve(positionals[0]);
  if (!distExists(dir)) return 2;
  let base: string;
  try {
    base = basePath(process.env);
  } catch (error) {
    console.error(reason(error));
    return 2;
  }
  const result = checkSiteDir(dir, base);
  if (!reportProblems("site", result.problems)) return 1;
  console.log(
    `site: ${dir} passes the QA-30 policy and base path ${base} checks`,
  );
  return 0;
}

function parseCli(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: "string" },
      commit: { type: "string" },
      context: { type: "string" },
      "timeout-minutes": { type: "string", default: "10" },
      "interval-seconds": { type: "string", default: "15" },
    },
  });
}

if (isMain(import.meta)) process.exitCode = await main(process.argv.slice(2));
