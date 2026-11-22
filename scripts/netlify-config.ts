import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { CONNECT_SRC_ALLOW_LIST, cspProblems } from "./security-policy.ts";

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

export { CONNECT_SRC_ALLOW_LIST, cspProblems };

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
