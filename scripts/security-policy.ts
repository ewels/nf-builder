import { ALLOWED_ORIGINS } from "./allow-list.ts";

/** ADR 0002: the only origins the app may connect to (the list lives in scripts/allow-list.ts). */
export const CONNECT_SRC_ALLOW_LIST: readonly string[] = [
  "'self'",
  ...ALLOWED_ORIGINS,
];

/**
 * QA-30, ADR 0040: ADR 0014's policy without frame-ancestors (a <meta> policy ignores it), on one line.
 * No inline scripts. Loosenings are recorded in the PR that needs them.
 */
export const CONTENT_SECURITY_POLICY: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src ${CONNECT_SRC_ALLOW_LIST.join(" ")}`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export const REFERRER_POLICY = "no-referrer";

/** CSP3 section 3.3: directives a policy delivered in a <meta> element ignores. */
export const META_IGNORED_DIRECTIVES: readonly string[] = [
  "frame-ancestors",
  "report-uri",
  "sandbox",
];

export type MetaTag = { readonly attrs: Readonly<Record<string, string>> };

/** The CSP element first, then the referrer element. */
export const POLICY_META_TAGS: readonly MetaTag[] = [
  {
    attrs: {
      "http-equiv": "Content-Security-Policy",
      content: CONTENT_SECURITY_POLICY,
    },
  },
  { attrs: { name: "referrer", content: REFERRER_POLICY } },
];

/** The same two values as response headers, for spike servers that still send headers (ADRs 0022 and 0024). */
export const SITE_POLICY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Referrer-Policy": REFERRER_POLICY,
};

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

/** `cspProblems` plus any directive a <meta> policy ignores. */
export function metaPolicyProblems(policy: string): string[] {
  const problems = cspProblems(policy);
  const names = new Set(
    policy.split(";").map((part) => part.trim().split(/\s+/)[0]?.toLowerCase()),
  );
  for (const name of META_IGNORED_DIRECTIVES) {
    if (names.has(name))
      problems.push(`${name} is ignored in a <meta> policy; remove it`);
  }
  return problems;
}
