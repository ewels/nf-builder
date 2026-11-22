// The response headers of the spike's `vite preview` (ADR 0024): the site policy headers (SITE_POLICY_HEADERS), plus one CSP token.
import { SITE_POLICY_HEADERS } from "../../scripts/security-policy.ts";

export const WASM_UNSAFE_EVAL = "'wasm-unsafe-eval'";

/** Adds `source` to the script-src directive of a one-line policy. Throws if there is no script-src. */
export function addToScriptSrc(policy: string, source: string): string {
  let found = false;
  const directives = policy.split(";").map((part) => {
    const text = part.trim();
    if (text.split(/\s+/)[0]?.toLowerCase() !== "script-src") return text;
    found = true;
    return `${text} ${source}`;
  });
  if (!found) throw new Error("the policy has no script-src directive");
  return directives.join("; ");
}

/** The site policy headers. In "spike" mode (the default) script-src also gets 'wasm-unsafe-eval' (ADR 0014). */
export function spikeS5Headers(
  mode: "spike" | "production" = "spike",
): Record<string, string> {
  const headers = { ...SITE_POLICY_HEADERS };
  const csp = headers["Content-Security-Policy"];
  if (mode === "spike" && csp !== undefined)
    headers["Content-Security-Policy"] = addToScriptSrc(csp, WASM_UNSAFE_EVAL);
  return headers;
}
