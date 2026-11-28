import { projectPathProblem } from "@nf-builder/lang-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportMode, zipProject } from "../../src/export/zip-project";
import { readZip } from "../../src/zip/read-zip";
import { centralEntries } from "../fixtures/zip-attrs";

const segment = fc
  .string({
    unit: fc.constantFrom(..."abcxyz09_-.é日本 ".split(""), "😀"),
    minLength: 1,
    maxLength: 6,
  })
  .filter((s) => s !== "." && s !== ".." && s !== "__MACOSX");
const projectPath = fc
  .array(segment, { minLength: 1, maxLength: 3 })
  .map((s) => s.join("/"))
  .filter((p) => projectPathProblem(p) === null);
const text = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constant(""),
  fc.constant("﻿a\r\nb\r\n"),
);

describe("zipProject", () => {
  it("F-404 IO-20: zipProject then readZip gives back every path and text byte for byte, with the folder stripped", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(projectPath, text), {
          selector: ([p]) => p,
          minLength: 1,
          maxLength: 8,
        }),
        (pairs) => {
          const files = pairs.map(([path, t]) => ({ path, text: t }));
          const zip = zipProject(files, { folder: "my-project" });
          const read = readZip(zip);
          if (!read.ok) throw new Error(read.message);
          expect(read.stripped).toBe("my-project");
          const got = new Map(read.candidates.map((c) => [c.path, c.text]));
          expect(got.size).toBe(files.length);
          for (const f of files) expect(got.get(f.path)).toBe(f.text);
        },
      ),
    );
    const zip = zipProject(
      [
        { path: "x", text: "a" },
        { path: "x/y", text: "b" },
      ],
      { folder: "p" },
    );
    const read = readZip(zip);
    if (!read.ok) throw new Error(read.message);
    expect(read.candidates.map((c) => c.path).sort()).toEqual(["x", "x/y"]);
  });

  it("F-404 IO-20 ADR-0057: files under the root bin/ are 0755 and all others 0644, made on Unix", () => {
    expect(exportMode("bin/run.sh")).toBe(0o100755);
    expect(exportMode("modules/x/bin/y")).toBe(0o100644);
    expect(exportMode("main.nf")).toBe(0o100644);
    expect(exportMode("bin")).toBe(0o100644);
    const zip = zipProject(
      [
        { path: "bin/run.sh", text: "#!/bin/sh\n" },
        { path: "modules/x/bin/y", text: "y" },
        { path: "main.nf", text: "" },
        { path: "modules/x/resources/usr/bin/tool", text: "t" },
      ],
      { folder: "p" },
    );
    const modes = Object.fromEntries(
      centralEntries(zip).map((e) => [e.name, [e.os, e.mode]]),
    );
    expect(modes).toEqual({
      "p/bin/run.sh": [3, 0o100755],
      "p/modules/x/bin/y": [3, 0o100644],
      "p/main.nf": [3, 0o100644],
      "p/modules/x/resources/usr/bin/tool": [3, 0o100755],
    });
  });

  it("F-404 IO-20: names are UTF-8 flagged when not ASCII, there are no folder entries, and every entry sits under the folder", () => {
    const zip = zipProject(
      [
        { path: "a/b.nf", text: "1" },
        { path: "日本/c.nf", text: "2" },
      ],
      { folder: "p" },
    );
    const entries = centralEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(["p/a/b.nf", "p/日本/c.nf"]);
    expect(entries.map((e) => e.utf8)).toEqual([false, true]);
    expect(entries.every((e) => !e.name.endsWith("/"))).toBe(true);
  });
});
