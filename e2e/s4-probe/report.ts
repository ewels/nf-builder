import type { ProbeTarget } from "./targets.ts";

export type TargetInput = { id: string; url: string };
type BrowserOutcome = "readable" | "failed" | "timeout" | "csp-blocked";
export type BrowserResult = {
  id: string;
  url: string;
  outcome: BrowserOutcome;
  durationMs: number;
  status?: number;
  responseType?: string;
  redirected?: boolean;
  finalUrl?: string;
  bytes?: number;
  exposedHeaders?: Record<string, string>;
  error?: string;
  cspDirective?: string;
};

/** Response headers kept per hop (lower case). */
export const RECORDED_HEADERS: readonly string[] = [
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "vary",
  "content-type",
  "content-length",
  "cross-origin-resource-policy",
  "location",
  "x-ratelimit-remaining",
  "ratelimit-remaining",
  "x-nf-module-checksum",
];

export type Hop = {
  url: string;
  sentOrigin: string;
  status: number;
  durationMs: number;
  headers: Record<string, string>;
};
export type Preflight =
  | { status: number; headers: Record<string, string> }
  | { error: string };
export type ServerResult = {
  hops: Hop[];
  preflight: Preflight;
  error?: string;
};
type Verdict =
  | "allowed"
  | "blocked-by-cors"
  | "blocked-by-csp"
  | "unreachable"
  | "inconclusive";
export type ProbeRecord = {
  target: ProbeTarget;
  browser: BrowserResult;
  browserMessages: string[];
  server: ServerResult;
  verdict: Verdict;
  reason: string;
};
export type ProbeRun = {
  probedAt: string;
  pageUrl: string;
  deployed: { commit: string; context: string } | null;
  browserName: string;
  browserVersion: string;
  environment: "github-actions" | "local";
  records: ProbeRecord[];
};

const USAGE =
  "S4_PROBE_URL must be https://nf-builder.netlify.app, https://<label>--nf-builder.netlify.app (a deploy preview) or http://localhost:<port>";

/** S4_PROBE_URL to an origin; throws a usage message for anything else. */
export function probeOrigin(value: string | undefined): string {
  const match = value
    ?.trim()
    .match(
      /^(https:\/\/(?:[a-z0-9-]+--)?nf-builder\.netlify\.app|http:\/\/localhost:\d+)\/?$/,
    );
  if (!match?.[1]) throw new Error(`${USAGE} (got ${JSON.stringify(value)})`);
  return match[1];
}

/** Origin header for the next hop after a redirect (Fetch "tainted origin"). */
export function nextOrigin(
  pageOrigin: string,
  currentUrl: string,
  locationUrl: string,
  sentOrigin: string,
): string {
  if (sentOrigin === "null") return "null";
  const current = new URL(currentUrl).origin;
  const next = new URL(locationUrl, currentUrl).origin;
  return current !== pageOrigin && next !== current ? "null" : sentOrigin;
}

/** Lower-cases names and keeps only RECORDED_HEADERS. */
export function pickHeaders(
  all: Record<string, string>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(all)) {
    const key = name.toLowerCase();
    if (RECORDED_HEADERS.includes(key)) picked[key] = value;
  }
  return picked;
}

const ACAO = "access-control-allow-origin";

function hostOf(url: string): string {
  return new URL(url).host;
}

/** Verdict for one target from what the page saw and what the server sent. */
export function classify(
  browser: BrowserResult,
  server: ServerResult,
): { verdict: Verdict; reason: string } {
  if (browser.outcome === "readable") {
    return {
      verdict: "allowed",
      reason: `The page read the response (status ${browser.status ?? "unknown"}).`,
    };
  }
  if (browser.outcome === "csp-blocked") {
    return {
      verdict: "blocked-by-csp",
      reason: `The site's CSP blocked the request (${browser.cspDirective ?? "unknown directive"}).`,
    };
  }
  if (server.hops.length === 0) {
    return {
      verdict: "unreachable",
      reason: `The server was not reached: ${server.error ?? "no response"}.`,
    };
  }
  for (const hop of server.hops) {
    const value = hop.headers[ACAO];
    if (value !== "*" && value !== hop.sentOrigin) {
      const sent = value
        ? `Access-Control-Allow-Origin ${value}`
        : "no Access-Control-Allow-Origin";
      return {
        verdict: "blocked-by-cors",
        reason: `${hostOf(hop.url)} answered ${hop.status} with ${sent} for Origin ${hop.sentOrigin}.`,
      };
    }
  }
  if (browser.outcome === "timeout") {
    return {
      verdict: "unreachable",
      reason: "The page's request timed out.",
    };
  }
  return {
    verdict: "inconclusive",
    reason:
      "Every hop allowed the origin, but the page's request still failed.",
  };
}

export type OpenApiPaths = Map<string, Map<string, string>>; // template -> method -> operationId

/** Line parser for the registry's OpenAPI YAML: `paths:` block, 2-space path keys, 4-space methods, 6-space operationId; info.version. */
export function openApiGetPaths(yaml: string): {
  version: string | null;
  paths: OpenApiPaths;
} {
  const paths: OpenApiPaths = new Map();
  let version: string | null = null;
  let section = "";
  let methods: Map<string, string> | undefined;
  let method = "";
  for (const line of yaml.split("\n")) {
    const top = line.match(/^([A-Za-z][\w-]*):/);
    if (top?.[1]) {
      section = top[1];
      continue;
    }
    if (section === "info") {
      const v = line.match(/^ {2}version:\s*["']?([^"'\s]+)/);
      if (v?.[1]) version = v[1];
    } else if (section === "paths") {
      const key = line.match(/^ {2}(\/\S*):\s*$/);
      if (key?.[1]) {
        methods = new Map();
        paths.set(key[1], methods);
        method = "";
        continue;
      }
      const verb = line.match(/^ {4}([a-z]+):\s*$/);
      if (verb?.[1] && methods) {
        method = verb[1];
        methods.set(method, "");
        continue;
      }
      const id = line.match(/^ {6}operationId:\s*(\S+)/);
      if (id?.[1] && methods && method) methods.set(method, id[1]);
    }
  }
  return { version, paths };
}

/** Matches a concrete, still-encoded pathname to a template; templates with more literal segments win. */
export function matchTemplate(
  paths: OpenApiPaths,
  pathname: string,
  method = "get",
): { template: string; operationId: string } | null {
  const segments = pathname.split("/");
  let best: { template: string; operationId: string; literals: number } | null =
    null;
  for (const [template, methods] of paths) {
    const operationId = methods.get(method);
    if (operationId === undefined) continue;
    const parts = template.split("/");
    if (parts.length !== segments.length) continue;
    let literals = 0;
    const fits = parts.every((part, i) => {
      const segment = segments[i] ?? "";
      if (/^\{[^}]+\}$/.test(part)) return segment !== "";
      literals += 1;
      return part === segment;
    });
    if (fits && (!best || literals > best.literals)) {
      best = { template, operationId, literals };
    }
  }
  return best && { template: best.template, operationId: best.operationId };
}

/** One line per cell: keeps the first line of a multi-line message. */
function cell(text: string): string {
  return (text.trim().split("\n")[0] ?? "").trim().replaceAll("|", "\\|");
}

function hopsText(server: ServerResult): string {
  if (server.hops.length === 0) return `no response: ${server.error ?? ""}`;
  const first = server.hops[0]?.sentOrigin;
  return server.hops
    .map((hop) => {
      const acao = hop.headers[ACAO];
      const notes = [acao ? `ACAO ${acao}` : "no ACAO"];
      if (hop.sentOrigin !== first) notes.push(`Origin ${hop.sentOrigin}`);
      return `${hostOf(hop.url)} ${hop.status} (${notes.join(", ")})`;
    })
    .join(" → ");
}

function preflightText(preflight: Preflight): string {
  if ("error" in preflight) return `error: ${preflight.error}`;
  const acao = preflight.headers[ACAO];
  return `${preflight.status} (${acao ? `ACAO ${acao}` : "no ACAO"})`;
}

function browserText(browser: BrowserResult): string {
  const detail =
    browser.status !== undefined
      ? ` ${browser.status}`
      : browser.cspDirective
        ? ` (${browser.cspDirective})`
        : "";
  return `${browser.outcome}${detail}`;
}

/** One heading line plus a table: Target | Verdict | Browser | Server hops | Preflight (Authorization) | ms. */
export function toMarkdown(run: ProbeRun): string {
  const deployed = run.deployed
    ? `commit ${run.deployed.commit}, context ${run.deployed.context}`
    : "commit unknown";
  const lines = [
    `## S4 probe: ${run.browserName} ${run.browserVersion}, ${run.pageUrl}, ${deployed}, ${run.environment}, ${run.probedAt}`,
    "",
    "| Target | Verdict | Browser | Server hops (status, ACAO, Origin sent) | Preflight (Authorization) | ms |",
    "|---|---|---|---|---|---|",
  ];
  for (const record of run.records) {
    lines.push(
      `| ${[
        record.target.id,
        record.verdict,
        browserText(record.browser),
        hopsText(record.server),
        preflightText(record.server.preflight),
        String(record.browser.durationMs),
      ]
        .map(cell)
        .join(" | ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
