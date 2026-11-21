import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { ALLOWED_ORIGINS } from "./allow-list.ts";

type NetlifyHeaderRule = { for: string; values: Record<string, string> };
type NetlifyRedirect = {
  from: string;
  to: string;
  status: number;
  force?: boolean;
};
export type NetlifyConfig = {
  build: {
    command: string;
    publish: string;
    environment: Record<string, string>;
  };
  redirects: NetlifyRedirect[];
  headers: NetlifyHeaderRule[];
};

/** ADR 0002: the only origins the app may connect to (the list lives in scripts/allow-list.ts). */
export const CONNECT_SRC_ALLOW_LIST: readonly string[] = [
  "'self'",
  ...ALLOWED_ORIGINS,
];

type Table = Record<string, unknown>;

function table(value: unknown, key: string): Table {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`netlify.toml: ${key} is missing or not a table`);
  return value as Table;
}

function list(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`netlify.toml: ${key} is missing or not an array`);
  return value;
}

function str(value: unknown, key: string): string {
  if (typeof value !== "string")
    throw new Error(`netlify.toml: ${key} is missing or not a string`);
  return value;
}

function strings(value: unknown, key: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(table(value, key)))
    result[name] = str(entry, `${key}.${name}`);
  return result;
}

export function readNetlifyConfig(): NetlifyConfig {
  const toml = readFileSync(
    new URL("../netlify.toml", import.meta.url),
    "utf8",
  );
  const root = table(parse(toml), "root");
  const build = table(root.build, "build");
  const redirects = list(root.redirects, "redirects").map((entry, i) => {
    const r = table(entry, `redirects[${i}]`);
    const status = r.status;
    if (typeof status !== "number")
      throw new Error(
        `netlify.toml: redirects[${i}].status is missing or not a number`,
      );
    const redirect: NetlifyRedirect = {
      from: str(r.from, `redirects[${i}].from`),
      to: str(r.to, `redirects[${i}].to`),
      status,
    };
    if (typeof r.force === "boolean") redirect.force = r.force;
    return redirect;
  });
  const headers = list(root.headers, "headers").map((entry, i) => {
    const h = table(entry, `headers[${i}]`);
    return {
      for: str(h.for, `headers[${i}].for`),
      values: strings(h.values, `headers[${i}].values`),
    };
  });
  return {
    build: {
      command: str(build.command, "build.command"),
      publish: str(build.publish, "build.publish"),
      environment: strings(build.environment, "build.environment"),
    },
    redirects,
    headers,
  };
}

/** The headers of the single `for = "/*"` rule. */
export function siteHeaders(config: NetlifyConfig): Record<string, string> {
  const rules = config.headers.filter((h) => h.for === "/*");
  if (rules.length !== 1)
    throw new Error(
      `netlify.toml: expected exactly one headers rule for "/*", found ${rules.length}`,
    );
  return { ...rules[0]?.values };
}

const SCRIPT_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
];

/** Keywords, nonces and hashes, `data:`, `blob:`, `*`, and any bare scheme such as `https:`. */
const FORBIDDEN_SCRIPT_SOURCE =
  /^('(unsafe-inline|unsafe-eval|unsafe-hashes|nonce-.*|sha(256|384|512)-.*)'|data:|blob:|\*|[a-z][a-z0-9+.-]*:)$/;

/** Returns one readable problem per QA-30 breach; [] when the policy is acceptable. */
export function cspProblems(policy: string): string[] {
  const problems: string[] = [];
  if (/[\r\n]/.test(policy)) problems.push("the policy contains a line break");
  if (policy.includes(","))
    problems.push(
      "the policy contains a comma, which makes it several policies",
    );

  const directives = new Map<string, string[]>();
  const repeated = new Set<string>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().toLowerCase().split(/\s+/);
    if (!name) continue;
    if (directives.has(name)) repeated.add(name);
    directives.set(name, sources);
  }
  for (const name of repeated) problems.push(`${name} appears more than once`);

  if (!directives.has("script-src")) problems.push("script-src is missing");
  for (const name of SCRIPT_DIRECTIVES) {
    for (const source of directives.get(name) ?? []) {
      if (FORBIDDEN_SCRIPT_SOURCE.test(source))
        problems.push(`${name} allows ${source}`);
    }
  }

  const connect = directives.get("connect-src");
  if (connect === undefined) problems.push("connect-src is missing");
  else {
    for (const source of connect) {
      if (!CONNECT_SRC_ALLOW_LIST.includes(source))
        problems.push(
          `connect-src allows ${source}, which is not on the ADR 0002 allow-list`,
        );
    }
  }
  return problems;
}
