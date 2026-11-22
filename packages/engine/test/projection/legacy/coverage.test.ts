import { describe, expect, it } from "vitest";
import { projectionCoverage } from "../../../src/projection/coverage";
import { FOO, projectMain } from "./util";

const SOURCE = `${FOO}
workflow {
    ch = channel.of(1)
    FOO(ch)
    def x
    y = ch
    log.info 'a'
    z = helper()
    FOO.out.a.view()
}
`;

describe("F-107 step 2 ADR-0004 coverage", () => {
  it("F-107 step 2 ADR-0004: every projected statement is listed once, with nodes, a binding or one code node", async () => {
    const p = await projectMain(SOURCE);
    expect(p.statements.map((s) => s.range.line)).toEqual([
      14, 15, 16, 17, 18, 19, 20,
    ]);
    for (const s of p.statements) {
      const codes = s.nodes.filter(
        (id) => p.nodes.find((n) => n.id === id)?.kind === "code",
      );
      expect(
        s.nodes.length + s.binds.length,
        `line ${s.range.line}`,
      ).toBeGreaterThan(0);
      expect(s.modelled).toBe(codes.length === 0);
      expect(codes.length).toBeLessThanOrEqual(1);
      expect(s.guards).toEqual([]);
    }
    expect(p.statements.map((s) => s.modelled)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it("F-107 step 2: projectionCoverage counts the statements and the modelled ones", async () => {
    const p = await projectMain(SOURCE);
    expect(projectionCoverage(p)).toEqual({ statements: 7, modelled: 5 });
  });

  it("F-107 step 2: a multi-output code node records every name it writes in the statement's binds", async () => {
    const p = await projectMain(`workflow {
    def (a, b) = ['x', 'y']
    c = 1
}
`);
    expect(p.statements.map((s) => [s.binds, s.modelled])).toEqual([
      [["a", "b"], false],
      [["c"], false],
    ]);
  });
});
