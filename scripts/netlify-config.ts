import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

export type NetlifyHeaderRule = { for: string; values: Record<string, string> };
export type NetlifyRedirect = {
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

export const NETLIFY_TOML = fileURLToPath(
  new URL("../netlify.toml", import.meta.url),
);

/** ADR 0002: the only origins the app may connect to. */
export const CONNECT_SRC_ALLOW_LIST: readonly string[] = [
  "'self'",
  "https://api.github.com",
  "https://raw.githubusercontent.com",
  "https://registry.nextflow.io",
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

export function readNetlifyConfig(path: string = NETLIFY_TOML): NetlifyConfig {
  const root = table(parse(readFileSync(path, "utf8")), "root");
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

export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const words = part.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const [name, ...sources] = words;
    if (name !== undefined) directives.set(name, sources);
  }
  return directives;
}

const SCRIPT_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
];

const FORBIDDEN_SCRIPT_SOURCE =
  /^'(unsafe-inline|unsafe-eval|unsafe-hashes|nonce-.*|sha(256|384|512)-.*)'$/;

/** Returns one readable problem per QA-30 breach; [] when the policy is acceptable. */
export function cspProblems(policy: string): string[] {
  const problems: string[] = [];
  if (/[\r\n]/.test(policy)) problems.push("the policy contains a line break");
  if (policy.includes(","))
    problems.push(
      "the policy contains a comma, which makes it several policies",
    );

  const names = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase())
    .filter((name): name is string => Boolean(name));
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i)))
    problems.push(`${name} appears more than once`);

  const directives = parseCsp(policy);
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
