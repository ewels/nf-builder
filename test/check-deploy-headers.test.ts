import { spawnSync } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkDeploy,
  DEEP_ROUTE,
  type DeployCheckOptions,
} from "../scripts/check-deploy-headers.ts";
import { readNetlifyConfig, siteHeaders } from "../scripts/netlify-config.ts";

const headers = siteHeaders(readNetlifyConfig());
const COMMIT = "a".repeat(40);
const NEWER = "b".repeat(40);
const ASSET = "/assets/index-abc123.js";
const HTML = `<!doctype html><script type="module" src="${ASSET}"></script><div id="root"></div>`;

type Behaviour = {
  liveCommit?: string;
  context?: string;
  headerOverrides?: Record<string, string>;
  deepRouteStatus?: number;
  compareStatus?: string;
  rootHtml?: string;
  assetType?: string;
};

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function serve(b: Behaviour = {}): Promise<string> {
  const send = (
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
  ) => {
    res.writeHead(status, {
      ...headers,
      ...b.headerOverrides,
      "content-type": type,
    });
    res.end(body);
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?")[0];
    if (path === "/version.json")
      send(
        res,
        200,
        "application/json",
        JSON.stringify({
          commit: b.liveCommit ?? COMMIT,
          context: b.context ?? "deploy-preview",
        }),
      );
    else if (path === "/")
      send(res, 200, "text/html; charset=utf-8", b.rootHtml ?? HTML);
    else if (path === ASSET)
      send(
        res,
        200,
        b.assetType ?? "text/javascript; charset=utf-8",
        "console.log(1)",
      );
    else if (path === DEEP_ROUTE)
      send(
        res,
        b.deepRouteStatus ?? 200,
        "text/html; charset=utf-8",
        b.deepRouteStatus ? "not found" : HTML,
      );
    else if (path?.startsWith("/repos/o/r/compare/"))
      send(
        res,
        200,
        "application/json",
        JSON.stringify({ status: b.compareStatus ?? "ahead" }),
      );
    else send(res, 404, "text/plain", "no");
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function options(
  baseUrl: string,
  extra: Partial<DeployCheckOptions> = {},
): DeployCheckOptions {
  return {
    baseUrl,
    commit: COMMIT,
    expectedHeaders: headers,
    timeoutMs: 300,
    intervalMs: 10,
    log: () => {},
    ...extra,
  };
}

describe("checkDeploy", () => {
  it("F-002 step 4: passes when the site serves the expected commit and every netlify.toml header on /, a deep route and a hashed asset", async () => {
    const base = await serve();
    const result = await checkDeploy(
      options(base, { context: "deploy-preview" }),
    );
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.liveCommit).toBe(COMMIT);
  });

  it("F-002 step 4: fails naming the path and header when the deployed Content-Security-Policy differs", async () => {
    const base = await serve({
      headerOverrides: { "Content-Security-Policy": "default-src *" },
    });
    const result = await checkDeploy(options(base));
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `/: Content-Security-Policy is "default-src *", expected "${headers["Content-Security-Policy"]}"`,
    );
  });

  it("F-002 step 3: fails with the last seen commit when the expected commit never goes live", async () => {
    const base = await serve({ liveCommit: NEWER });
    const result = await checkDeploy(options(base));
    expect(result.ok).toBe(false);
    expect(result.liveCommit).toBe(NEWER);
    const text = result.problems.join("\n");
    expect(text).toContain(COMMIT);
    expect(text).toContain(NEWER);
    expect(text).toContain("Timed out");
  });

  it("F-002 step 3: fails when a deep route does not fall back to index.html", async () => {
    const base = await serve({ deepRouteStatus: 404 });
    const result = await checkDeploy(options(base));
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain(DEEP_ROUTE);
  });

  it("F-002 step 3: on main, passes when a newer commit is live and GitHub's compare status is ahead", async () => {
    const base = await serve({ liveCommit: NEWER, compareStatus: "ahead" });
    const result = await checkDeploy(
      options(base, { allowNewer: { apiUrl: base, repo: "o/r" } }),
    );
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.liveCommit).toBe(NEWER);
  });

  it("F-002 step 3: on main, times out when GitHub's compare status is behind", async () => {
    const base = await serve({ liveCommit: NEWER, compareStatus: "behind" });
    const result = await checkDeploy(
      options(base, { allowNewer: { apiUrl: base, repo: "o/r" } }),
    );
    expect(result.ok).toBe(false);
  });

  it("F-002 step 3: fails when version.json reports a different context than expected", async () => {
    const base = await serve({ context: "branch-deploy" });
    const result = await checkDeploy(
      options(base, { context: "deploy-preview" }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      'version.json context is "branch-deploy", expected "deploy-preview"',
    );
  });

  it("F-002 step 3: fails when the root page references no /assets/*.js script", async () => {
    const base = await serve({
      rootHtml: '<!doctype html><div id="root"></div>',
    });
    const result = await checkDeploy(options(base));
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      "/: no /assets/*.js script found in the page",
    );
  });

  it("F-002 step 3: fails when the hashed asset is not served as JavaScript", async () => {
    const base = await serve({ assetType: "text/plain" });
    const result = await checkDeploy(options(base));
    expect(result.ok).toBe(false);
    expect(result.problems).toContain(
      `${ASSET}: content-type is "text/plain", expected javascript`,
    );
  });
});

describe("check-deploy-headers command line", () => {
  const script = fileURLToPath(
    new URL("../scripts/check-deploy-headers.ts", import.meta.url),
  );
  it.each([
    ["--timeout-minutes", "abc"],
    ["--timeout-minutes", "0"],
    ["--timeout-minutes", "-1"],
    ["--interval-seconds", "abc"],
    ["--interval-seconds", "0"],
    ["--interval-seconds", "-5"],
  ])("F-002: %s %s is a usage error (exit 2)", (flag, value) => {
    const result = spawnSync(
      process.execPath,
      [script, "--url", "http://127.0.0.1:1", "--commit", "x", flag, value],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(flag);
  });
});
