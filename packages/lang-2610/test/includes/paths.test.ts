import { describe, expect, it } from "vitest";
import { dirname, joinPath, resolvePath } from "../../src/includes/paths.ts";

describe("include paths", () => {
  it("F-105 AR-03: include paths resolve and normalise as java.nio Path.resolve().normalize()", () => {
    expect(resolvePath("a/b", "./c")).toBe("a/b/c");
    expect(resolvePath("a/b", "../c")).toBe("a/c");
    expect(resolvePath("a/b", "../../c.nf")).toBe("c.nf");
    expect(resolvePath("a//b/", "c//d/")).toBe("a/b/c/d");
    expect(resolvePath("", "./x/./y")).toBe("x/y");
    expect(resolvePath("", "")).toBe("");
    // `..` above the project root is kept (the path is then outside the project)
    expect(resolvePath("", "../outside/d.nf")).toBe("../outside/d.nf");
    expect(resolvePath("a", "../../../x")).toBe("../../x");
    expect(resolvePath("a", "../../x/../../y")).toBe("../../y");
    // absolute sources stay absolute and ignore the including directory
    expect(resolvePath("a/b", "/etc/x.nf")).toBe("/etc/x.nf");
    expect(resolvePath("a/b", "/etc/../x.nf")).toBe("/x.nf");
    expect(resolvePath("a/b", "/../x.nf")).toBe("/x.nf");
    expect(resolvePath("/abs/dir", "./y")).toBe("/abs/dir/y");
  });

  it("F-105 AR-03: dirname and joinPath work on project-relative POSIX paths", () => {
    expect(dirname("main.nf")).toBe("");
    expect(dirname("a/main.nf")).toBe("a");
    expect(dirname("a/b/c.nf")).toBe("a/b");
    expect(dirname("/x")).toBe("/");
    expect(joinPath("", "modules", "nf-core/fastqc", "main.nf")).toBe(
      "modules/nf-core/fastqc/main.nf",
    );
    expect(joinPath("modules/local/x", "modules", "a/b")).toBe(
      "modules/local/x/modules/a/b",
    );
    expect(joinPath("a", "..", "b")).toBe("b");
  });
});
