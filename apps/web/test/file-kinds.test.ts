import { languageOf } from "@nf-builder/engine";
import { describe, expect, it } from "vitest";
import {
  editorLanguageOf,
  fileEditorOf,
  LANGUAGE_NAMES,
  openTargetOf,
} from "../src/files/file-kinds";

describe("F-605 file kinds", () => {
  it("F-605 FI-32: editorLanguageOf picks the language from the extension, and unknown files are plain text", () => {
    const cases: [string, string][] = [
      ["main.nf", "nextflow"],
      ["nextflow.config", "nextflow"],
      ["nf-test.config", "groovy"],
      ["tests/main.nf.test", "groovy"],
      ["Helper.GROOVY", "groovy"],
      ["package.json", "json"],
      ["tests/main.nf.test.snap", "json"],
      ["conf/params.yml", "yaml"],
      ["a.YAML", "yaml"],
      ["CITATION.cff", "yaml"],
      ["README.md", "markdown"],
      ["x.markdown", "markdown"],
      ["bin/run.sh", "shellscript"],
      ["x.bash", "shellscript"],
      ["bin/x.py", "python"],
      ["x.R", "r"],
      ["x.toml", "toml"],
      ["x.ini", "ini"],
      ["x.cfg", "ini"],
      ["samples.csv", "csv"],
      ["samples.tsv", "tsv"],
      ["a.diff", "diff"],
      ["a.patch", "diff"],
      ["map.mmd", "mermaid"],
      ["email.html", "plaintext"],
      ["logo.svg", "plaintext"],
      ["a.xml", "plaintext"],
      ["notes.txt", "plaintext"],
      ["LICENSE", "plaintext"],
      [".gitignore", "plaintext"],
    ];
    for (const [path, language] of cases) {
      expect(editorLanguageOf(path), path).toBe(language);
    }
    expect(LANGUAGE_NAMES.plaintext).toBe("Plain text");
    expect(LANGUAGE_NAMES.yaml).toBe("YAML");
  });

  it("F-605 FI-30 AR-01: a file opens in the Markdown editor exactly when languageOf says markdown", () => {
    for (const path of [
      "README.md",
      "x.markdown",
      "README.MD",
      "a.nf",
      "a.txt",
    ]) {
      expect(fileEditorOf(path) === "markdown", path).toBe(
        languageOf(path) === "markdown",
      );
    }
    expect(fileEditorOf("README.md")).toBe("markdown");
    expect(fileEditorOf("x.markdown")).toBe("markdown");
    expect(fileEditorOf("README.MD")).toBe("code");
  });

  it("F-605 FI-31 UX-52: openTargetOf sends a file with workflows to its entry workflow, else its first, and every other file to a file tab", () => {
    const ref = (path: string, name: string | null) => ({ path, name });
    const workflows = [
      ref("main.nf", null),
      ref("a.nf", "ONE"),
      ref("a.nf", null),
      ref("b.nf", "TWO"),
      ref("b.nf", "THREE"),
    ] as never;
    expect(openTargetOf("a.nf", workflows)).toEqual({
      kind: "workflow",
      ref: ref("a.nf", null),
    });
    expect(openTargetOf("b.nf", workflows)).toEqual({
      kind: "workflow",
      ref: ref("b.nf", "TWO"),
    });
    expect(openTargetOf("lib/samples.nf", workflows)).toEqual({ kind: "file" });
    expect(openTargetOf("README.md", workflows)).toEqual({ kind: "file" });
  });
});
