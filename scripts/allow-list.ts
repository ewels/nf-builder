/**
 * ADR 0002 and IO-41: the only origins the app may contact at runtime, besides its own.
 * The CSP connect-src (scripts/security-policy.ts) and the built-bundle scan
 * (scripts/check-hosts.ts) both use this list. Adding an origin needs an ADR.
 * The CheerpJ CDN joins only if ADR 0010 is adopted.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  "https://api.github.com",
  "https://raw.githubusercontent.com",
  "https://registry.nextflow.io",
];
