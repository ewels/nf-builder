import { describe, expect, it } from "vitest";
import {
  githubAnnotation,
  REPO_ROOT,
  reportProblems,
} from "../scripts/check-common.ts";

function run(
  problems: Parameters<typeof reportProblems>[1],
  env: Record<string, string>,
) {
  const lines: string[] = [];
  const ok = reportProblems("ADR lint", problems, {
    env,
    write: (line) => lines.push(line),
  });
  return { ok, lines };
}

describe("check-common", () => {
  it("F-003 step 2: problems print as file:line: message, plus ::error annotations under GitHub Actions", () => {
    const problem = {
      file: `${REPO_ROOT}docs/adr/x.md`,
      line: 3,
      message: "msg",
    };
    const plain = run([problem], {});
    expect(plain.ok).toBe(false);
    expect(plain.lines).toContain("docs/adr/x.md:3: msg");
    expect(plain.lines.some((l) => l.startsWith("::error"))).toBe(false);

    const ci = run([problem], { GITHUB_ACTIONS: "true" });
    expect(ci.lines).toContain(
      "::error file=docs/adr/x.md,line=3,title=ADR lint::msg",
    );
    expect(run([], {}).ok).toBe(true);
  });

  it("F-003: problems with a known column print as file:line:column: message", () => {
    const { lines } = run(
      [{ file: `${REPO_ROOT}a.js`, line: 2, column: 7, message: "msg" }],
      {},
    );
    expect(lines).toContain("a.js:2:7: msg");
  });

  it("F-003: annotations escape %, newlines, colons and commas", () => {
    const line = githubAnnotation({ message: "100%\nnext" }, "a:b,c");
    expect(line).toBe("::error title=a%3Ab%2Cc::100%25%0Anext");
  });
});
