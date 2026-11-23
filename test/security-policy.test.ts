import { describe, expect, it } from "vitest";
import { ALLOWED_ORIGINS } from "../scripts/allow-list.ts";
import {
  CONNECT_SRC_ALLOW_LIST,
  CONTENT_SECURITY_POLICY,
  cspProblems,
  META_IGNORED_DIRECTIVES,
  metaPolicyProblems,
  POLICY_META_TAGS,
  REFERRER_POLICY,
  SITE_POLICY_HEADERS,
} from "../scripts/security-policy.ts";

describe("security policy", () => {
  it("ADR-0040 QA-30 F-208: CONTENT_SECURITY_POLICY is ADR 0014's policy without frame-ancestors, on one line, with inline styles allowed for Monaco and script-src 'self'", () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://registry.nextflow.io; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  it("ADR-0040 QA-30: the site policy passes cspProblems and metaPolicyProblems", () => {
    expect(cspProblems(CONTENT_SECURITY_POLICY)).toEqual([]);
    expect(metaPolicyProblems(CONTENT_SECURITY_POLICY)).toEqual([]);
  });

  it.each(META_IGNORED_DIRECTIVES)(
    "F-011 QA-30: metaPolicyProblems rejects %s, which a <meta> policy ignores",
    (directive) => {
      const policy = `${CONTENT_SECURITY_POLICY}; ${directive} 'none'`;
      expect(cspProblems(policy)).toEqual([]);
      expect(metaPolicyProblems(policy).join("\n")).toContain(directive);
    },
  );

  it("IO-41 QA-30: connect-src is exactly CONNECT_SRC_ALLOW_LIST", () => {
    expect(CONNECT_SRC_ALLOW_LIST).toEqual(["'self'", ...ALLOWED_ORIGINS]);
    const connect = CONTENT_SECURITY_POLICY.split("; ").find((d) =>
      d.startsWith("connect-src "),
    );
    expect(connect?.split(" ").slice(1)).toEqual([...CONNECT_SRC_ALLOW_LIST]);
  });

  it("F-011 step 2 QA-30: POLICY_META_TAGS are the CSP then the no-referrer policy, and SITE_POLICY_HEADERS carries the same values", () => {
    expect(POLICY_META_TAGS).toEqual([
      {
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: CONTENT_SECURITY_POLICY,
        },
      },
      { attrs: { name: "referrer", content: "no-referrer" } },
    ]);
    expect(REFERRER_POLICY).toBe("no-referrer");
    expect(SITE_POLICY_HEADERS).toEqual({
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "Referrer-Policy": REFERRER_POLICY,
    });
  });

  const base = "default-src 'self'; script-src 'self'; connect-src 'self'";
  it.each([
    [
      "'unsafe-inline'",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    ],
    [
      "'unsafe-eval'",
      "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self'",
    ],
    [
      "'unsafe-hashes'",
      "default-src 'self'; script-src 'self' 'unsafe-hashes'; connect-src 'self'",
    ],
    [
      "a sha256 source",
      "default-src 'self'; script-src 'self' 'sha256-abc='; connect-src 'self'",
    ],
    [
      "a nonce source",
      "default-src 'self'; script-src 'self' 'nonce-abc'; connect-src 'self'",
    ],
    ["a missing script-src", "default-src 'self'; connect-src 'self'"],
    ["a missing connect-src", "default-src 'self'; script-src 'self'"],
    [
      "a connect-src with example.com",
      "default-src 'self'; script-src 'self'; connect-src 'self' https://example.com",
    ],
    [
      "a connect-src of *",
      "default-src 'self'; script-src 'self'; connect-src *",
    ],
    ["a newline", `${base};\nimg-src 'self'`],
    ["a comma", `${base}, img-src 'self'`],
  ])("QA-30: cspProblems rejects %s", (_name, policy) => {
    expect(cspProblems(policy).length).toBeGreaterThan(0);
  });

  const withScriptSource = (directive: string, source: string) =>
    directive === "script-src"
      ? `default-src 'self'; script-src 'self' ${source}; connect-src 'self'`
      : `default-src 'self'; script-src 'self'; ${directive} 'self' ${source}; connect-src 'self'`;
  it.each(
    ["data:", "blob:", "*", "https:", "http:"].flatMap((source) =>
      ["default-src", "script-src", "script-src-elem", "script-src-attr"].map(
        (directive) =>
          [`${source} in ${directive}`, directive, source] as const,
      ),
    ),
  )("QA-30: cspProblems rejects %s", (_name, directive, source) => {
    const problems = cspProblems(withScriptSource(directive, source));
    expect(problems).toContain(`${directive} allows ${source}`);
  });

  it.each([
    ["a host", "style-src 'self' https://fonts.example"],
    ["a data: source", "style-src 'self' data:"],
    ["a nonce", "style-src 'self' 'nonce-abc'"],
    ["a wildcard", "style-src *"],
  ])("QA-30 F-208: cspProblems rejects a style-src with %s", (_name, style) => {
    const policy = `default-src 'self'; script-src 'self'; ${style}; connect-src 'self'`;
    expect(cspProblems(policy).join("\n")).toContain("style-src allows");
  });

  it("QA-30 F-208: cspProblems accepts style-src 'self' 'unsafe-inline'", () => {
    const policy =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'";
    expect(cspProblems(policy)).toEqual([]);
  });

  it.each(["style-src-elem", "style-src-attr"])(
    "QA-30 F-208: cspProblems checks %s as it does style-src",
    (directive) => {
      const base = "default-src 'self'; script-src 'self'; connect-src 'self'";
      for (const source of [
        "https://fonts.example",
        "'nonce-abc'",
        "'sha256-abc'",
        "data:",
        "*",
      ])
        expect(cspProblems(`${base}; ${directive} 'self' ${source}`)).toContain(
          `${directive} allows ${source}`,
        );
      expect(
        cspProblems(`${base}; ${directive} 'self' 'unsafe-inline'`),
      ).toEqual([]);
    },
  );

  it("QA-30 F-208: cspProblems rejects a hash in style-src", () => {
    const policy =
      "default-src 'self'; script-src 'self'; style-src 'self' 'sha256-abc'; connect-src 'self'";
    expect(cspProblems(policy)).toContain("style-src allows 'sha256-abc'");
  });
});
