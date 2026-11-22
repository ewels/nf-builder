import {
  readNetlifyConfig,
  siteHeaders,
} from "../../scripts/netlify-config.ts";
import { CHEERPJ_ORIGIN } from "./protocol.ts";

export type SpikeCsp = "cheerpj" | "qa30";

/** Appends sources to named directives, keeping order, on one line. An unknown directive throws. */
export function addSources(
  policy: string,
  additions: Readonly<Record<string, readonly string[]>>,
): string {
  const parts = policy
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const known = new Set(parts.map((p) => p.split(/\s+/)[0]));
  for (const name of Object.keys(additions)) {
    if (!known.has(name))
      throw new Error(`CSP has no ${name} directive to add sources to`);
  }
  return parts
    .map((part) => {
      const name = part.split(/\s+/)[0] ?? "";
      const extra = additions[name];
      return extra ? `${part} ${extra.join(" ")}` : part;
    })
    .join("; ");
}

/** cheerpj: what CheerpJ needs. qa30: the most QA-30 allows, to record what that blocks. */
export function spikeCsp(kind: SpikeCsp, production: string): string {
  const evalSource =
    kind === "cheerpj" ? "'unsafe-eval'" : "'wasm-unsafe-eval'";
  return addSources(production, {
    "script-src": [CHEERPJ_ORIGIN, evalSource],
    "connect-src": [CHEERPJ_ORIGIN],
  });
}

export function spikeHeaders(
  kind: SpikeCsp,
  production: Record<string, string> = siteHeaders(readNetlifyConfig()),
): Record<string, string> {
  const csp = production["Content-Security-Policy"];
  if (csp === undefined)
    throw new Error("netlify.toml has no Content-Security-Policy");
  return { ...production, "Content-Security-Policy": spikeCsp(kind, csp) };
}
