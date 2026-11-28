import { describe, expect, it } from "vitest";
import { workflowSummary } from "../../src/details/summary";
import { modelledShare } from "../../src/projection/coverage";
import { FOO, projectMain } from "../projection/legacy/util";

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

describe("F-405 modelled share in the summary", () => {
  it("F-405 ADR-0004: workflowSummary reports the statements and the modelled ones from projectionCoverage", async () => {
    const p = await projectMain(SOURCE);
    expect(workflowSummary(p).coverage).toEqual({
      statements: 7,
      modelled: 5,
      percent: 71,
    });
  });

  it("F-405 ADR-0004: the percentage rounds down, so only a fully modelled workflow shows 100", () => {
    expect(modelledShare({ statements: 200, modelled: 199 }).percent).toBe(99);
    expect(modelledShare({ statements: 3, modelled: 3 }).percent).toBe(100);
    expect(modelledShare({ statements: 16, modelled: 0 }).percent).toBe(0);
  });

  it("F-405 ADR-0004: a workflow with no statements has no percentage", () => {
    expect(modelledShare({ statements: 0, modelled: 0 })).toEqual({
      statements: 0,
      modelled: 0,
      percent: null,
    });
  });
});
