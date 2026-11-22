import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import { renderConfigAst, snapshotPath } from "./config-snapshot.ts";

describe("F-103 step 1: the statement-level snapshot format", () => {
  it("F-103 step 1: the snapshot has one line per config statement and comment, with value kinds and ranges, and no comment text", () => {
    const text = [
      "// head",
      "params.x = 'a'",
      "process {",
      "    // inside",
      "    withName: 'FOO' { cpus = 2 } // after",
      "}",
      "includeConfig 'conf/base.config'",
      "plugins { id 'nf-schema' }",
      "def y = 1",
      "",
    ].join("\n");
    const result = parseConfigAst(text);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(renderConfigAst(result.ast, result.errors)).toBe(
      [
        "ConfigFile 1:1-10:1",
        "  #line 1:1-1:8",
        "  ConfigAssign params.x = String 2:1-2:15",
        "  ConfigBlock process 3:1-6:2",
        "    #line 4:5-4:14",
        "    ConfigSelector withName: 'FOO' 5:5-5:33",
        "      ConfigAssign cpus = Number 5:23-5:31",
        "    #line 5:34-5:42",
        '  ConfigInclude String "conf/base.config" 7:1-7:33',
        "  ConfigApplyBlock plugins 8:1-8:27",
        "    ConfigApply id (1 arguments) 8:11-8:25",
        "  ConfigInvalid VariableDeclaration 9:1-9:10",
        "!error 9:1-9:10 Variable declarations cannot be mixed with config statements",
        "",
      ].join("\n"),
    );
  });

  it("F-103 step 1: snapshotPath maps a corpus file to snapshots/config/<id>/<path>.ast", () => {
    expect(snapshotPath("rnaseq", "conf/modules/align.config")).toBe(
      "snapshots/config/rnaseq/conf/modules/align.config.ast",
    );
  });
});
