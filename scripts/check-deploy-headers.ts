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
const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type Version = { commit: string; context: string | null };

async function readVersion(
  baseUrl: string,
): Promise<{ version?: Version; last: string }> {
  try {
    const response = await fetch(
      `${baseUrl}/version.json?ts=${Date.now()}`,
      NO_STORE,
    );
    if (response.status !== 200) return { last: `status ${response.status}` };
    const body = (await response.json()) as {
      commit?: unknown;
      context?: unknown;
    } | null;
    if (typeof body?.commit !== "string")
      return { last: "version.json has no commit" };
    const commit = body.commit;
    const context = body.context;
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

type Page = {
  path: string;
  status: number;
  type: string;
  headers: Headers;
  body: string;
};

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

  const fetchPage = async (
    path: string,
    expectedType: string,
    typeOk: (type: string) => boolean,
  ): Promise<Page | null> => {
    let page: Page;
    try {
      const response = await fetch(`${baseUrl}${path}`, NO_STORE);
      page = {
        path,
        status: response.status,
        type: response.headers.get("content-type") ?? "",
        headers: response.headers,
        body: await response.text(),
      };
    } catch (error) {
      problems.push(`${path}: request failed: ${message(error)}`);
      return null;
    }
    if (page.status !== 200)
      problems.push(`${path}: status is ${page.status}, expected 200`);
    if (!typeOk(page.type))
      problems.push(
        `${path}: content-type is "${page.type}", expected ${expectedType}`,
      );
    return page;
  };
  const isHtml = (type: string) => type.startsWith("text/html");

  const root = await fetchPage("/", "text/html", isHtml);
  const assetPath = root && /src="(\/assets\/[^"]+\.js)"/.exec(root.body)?.[1];
  if (root && !assetPath)
    problems.push("/: no /assets/*.js script found in the page");

  const deep = await fetchPage(DEEP_ROUTE, "text/html", isHtml);
  if (deep && !deep.body.includes('<div id="root">'))
    problems.push(
      `${DEEP_ROUTE}: body is not the app shell (no single-page-app fallback)`,
    );

  const asset = assetPath
    ? await fetchPage(assetPath, "javascript", (type) =>
        type.includes("javascript"),
      )
    : null;

  for (const page of [root, deep, asset]) {
    if (!page) continue;
    for (const [name, expected] of Object.entries(expectedHeaders)) {
      const actual = page.headers.get(name);
      if (actual === expected) log(`ok ${page.path} ${name}`);
      else
        problems.push(
          `${page.path}: ${name} is "${actual ?? ""}", expected "${expected}"`,
        );
    }
  }

  const csp = root?.headers.get("content-security-policy");
  if (csp)
    for (const problem of cspProblems(csp)) problems.push(`QA-30: ${problem}`);

  return { ok: problems.length === 0, liveCommit, problems };
}

const parseCli = () =>
  parseArgs({
    options: {
      url: { type: "string" },
      commit: { type: "string" },
      context: { type: "string" },
      "allow-newer": { type: "boolean", default: false },
      "timeout-minutes": { type: "string", default: "15" },
      "interval-seconds": { type: "string", default: "15" },
    },
  }).values;

async function main(): Promise<void> {
  let values: ReturnType<typeof parseCli>;
  try {
    values = parseCli();
  } catch (error) {
    console.error(message(error));
    process.exitCode = 2;
    return;
  }
  if (!values.url || !values.commit) {
    console.error(
      "usage: check-deploy-headers.ts --url <url> --commit <sha> [--context <name>] [--allow-newer]",
    );
    process.exitCode = 2;
    return;
  }
  const timeoutMinutes = Number(values["timeout-minutes"]);
  const intervalSeconds = Number(values["interval-seconds"]);
  for (const [flag, value] of [
    ["--timeout-minutes", timeoutMinutes],
    ["--interval-seconds", intervalSeconds],
  ] as const)
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`${flag} must be a positive number`);
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
      token: process.env.GITHUB_TOKEN,
    };
  }
  const result = await checkDeploy({
    baseUrl: values.url.replace(/\/+$/, ""),
    commit: values.commit,
    context: values.context,
    allowNewer,
    expectedHeaders: siteHeaders(readNetlifyConfig()),
    timeoutMs: timeoutMinutes * 60_000,
    intervalMs: intervalSeconds * 1000,
    log: console.log,
  });
  if (!result.ok) {
    for (const problem of result.problems) console.error(`FAIL ${problem}`);
    process.exitCode = 1;
  } else console.log("Deploy check passed");
}

if (import.meta.filename === process.argv[1]) await main();
