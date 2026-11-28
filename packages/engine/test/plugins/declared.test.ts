import type { ConfigSourceFile } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { declaredPlugins } from "../../src/plugins/declared";
import { createSourceFile } from "../../src/source/source-file";
import { parser } from "../config/helpers";

const config = async (text: string) =>
  createSourceFile("nextflow.config", text, await parser()) as ConfigSourceFile;

describe("declaredPlugins", () => {
  it("F-505 IO-33: declaredPlugins lists top-level plugins ids with and without versions, in order", async () => {
    const file = await config(
      [
        "plugins {",
        "  id 'nf-schema@3.1.0'",
        "  id 'nf-prov'",
        "  id params.x",
        "  id 42",
        "}",
        "profiles {",
        "  test {",
        "    plugins {",
        "      id 'nf-hidden@1.0.0'",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    expect(declaredPlugins(file).map((p) => [p.id, p.version])).toEqual([
      ["nf-schema", "3.1.0"],
      ["nf-prov", null],
    ]);
    expect(declaredPlugins(file)[0]?.range.line).toBe(2);
  });

  it("F-505 IO-33: a config without a plugins block, or one that did not parse, declares nothing", async () => {
    expect(declaredPlugins(await config("process.cpus = 2\n"))).toEqual([]);
  });
});
