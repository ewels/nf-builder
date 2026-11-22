import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatDir, parseFormatJson } from "../src/lint.ts";

const temp = () => mkdtempSync(join(tmpdir(), "corpus-format-"));
const report = (filesFormatted: number, errors = 0) =>
  JSON.stringify({
    summary: {
      errors,
      filesWithErrors: errors > 0 ? 1 : 0,
      filesWithoutErrors: 2,
      filesFormatted,
    },
    errors: Array.from({ length: errors }, () => ({
      filename: "bad.nf",
      startLine: 1,
      startColumn: 2,
      message: "X is not defined",
    })),
  });

function fakeLauncher(dir: string, script: string): string {
  const file = join(dir, "fake-nextflow");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("corpus format", () => {
  it("F-110 ADR-0005: parseFormatJson reads the lint summary, the errors and the number of files formatted", () => {
    expect(parseFormatJson(report(3, 1))).toEqual({
      filesChecked: 3,
      filesFormatted: 3,
      errors: [
        {
          filename: "bad.nf",
          startLine: 1,
          startColumn: 2,
          message: "X is not defined",
        },
      ],
    });
    expect(() =>
      parseFormatJson(
        JSON.stringify({
          summary: { filesWithErrors: 0, filesWithoutErrors: 1 },
          errors: [],
        }),
      ),
    ).toThrow(/filesFormatted/);
  });

  it("F-110 ADR-0005: formatDir formats a copy of the pipeline without .git, and leaves the pipeline as it was", () => {
    const source = temp();
    mkdirSync(join(source, ".git"));
    writeFileSync(join(source, ".git", "HEAD"), "ref");
    mkdirSync(join(source, "modules"));
    writeFileSync(join(source, "main.nf"), "a  =  1\n");
    writeFileSync(join(source, "modules", "m.nf"), "b = 2\n");
    const out = join(temp(), "formatted");
    // formats main.nf in place like Nextflow, in the directory it runs in
    const launcher = fakeLauncher(
      temp(),
      `printf 'a = 1\\n' > main.nf\ncat <<'EOF'\n${report(1)}\nEOF`,
    );
    const result = formatDir(launcher, source, out);
    expect(result.filesFormatted).toBe(1);
    expect(readFileSync(join(out, "main.nf"), "utf8")).toBe("a = 1\n");
    expect(readFileSync(join(out, "modules", "m.nf"), "utf8")).toBe("b = 2\n");
    expect(existsSync(join(out, ".git"))).toBe(false);
    expect(readFileSync(join(source, "main.nf"), "utf8")).toBe("a  =  1\n");
  });

  it("F-110: a lint -format run that fails shows the stderr tail", () => {
    const source = temp();
    writeFileSync(join(source, "main.nf"), "a = 1\n");
    const launcher = fakeLauncher(temp(), 'echo "boom: no java" >&2; exit 3');
    expect(() => formatDir(launcher, source, join(temp(), "out"))).toThrow(
      /boom: no java/,
    );
    const exitOne = fakeLauncher(
      temp(),
      `cat <<'EOF'\n${report(0, 2)}\nEOF\nexit 1`,
    );
    expect(formatDir(exitOne, source, join(temp(), "out")).errors).toHaveLength(
      2,
    );
  });
});
