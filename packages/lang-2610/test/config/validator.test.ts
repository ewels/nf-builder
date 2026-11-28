// F-601 FI-03: the walk and the classifier mirror Nextflow 26.10.7's run-time ConfigValidator.
import { describe, expect, it } from "vitest";
import { parseConfigAst } from "../../src/ast/index.ts";
import { configCatalogue } from "../../src/catalogue.ts";
import { classifyPath, optionPaths } from "../../src/config/validator.ts";

const kind = (...names: string[]) => classifyPath(configCatalogue, names).kind;

describe("config validator", () => {
  it("F-601 FI-03: classifyPath follows ConfigValidator 26.10.7", () => {
    expect(kind("process", "memory")).toBe("option");
    expect(kind("process", "memmory")).toBe("unknown");
    expect(kind("params", "x")).toBe("free");
    expect(kind("env", "X")).toBe("free");
    expect(kind("process", "ext", "args")).toBe("free");
    expect(kind("process", "resourceLimits", "cpus")).toBe("free");
    expect(kind("cleanup")).toBe("option");
    expect(kind("poolSize")).toBe("hidden");
    expect(kind("cloudcache", "path")).toBe("unchecked");
    expect(kind("wave", "enabled")).toBe("option");
    expect(kind("aws", "region")).toBe("option");
    expect(kind("mystery", "level")).toBe("unknown");
    expect(kind("plugins")).toBe("dsl");
    expect(kind("process")).toBe("scope");
    expect(kind("executor", "retry", "delay")).toBe("option");
    expect(classifyPath(configCatalogue, ["process", "memory"])).toMatchObject({
      kind: "option",
      types: ["MemoryUnit"],
    });
    expect(classifyPath(configCatalogue, ["env", "X"])).toEqual({
      kind: "free",
      owner: "env",
    });
    expect(classifyPath(configCatalogue, ["process", "ext", "args"])).toEqual({
      kind: "free",
      owner: "map",
    });
  });

  const paths = (text: string) => {
    const parsed = parseConfigAst(text);
    if (!parsed.ok) throw new Error("parse failed");
    return [...optionPaths(parsed.ast)].map((p) => p.names.join("."));
  };

  it("F-601 FI-03: optionPaths drops withLabel and withName selectors and executor.$name, and treats a profile's content as top level", () => {
    expect(
      paths(
        [
          "process {",
          "    cpus = 1",
          "    withLabel: big_mem { memory = 8.GB }",
          "    withName: 'A|B' { ext.args = 'x' }",
          "}",
          "executor {",
          "    '$sge' { queueSize = 10 }",
          "    name = 'local'",
          "}",
          "profiles {",
          "    test {",
          "        process.cpus = 2",
          "        docker.enabled = true",
          "    }",
          "}",
          "docker.enabled = true",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      "process.cpus",
      "process.memory",
      "process.ext.args",
      "executor.queueSize",
      "executor.name",
      "process.cpus",
      "docker.enabled",
      "docker.enabled",
    ]);
  });

  it("F-601 FI-03: optionPaths keeps an unknown selector kind as a path segment and gives each option's name range", () => {
    const text = "process {\n    withFoo: x { cpus = 1 }\n}\n";
    const parsed = parseConfigAst(text);
    if (!parsed.ok) throw new Error("parse failed");
    const [first] = [...optionPaths(parsed.ast)];
    expect(first?.names).toEqual(["process", "withFoo:x", "cpus"]);
    expect(first?.range.line).toBe(2);
    expect(first?.range.column).toBe(18);
  });
});
