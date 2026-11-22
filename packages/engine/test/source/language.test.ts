import { describe, expect, it } from "vitest";
import { languageOf } from "../../src/source/language";

describe("F-104 AR-01: languageOf", () => {
  it("F-104 AR-01: languageOf maps paths to the AR-01 languages", () => {
    const cases: [string, string][] = [
      ["main.nf", "nextflow"],
      ["modules/x/main.nf", "nextflow"],
      ["nextflow.config", "config"],
      ["conf/base.config", "config"],
      ["nf-test.config", "text"],
      ["tests/nf-test.config", "text"],
      ["main.nf.test", "text"],
      ["data.json", "json"],
      ["a/b/meta.yml", "yaml"],
      ["a.yaml", "yaml"],
      ["README.md", "markdown"],
      ["notes.markdown", "markdown"],
      ["LICENSE", "text"],
      ["Dockerfile", "text"],
      ["MAIN.NF", "text"],
      ["x.Config", "text"],
    ];
    for (const [path, language] of cases)
      expect(languageOf(path), path).toBe(language);
  });
});
