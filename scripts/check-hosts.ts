// IO-41: the built app may name only the ADR 0002 origins (scripts/allow-list.ts), plus URLs that are
// never fetched (scripts/non-fetched-urls.ts). Scans code files in the build output: .js, .mjs, .cjs, .css, .html.
// JSON and other data are not scanned (the future registry snapshot is full of URLs that are data, not calls).
// A host built at runtime (`https://${h}`, "https://"+h) can't be checked statically and is skipped;
// the CSP connect-src is the runtime guard for those.
// Imports only node: built-ins and sibling scripts, so CI can run it without `pnpm install`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { ALLOWED_ORIGINS } from "./allow-list.ts";
import {
  isMain,
  type Problem,
  REPO_ROOT,
  reportProblems,
  WEB_DIST,
} from "./check-common.ts";
import { NON_FETCHED_URLS, type NonFetchedUrl } from "./non-fetched-urls.ts";

export const SCANNED_EXTENSIONS: readonly string[] = [
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".html",
];

export type FoundUrl = {
  url: string;
  index: number;
  line: number;
  column: number;
};

export type Verdict =
  | { kind: "allowed" }
  | { kind: "ignored"; entry: NonFetchedUrl }
  | { kind: "no-host" }
  | { kind: "forbidden"; origin: string; host: string };

const URL_PATTERN =
  /\b(?:https?|wss?):(?:\\?\/){2}(?:\\\/|[^\s"'`<>()\\{}|^])*/gi;
const HOST_PATTERN =
  /^(https?|wss?):\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d+))?/i;

/** Every absolute http(s)/ws(s) URL in the text, with 1-based line and column. */
export function findUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    const before = text.slice(0, index);
    const line = before.split("\n").length;
    const column = index - before.lastIndexOf("\n");
    found.push({ url: match[0].replace(/\\\//g, "/"), index, line, column });
  }
  return found;
}

export function classifyUrl(
  url: string,
  allowed: readonly string[] = ALLOWED_ORIGINS,
  ignore: readonly NonFetchedUrl[] = NON_FETCHED_URLS,
): Verdict {
  const match = HOST_PATTERN.exec(url);
  if (match === null) return { kind: "no-host" };
  const entry = ignore.find((e) =>
    e.match === "exact" ? url === e.url : url.startsWith(e.url),
  );
  if (entry !== undefined) return { kind: "ignored", entry };
  const scheme = (match[1] ?? "").toLowerCase();
  const host = (match[2] ?? "").toLowerCase();
  const origin = `${scheme}://${host}${match[3] === undefined ? "" : `:${match[3]}`}`;
  if (allowed.includes(origin)) return { kind: "allowed" };
  return { kind: "forbidden", origin, host };
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

function hostsOf(origins: readonly string[]): string {
  return origins.map((o) => o.replace(/^[a-z]+:\/\//, "")).join(", ");
}

export function scanDist(
  distDir: string,
  options: {
    allowed?: readonly string[];
    ignore?: readonly NonFetchedUrl[];
  } = {},
): {
  problems: Problem[];
  unusedIgnores: NonFetchedUrl[];
  files: number;
  urls: number;
} {
  const allowed = options.allowed ?? ALLOWED_ORIGINS;
  const ignore = options.ignore ?? NON_FETCHED_URLS;
  const used = new Set<NonFetchedUrl>();
  const problems: Problem[] = [];
  let files = 0;
  let urls = 0;
  for (const file of walk(distDir)) {
    if (!SCANNED_EXTENSIONS.includes(extname(file))) continue;
    files++;
    const text = readFileSync(file, "utf8");
    const seen = new Set<string>();
    for (const found of findUrls(text)) {
      urls++;
      const verdict = classifyUrl(found.url, allowed, ignore);
      if (verdict.kind === "ignored") used.add(verdict.entry);
      if (verdict.kind !== "forbidden" || seen.has(found.url)) continue;
      seen.add(found.url);
      const context = text
        .slice(
          Math.max(0, found.index - 40),
          found.index + found.url.length + 40,
        )
        .replace(/\s+/g, " ");
      const httpNote =
        found.url.toLowerCase().startsWith("http:") &&
        allowed.includes(`https://${verdict.host}`)
          ? " (the allow-list is https only)"
          : "";
      problems.push({
        file,
        line: found.line,
        column: found.column,
        message: `${found.url} contacts ${verdict.host}, which is not on the ADR 0002 allow-list (${hostsOf(allowed)})${httpNote}. Context: …${context}… If the app must call it, add the origin to scripts/allow-list.ts and the CSP connect-src with an ADR (IO-41). If it is never fetched (a namespace or docs link), add it to scripts/non-fetched-urls.ts with a reason.`,
      });
    }
  }
  const unusedIgnores = ignore.filter((e) => !used.has(e));
  return { problems, unusedIgnores, files, urls };
}

function main(argv: string[]): number {
  let dist = WEB_DIST;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dist" && argv[i + 1] !== undefined)
      dist = resolve(argv[++i] ?? "");
    else {
      console.error("usage: node scripts/check-hosts.ts [--dist <path>]");
      return 2;
    }
  }
  try {
    if (!statSync(dist).isDirectory()) throw new Error("not a directory");
  } catch {
    const shown = dist.startsWith(REPO_ROOT) ? relative(REPO_ROOT, dist) : dist;
    console.error(`${shown} not found: run pnpm build first`);
    return 2;
  }
  const { problems, unusedIgnores, files, urls } = scanDist(dist);
  for (const e of unusedIgnores)
    console.log(
      `note: scripts/non-fetched-urls.ts entry ${e.url} (${e.match}) matched nothing; remove it if it is obsolete`,
    );
  if (!reportProblems("IO-41", problems)) return 1;
  console.log(
    `IO-41: ${files} files, ${urls} absolute URLs: all allowed or listed as never fetched`,
  );
  return 0;
}

if (isMain(import.meta)) process.exitCode = main(process.argv.slice(2));
