// Checks that a Netlify deploy serves the expected commit with the netlify.toml headers (F-002, QA-30).
import { parseArgs } from "node:util";
import {
  cspProblems,
  readNetlifyConfig,
  siteHeaders,
} from "./netlify-config.ts";

export type DeployCheckOptions = {
  baseUrl: string;
  commit: string;
  context?: string;
  allowNewer?: { apiUrl: string; repo: string; token?: string };
  expectedHeaders: Record<string, string>;
  timeoutMs: number;
  intervalMs: number;
  log: (line: string) => void;
};
export type DeployCheckResult = {
  ok: boolean;
  liveCommit: string | null;
  problems: string[];
};

export const DEEP_ROUTE = "/deploy-check/deep/route";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Version = { commit: string; context: string | null };

async function readVersion(
  baseUrl: string,
): Promise<{ version?: Version; last: string }> {
  try {
    const response = await fetch(`${baseUrl}/version.json?ts=${Date.now()}`, {
      headers: { "Cache-Control": "no-store" },
    });
    if (response.status !== 200) return { last: `status ${response.status}` };
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { commit?: unknown }).commit !== "string"
    )
      return { last: "version.json has no commit" };
    const { commit, context } = body as { commit: string; context?: unknown };
    return {
      version: {
        commit,
        context: typeof context === "string" ? context : null,
      },
      last: `commit ${commit}`,
    };
  } catch (error) {
    return { last: `error: ${message(error)}` };
  }
}

async function isNewerOrSame(
  allow: NonNullable<DeployCheckOptions["allowNewer"]>,
  expected: string,
  live: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${allow.apiUrl}/repos/${allow.repo}/compare/${expected}...${live}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(allow.token ? { Authorization: `Bearer ${allow.token}` } : {}),
        },
      },
    );
    if (response.status !== 200) return false;
    const body = (await response.json()) as { status?: unknown };
    return body.status === "ahead" || body.status === "identical";
  } catch {
    return false;
  }
}

type Page = { status: number; type: string; headers: Headers; body: string };

async function get(url: string): Promise<Page | string> {
  try {
    const response = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
    });
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      headers: response.headers,
      body: await response.text(),
    };
  } catch (error) {
    return `request failed: ${message(error)}`;
  }
}

export async function checkDeploy(
  options: DeployCheckOptions,
): Promise<DeployCheckResult> {
  const { baseUrl, commit, expectedHeaders, log } = options;
  const problems: string[] = [];
  const deadline = Date.now() + options.timeoutMs;
  const compared = new Map<string, boolean>();
  let live: Version | null = null;
  let last = "no response";
  let ready = false;

  for (;;) {
    const read = await readVersion(baseUrl);
    last = read.last;
    if (read.version) live = read.version;
    log(`version.json: ${read.last}`);
    if (read.version?.commit === commit) {
      ready = true;
      break;
    }
    if (read.version && options.allowNewer) {
      const sha = read.version.commit;
      let newer = compared.get(sha);
      if (newer === undefined) {
        newer = await isNewerOrSame(options.allowNewer, commit, sha);
        compared.set(sha, newer);
      }
      if (newer) {
        log(`newer commit ${sha} is live and contains ${commit}`);
        ready = true;
        break;
      }
    }
    if (Date.now() + options.intervalMs > deadline) break;
    await sleep(options.intervalMs);
  }

  const liveCommit = live?.commit ?? null;
  if (!ready) {
    const minutes = Math.round((options.timeoutMs / 60_000) * 100) / 100;
    problems.push(
      `Timed out after ${minutes} min: ${baseUrl}/version.json never reported commit ${commit}. Last response: ${last}`,
    );
    return { ok: false, liveCommit, problems };
  }

  if (options.context !== undefined && live?.context !== options.context)
    problems.push(
      `version.json context is "${live?.context}", expected "${options.context}"`,
    );

  const checkPage = (path: string, page: Page | string): Page | null => {
    if (typeof page === "string") {
      problems.push(`${path}: ${page}`);
      return null;
    }
    return page;
  };

  const root = checkPage("/", await get(`${baseUrl}/`));
  let assetPath: string | undefined;
  if (root) {
    if (root.status !== 200)
      problems.push(`/: status is ${root.status}, expected 200`);
    if (!root.type.startsWith("text/html"))
      problems.push(`/: content-type is "${root.type}", expected text/html`);
    assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(root.body)?.[1];
    if (!assetPath)
      problems.push("/: no /assets/*.js script found in the page");
  }

  const deep = checkPage(DEEP_ROUTE, await get(`${baseUrl}${DEEP_ROUTE}`));
  if (deep) {
    if (deep.status !== 200)
      problems.push(`${DEEP_ROUTE}: status is ${deep.status}, expected 200`);
    if (!deep.type.startsWith("text/html"))
      problems.push(
        `${DEEP_ROUTE}: content-type is "${deep.type}", expected text/html`,
      );
    if (!deep.body.includes('<div id="root">'))
      problems.push(
        `${DEEP_ROUTE}: body is not the app shell (no single-page-app fallback)`,
      );
  }

  let asset: Page | null = null;
  if (assetPath) {
    asset = checkPage(assetPath, await get(`${baseUrl}${assetPath}`));
    if (asset) {
      if (asset.status !== 200)
        problems.push(`${assetPath}: status is ${asset.status}, expected 200`);
      if (!asset.type.includes("javascript"))
        problems.push(
          `${assetPath}: content-type is "${asset.type}", expected javascript`,
        );
    }
  }

  const pages: [string, Page | null][] = [
    ["/", root],
    [DEEP_ROUTE, deep],
    [assetPath ?? "(asset)", asset],
  ];
  for (const [path, page] of pages) {
    if (!page) continue;
    for (const [name, expected] of Object.entries(expectedHeaders)) {
      const actual = page.headers.get(name);
      if (actual === expected) log(`ok ${path} ${name}`);
      else
        problems.push(
          `${path}: ${name} is "${actual ?? ""}", expected "${expected}"`,
        );
    }
  }

  const csp = root?.headers.get("content-security-policy");
  if (csp)
    for (const problem of cspProblems(csp)) problems.push(`QA-30: ${problem}`);

  return { ok: problems.length === 0, liveCommit, problems };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      commit: { type: "string" },
      context: { type: "string" },
      "allow-newer": { type: "boolean", default: false },
      "timeout-minutes": { type: "string", default: "15" },
      "interval-seconds": { type: "string", default: "15" },
    },
  });
  if (!values.url || !values.commit) {
    console.error(
      "usage: check-deploy-headers.ts --url <url> --commit <sha> [--context <name>] [--allow-newer]",
    );
    process.exitCode = 2;
    return;
  }
  let allowNewer: DeployCheckOptions["allowNewer"];
  if (values["allow-newer"]) {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) {
      console.error("--allow-newer needs GITHUB_REPOSITORY (owner/name)");
      process.exitCode = 2;
      return;
    }
    allowNewer = {
      apiUrl: process.env.GITHUB_API_URL || "https://api.github.com",
      repo,
      ...(process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {}),
    };
  }
  const result = await checkDeploy({
    baseUrl: values.url.replace(/\/+$/, ""),
    commit: values.commit,
    ...(values.context !== undefined ? { context: values.context } : {}),
    ...(allowNewer ? { allowNewer } : {}),
    expectedHeaders: siteHeaders(readNetlifyConfig()),
    timeoutMs: Number(values["timeout-minutes"]) * 60_000,
    intervalMs: Number(values["interval-seconds"]) * 1000,
    log: console.log,
  });
  if (!result.ok) {
    for (const problem of result.problems) console.error(`FAIL ${problem}`);
    process.exitCode = 1;
  } else console.log("Deploy check passed");
}

if (import.meta.filename === process.argv[1]) await main();
