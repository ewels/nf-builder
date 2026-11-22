import type { SourceParser } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { installedPackVersions } from "../../src/packs";
import { loadParser } from "../../src/source/parser";
import { printSourceFile } from "../../src/source/print";
import { createSourceFile } from "../../src/source/source-file";

let parser: SourceParser;
beforeAll(async () => {
  parser = await loadParser(installedPackVersions()[0] as string);
});

describe("F-104 IO-20 ADR-0004: printSourceFile", () => {
  it("F-104 IO-20 ADR-0004: an unedited file prints back byte for byte whatever its status", () => {
    const good =
      "// c\nprocess A {\n  script:\n  'x'\n}  // t\n\n\nworkflow {\n  A()\n}\n";
    const bad = "process B {\n  script:\n  def a = = 1\n  'x'\n}\n";
    const cases: [string, string, string][] = [
      ["main.nf", good, "modelled"],
      ["main.nf", (good + bad).replaceAll("\n", "\r\n"), "partial"],
      ["main.nf", `${good}${bad}`, "partial"],
      ["main.nf", bad, "verbatim"],
      ["main.nf", `/* open\n${good}`, "verbatim"],
      [
        "nextflow.config",
        "docker.enabled = true   \r\n\r\nprocess { cpus = 1 }\n",
        "modelled",
      ],
      ["nextflow.config", "a = 1\nprocess {\n  cpus =\n}\nb = 2\n", "partial"],
      ["data.json", '{ "a":  1 }  \r\n', "plain"],
      ["empty.nf", "", "modelled"],
    ];
    for (const [path, text, status] of cases) {
      const f = createSourceFile(path, text, parser);
      expect(f.status, `${path} ${JSON.stringify(text)}`).toBe(status);
      expect(printSourceFile(f)).toBe(text);
    }
  });
});
