// F-112 step 9 (AR-05, LA-30 to LA-34, IO-14): the diagnoser over every pinned corpus pipeline. `nextflow lint` reports no
// error on any pin, so neither do we; each lint-origin code equals lint's matching errors and warnings by file, line,
// column and message start; counts per code go to .cache/reports/diagnostics-corpus.md (its own file, as edit-corpus.md:
// parse.corpus.ts rewrites parse-corpus.md). Run by `pnpm test:corpus` after `pnpm corpus:fetch` and `pnpm corpus:lint`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic, PackLints } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import { diagnoseFiles } from "../diagnostics/open";
import { readTree } from "../model/read-tree";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const LINT = join(ROOT, ".cache/corpus-lint");
const REPORTS = join(ROOT, ".cache/reports");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

interface Entry {
  filename: string;
  startLine: number;
  startColumn: number;
  message: string;
}
interface Pin {
  id: string;
  diagnostics: readonly Diagnostic[];
  errors: Entry[];
  warnings: Entry[];
  ms: number;
}
const pins: Pin[] = [];
let lints: PackLints;

beforeAll(async () => {
  for (const id of IDS) {
    const lintFile = join(LINT, `${id}.json`);
    if (!existsSync(join(CORPUS, id)) || !existsSync(lintFile))
      throw new Error(
        `pin ${id} is not fetched or linted (run pnpm corpus:fetch && pnpm corpus:lint)`,
      );
    const recorded = JSON.parse(readFileSync(lintFile, "utf8")) as {
      errors: Entry[];
      warnings?: Entry[];
    };
    if (!recorded.warnings)
      throw new Error(
        `${id}: the lint cache has no warnings (re-run pnpm corpus:lint)`,
      );
    const started = Date.now();
    const opened = await diagnoseFiles(readTree(join(CORPUS, id)));
    lints = opened.lints;
    const diagnostics = opened.diagnoser.all();
    pins.push({
      id,
      diagnostics,
      errors: recorded.errors,
      warnings: recorded.warnings,
      ms: Date.now() - started,
    });
  }
}, 600_000);

const key = (path: string, line: number, column: number) =>
  `${path}:${line}:${column}`;

describe("F-112 corpus diagnostics", () => {
  it("F-112 LA-30 LA-31 LA-32 LA-33 ADR-0011: no pinned pipeline gets an error diagnostic, as nextflow lint reports none", () => {
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) {
      expect(pin.errors, `${pin.id}: lint errors`).toEqual([]);
      expect(
        pin.diagnostics
          .filter((d) => d.severity === "error")
          .map(
            (d) =>
              `${key(d.path, d.range.line, d.range.column)} ${d.code}: ${d.message}`,
          ),
        pin.id,
      ).toEqual([]);
    }
  });

  it("F-112 ADR-0005: on every pinned pipeline the lint-origin diagnostics equal nextflow lint's errors and warnings", () => {
    const patterns = lints.codes.filter(
      (c) => c.origin === "lint" && c.lintPattern,
    );
    expect(patterns.length).toBeGreaterThan(0);
    for (const pin of pins) {
      const theirs = [...pin.errors, ...pin.warnings].filter((e) =>
        patterns.some((c) => (c.lintPattern as RegExp).test(e.message)),
      );
      const ours = pin.diagnostics.filter((d) =>
        patterns.some((c) => c.code === d.code),
      );
      expect(
        ours.map((d) => key(d.path, d.range.line, d.range.column)).sort(),
        pin.id,
      ).toEqual(
        theirs.map((e) => key(e.filename, e.startLine, e.startColumn)).sort(),
      );
      const messages = new Map(
        theirs.map((e) => [
          key(e.filename, e.startLine, e.startColumn),
          e.message,
        ]),
      );
      for (const d of ours) {
        const lint = messages.get(key(d.path, d.range.line, d.range.column));
        expect(
          d.message.startsWith(lint ?? "\0"),
          `${pin.id}: ${d.message}`,
        ).toBe(true);
      }
    }
  });

  it("F-112 IO-14: diagnosing every pin never throws, and the counts per code are reported", () => {
    const codes = lints.codes.map((c) => c.code);
    const counts = (pin: Pin) =>
      codes.map((c) => pin.diagnostics.filter((d) => d.code === c).length);
    const lines = [
      "# Diagnostics (F-112)",
      "",
      `| code | ${pins.map((p) => p.id).join(" | ")} |`,
      `|---|${pins.map(() => "---|").join("")}`,
    ];
    codes.forEach((code, i) => {
      if (pins.some((p) => counts(p)[i] !== 0))
        lines.push(
          `| ${code} | ${pins.map((p) => counts(p)[i]).join(" | ")} |`,
        );
    });
    lines.push(`| time (ms) | ${pins.map((p) => p.ms).join(" | ")} |`, "");
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, "diagnostics-corpus.md"), lines.join("\n"));
    for (const pin of pins)
      expect(
        pin.diagnostics.filter((d) => d.code === "internal"),
        `${pin.id}: internal diagnostics`,
      ).toEqual([]);
  });
});
