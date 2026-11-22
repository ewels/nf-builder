import { describe, expect, it } from "vitest";
import {
  classify,
  matchTemplate,
  nextOrigin,
  type OpenApiPaths,
  openApiGetPaths,
  type ProbeRun,
  pickHeaders,
  probeOrigin,
  RECORDED_HEADERS,
  toMarkdown,
} from "../e2e/s4-probe/report.ts";
import { S4_TARGETS } from "../e2e/s4-probe/targets.ts";

const PAGE = "https://nf-builder.netlify.app";

describe("S4 probe model", () => {
  it("F-008 step 1: S4_PROBE_URL accepts only the production site, its deploy previews and the local preview, over https except localhost", () => {
    expect(probeOrigin("https://nf-builder.netlify.app/")).toBe(PAGE);
    expect(
      probeOrigin("https://deploy-preview-12--nf-builder.netlify.app"),
    ).toBe("https://deploy-preview-12--nf-builder.netlify.app");
    expect(probeOrigin("http://localhost:4173")).toBe("http://localhost:4173");
    for (const bad of [
      undefined,
      "",
      "http://nf-builder.netlify.app",
      "https://evil.example",
      "https://nf-builder.netlify.app.evil.example",
      "https://x--nf-builder.netlify.app.evil.example",
    ]) {
      expect(() => probeOrigin(bad), String(bad)).toThrow(
        /nf-builder\.netlify\.app/,
      );
    }
  });

  it("F-008 ADR-0009: after a cross-origin redirect to another origin the browser sends Origin null, otherwise the Origin is kept", () => {
    expect(
      nextOrigin(
        PAGE,
        "https://registry.nextflow.io/api/v1/modules/x/1/download",
        "https://public-cr-prod.seqera.io/blob",
        PAGE,
      ),
    ).toBe("null");
    expect(
      nextOrigin(
        PAGE,
        "https://api.github.com/repos/o/r/zipball/1",
        "https://codeload.github.com/o/r/legacy.zip",
        PAGE,
      ),
    ).toBe("null");
    expect(nextOrigin(PAGE, "https://registry.nextflow.io/a", "/b", PAGE)).toBe(
      PAGE,
    );
    expect(
      nextOrigin(PAGE, "https://a.example/x", "https://b.example/y", "null"),
    ).toBe("null");
  });

  const none = { url: "", sentOrigin: PAGE, durationMs: 1, headers: {} };
  const okBrowser = {
    id: "t",
    url: "https://registry.nextflow.io/x",
    durationMs: 3,
  };

  it("F-008 ADR-0009: classify calls a readable response allowed and a failed one blocked by CORS at the first hop without a matching Access-Control-Allow-Origin", () => {
    const hop = {
      ...none,
      url: "https://registry.nextflow.io/x",
      status: 200,
    };
    const server = { hops: [hop], preflight: { status: 401, headers: {} } };

    expect(
      classify({ ...okBrowser, outcome: "readable", status: 200 }, server)
        .verdict,
    ).toBe("allowed");

    const blocked = classify({ ...okBrowser, outcome: "failed" }, server);
    expect(blocked.verdict).toBe("blocked-by-cors");
    expect(blocked.reason).toContain("no Access-Control-Allow-Origin");
    expect(blocked.reason).toContain("registry.nextflow.io");

    const redirected = classify(
      { ...okBrowser, outcome: "failed" },
      {
        hops: [
          {
            ...hop,
            status: 307,
            headers: { location: "https://public-cr-prod.seqera.io/b" },
          },
          {
            ...none,
            url: "https://public-cr-prod.seqera.io/b",
            sentOrigin: "null",
            status: 200,
          },
        ],
        preflight: { error: "x" },
      },
    );
    expect(redirected.verdict).toBe("blocked-by-cors");
    expect(redirected.reason).toContain("registry.nextflow.io");
    expect(redirected.reason).toContain("307");

    expect(
      classify({ ...okBrowser, outcome: "csp-blocked" }, server).verdict,
    ).toBe("blocked-by-csp");

    expect(
      classify(
        { ...okBrowser, outcome: "failed" },
        { hops: [], preflight: { error: "e" }, error: "ENOTFOUND" },
      ).verdict,
    ).toBe("unreachable");

    expect(
      classify(
        { ...okBrowser, outcome: "failed" },
        {
          hops: [{ ...hop, headers: { "access-control-allow-origin": "*" } }],
          preflight: { status: 204, headers: {} },
        },
      ).verdict,
    ).toBe("inconclusive");
  });

  it("F-008 step 1: pickHeaders keeps only the CORS and diagnostic headers, lower-cased", () => {
    const picked = pickHeaders({
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain",
      "Set-Cookie": "a=b",
      Server: "x",
    });
    expect(picked).toEqual({
      "access-control-allow-origin": "*",
      "content-type": "text/plain",
    });
    for (const key of Object.keys(picked)) {
      expect(RECORDED_HEADERS).toContain(key);
    }
  });
});

const SAMPLE = `openapi: 3.0.3
info:
  title: Registry
  version: 0.14.0
paths:
  /api/v1/modules/list:
    get:
      operationId: ModulesAPI_listModules
      parameters:
        - name: size
  /api/v1/modules/{name}:
    get:
      operationId: ModulesAPI_getModule
    post:
      operationId: ModulesAPI_publishModuleRelease
  /api/v1/plugins/release:
    post:
      operationId: PluginsAPI_createRelease
components:
  schemas:
    Foo:
      type: object
`;

function pathsOf(templates: Record<string, string>): OpenApiPaths {
  return new Map(
    Object.entries(templates).map(([template, id]) => [
      template,
      new Map([["get", id]]),
    ]),
  );
}

const DECLARED = pathsOf({
  "/api/v1/modules/list": "ModulesAPI_listModules",
  "/api/v1/modules/{name}": "ModulesAPI_getModule",
  "/api/v1/modules/{name}/releases": "ModulesAPI_listModuleReleases",
  "/api/v1/modules/{name}/{version}": "ModulesAPI_getModuleRelease",
  "/api/v1/modules/{name}/{version}/download":
    "ModulesAPI_downloadModuleRelease",
  "/api/v1/modules": "ModulesAPI_searchModules",
  "/api/v1/plugins": "PluginsAPI_listPlugins",
  "/api/v1/plugins/{pluginId}": "PluginsAPI_getPlugin",
  "/api/v1/plugins/{pluginId}/{version}": "PluginsAPI_getRelease",
  "/api/v1/service-info": "ServiceInfoAPI_getServiceInfo",
});

describe("S4 OpenAPI and targets", () => {
  it("F-008 step 2: openApiGetPaths reads the paths, GET operationIds and info.version from OpenAPI YAML", () => {
    const { version, paths } = openApiGetPaths(SAMPLE);
    expect(version).toBe("0.14.0");
    expect([...paths.keys()]).toEqual([
      "/api/v1/modules/list",
      "/api/v1/modules/{name}",
      "/api/v1/plugins/release",
    ]);
    expect(paths.get("/api/v1/modules/list")?.get("get")).toBe(
      "ModulesAPI_listModules",
    );
    expect(paths.get("/api/v1/modules/{name}")?.get("get")).toBe(
      "ModulesAPI_getModule",
    );
    expect(paths.get("/api/v1/modules/{name}")?.get("post")).toBe(
      "ModulesAPI_publishModuleRelease",
    );
    expect(paths.get("/api/v1/plugins/release")?.has("get")).toBe(false);
    expect(openApiGetPaths("nothing here")).toEqual({
      version: null,
      paths: new Map(),
    });
  });

  it("F-008 step 2: matchTemplate prefers literal segments and needs module names encoded with %2F", () => {
    expect(matchTemplate(DECLARED, "/api/v1/modules/list")?.template).toBe(
      "/api/v1/modules/list",
    );
    expect(
      matchTemplate(DECLARED, "/api/v1/modules/nf-core%2Ffastqc/releases")
        ?.template,
    ).toBe("/api/v1/modules/{name}/releases");
    expect(matchTemplate(DECLARED, "/api/v1/modules/nf-core/fastqc")).toEqual({
      template: "/api/v1/modules/{name}/{version}",
      operationId: "ModulesAPI_getModuleRelease",
    });
    expect(matchTemplate(DECLARED, "/api/v2/unknown")).toBeNull();
    expect(matchTemplate(DECLARED, "/api/v1/service-info", "post")).toBeNull();
  });

  it("F-008 step 2 ADR-0009: every registry target matches the OpenAPI template and GET operation it declares", () => {
    const ids = S4_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    const registry = S4_TARGETS.filter((t) => t.group === "registry");
    for (const target of registry) {
      expect(target.openapi, target.id).toBeDefined();
      const hit = matchTemplate(DECLARED, new URL(target.url).pathname);
      expect(hit, target.id).toEqual(target.openapi);
      expect(new URL(target.url).origin).toBe("https://registry.nextflow.io");
    }
    for (const target of S4_TARGETS.filter((t) => t.group !== "registry")) {
      expect(target.openapi, target.id).toBeUndefined();
    }
    expect(new Set(registry.map((t) => t.openapi?.operationId))).toEqual(
      new Set([...DECLARED.values()].map((m) => m.get("get"))),
    );
    const groups = new Set(S4_TARGETS.map((t) => t.group));
    for (const group of ["raw", "codeload", "api.github.com"]) {
      expect(groups.has(group as never), group).toBe(true);
    }
  });

  it("F-008 step 1: toMarkdown writes one row per target with verdict, hop statuses, Access-Control-Allow-Origin values and timing", () => {
    const [first, second] = S4_TARGETS;
    if (!first || !second) throw new Error("targets missing");
    const run: ProbeRun = {
      probedAt: "2026-11-22T10:00:00.000Z",
      pageUrl: "https://deploy-preview-9--nf-builder.netlify.app/spike/s4/",
      deployed: { commit: "abc1234", context: "deploy-preview" },
      browserName: "chromium",
      browserVersion: "140.0",
      environment: "github-actions",
      records: [
        {
          target: first,
          browser: {
            id: first.id,
            url: first.url,
            outcome: "failed",
            durationMs: 12.3,
          },
          browserMessages: [],
          server: {
            hops: [
              {
                url: "https://registry.nextflow.io/a",
                sentOrigin: PAGE,
                status: 307,
                durationMs: 5,
                headers: {},
              },
              {
                url: "https://public-cr-prod.seqera.io/b",
                sentOrigin: "null",
                status: 200,
                durationMs: 7,
                headers: {},
              },
            ],
            preflight: { status: 401, headers: {} },
          },
          verdict: "blocked-by-cors",
          reason: "r",
        },
        {
          target: second,
          browser: {
            id: second.id,
            url: second.url,
            outcome: "readable",
            status: 200,
            durationMs: 150,
          },
          browserMessages: [],
          server: {
            hops: [
              {
                url: "https://raw.githubusercontent.com/x",
                sentOrigin: PAGE,
                status: 200,
                durationMs: 9,
                headers: { "access-control-allow-origin": "*" },
              },
            ],
            preflight: { error: "timeout" },
          },
          verdict: "allowed",
          reason: "r",
        },
      ],
    };
    const md = toMarkdown(run);
    expect(md).toContain("abc1234");
    expect(md).toContain("chromium");
    expect(md).toContain(
      "registry.nextflow.io 307 (no ACAO) → public-cr-prod.seqera.io 200 (no ACAO, Origin null)",
    );
    expect(md).toContain("raw.githubusercontent.com 200 (ACAO *)");
    const rows = md
      .split("\n")
      .filter(
        (l) =>
          l.startsWith("| ") && (l.includes(first.id) || l.includes(second.id)),
      );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("blocked-by-cors");
    expect(rows[1]).toContain("allowed");
    expect(rows[1]).toContain("150");
  });
});
