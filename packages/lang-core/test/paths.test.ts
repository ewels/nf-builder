import { describe, expect, it } from "vitest";
import { exportClashes, PATH_MAX, projectPathProblem } from "../src/paths";

describe("project paths", () => {
  it("F-210 UX-16 QA-32: projectPathProblem accepts relative POSIX paths and names the problem for an empty path, a leading slash, a drive letter, control characters, empty, ., .. and __proto__ segments and paths over 1,024 characters", () => {
    for (const ok of ["a.nf", "a/b/main.nf", "modules/local/x/.gitkeep"])
      expect(projectPathProblem(ok), ok).toBeNull();
    expect(projectPathProblem("")).toBe("empty path");
    expect(projectPathProblem("a".repeat(PATH_MAX + 1))).toBe("path too long");
    expect(projectPathProblem("a".repeat(PATH_MAX))).toBeNull();
    expect(projectPathProblem("/etc/passwd")).toBe("absolute path");
    expect(projectPathProblem("C:/x.nf")).toBe("drive letter");
    expect(projectPathProblem("a/\u0000b")).toBe("control character");
    expect(projectPathProblem("a/\u007fb")).toBe("control character");
    expect(projectPathProblem("a//b")).toBe("empty segment");
    expect(projectPathProblem("a/")).toBe("empty segment");
    expect(projectPathProblem("./a")).toBe(". segment");
    expect(projectPathProblem("a/../b")).toBe(".. segment");
    expect(projectPathProblem("a/__proto__/b")).toBe("reserved segment");
  });
});

describe("export clashes", () => {
  it("F-404 ADR-0055: exportClashes groups paths that differ only by case and lists files that are also folders", () => {
    expect(exportClashes(["main.nf", "modules/a.nf", "a/b.nf"])).toEqual({
      caseOnly: [],
      fileAndFolder: [],
    });
    expect(
      exportClashes(["README.md", "readme.md", "Readme.md", "other.md"]),
    ).toEqual({
      caseOnly: [["README.md", "Readme.md", "readme.md"]],
      fileAndFolder: [],
    });
    expect(exportClashes(["x", "x/y", "z/w", "z/w/v"])).toEqual({
      caseOnly: [],
      fileAndFolder: ["x", "z/w"],
    });
  });
});
