import { readFileSync } from "node:fs";
import type { Diagnostic } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { loadLints } from "../../src/diagnostics/lints";
import { applyTextEdits } from "../../src/diagnostics/text-edits";
import { readTree } from "../model/read-tree";
import { diagnoseTree, FIXTURES, fixtureDirs } from "./open";

// The harness is driven by the pack's registry: a code added there is tested here against its fixtures.
const lints = await loadLints("26.10");
const codes = lints.codes.filter((c) => c.origin !== "internal");
const dirs = fixtureDirs();

type Located = { line: number; column: number; message: string };
const manifest = new Map(
  (
    JSON.parse(readFileSync(`${FIXTURES}/../fixtures.json`, "utf8")) as {
      fixtures: { file: string; lint: Located[]; warnings: Located[] }[];
    }
  ).fixtures.map((f) => [f.file, f]),
);
/** What `nextflow lint` recorded for the files of one fixture tree. */
const recorded = (code: string, kind: string, key: "lint" | "warnings") =>
  [...manifest]
    .filter(([file]) => file.startsWith(`${code}/${kind}/`))
    .flatMap(([file, f]) =>
      f[key].map((e) => ({
        ...e,
        path: file.slice(`${code}/${kind}/`.length),
      })),
    );

const diagnosed = new Map<string, Promise<readonly Diagnostic[]>>();
const diagnose = (dir: string) => {
  let list = diagnosed.get(dir);
  if (!list) {
    list = diagnoseTree(dir).then((r) => r.diagnoser.all());
    diagnosed.set(dir, list);
  }
  return list;
};
const treeOf = (code: string, kind: string) =>
  dirs.find((d) => d.code === code && d.kind === kind)?.dir;

/** How a code's diagnostics are compared with lint's errors: which lint messages count, and where our message may differ (paths). */
const PARITY: Record<
  string,
  { lint: RegExp; cut: string | null; key?: "lint" | "warnings" }
> = {
  syntax: { lint: /./, cut: null },
  "include-target": { lint: /^Invalid include source/, cut: "'" },
  "include-not-parsed": { lint: /^Module could not be parsed/, cut: "'" },
  "include-name": { lint: /^Included name/, cut: " in module" },
  // warnings that `nextflow lint` prints
  "deprecated-when": {
    lint: /^The `when` section is deprecated/,
    cut: null,
    key: "warnings",
  },
  "deprecated-shell": {
    lint: /^The `shell` block is deprecated/,
    cut: null,
    key: "warnings",
  },
  "deprecated-channel": {
    lint: /^The use of `Channel` to access channel factories/,
    cut: null,
    key: "warnings",
  },
  "implicit-it": {
    lint: /^Implicit closure parameter is deprecated/,
    cut: null,
    key: "warnings",
  },
  "missing-type": {
    lint: /should have a type annotation$/,
    cut: null,
    key: "warnings",
  },
  "typed-process-outputs": {
    lint: /^Typed process should have only one output/,
    cut: null,
    key: "warnings",
  },
  "publish-type-ignored": {
    lint: /^Workflow output type should be declared/,
    cut: null,
    key: "warnings",
  },
  // errors
  "feature-flag": { lint: /^Unrecognized feature flag/, cut: null },
  "pipeline-include-types": {
    lint: /^Including a pipeline requires/,
    cut: null,
  },
  "config-include-placement": {
    lint: /^Config includes are only allowed/,
    cut: null,
  },
  "agent-output": {
    lint: /^(Agent output `|`(eval|env)` is not defined)/,
    cut: null,
  },
  "include-alias": {
    lint: /^(An included pipeline must be aliased|Included types cannot be aliased)/,
    cut: null,
  },
  "duplicate-name": { lint: /is already (included|declared)$/, cut: null },
  "call-arity": {
    lint: /^(Incorrect number of call arguments|(Process|Agent|Workflow) `[^`]+` expects)/,
    cut: null,
  },
  "type-mismatch": {
    lint: /^(Argument with type .+ is not compatible with (process input|agent input|parameter)|(Workflow emit|Workflow output|Assignment target).+ cannot be assigned to value)/,
    cut: null,
  },
  "multiple-channels": {
    lint: /was called with multiple channel arguments/,
    cut: null,
  },
};
const VERBS = new Set([
  "add",
  "check",
  "connect",
  "correct",
  "create",
  "define",
  "enable",
  "fix",
  "give",
  "keep",
  "make",
  "migrate",
  "move",
  "pass",
  "publish",
  "remove",
  "rename",
  "rewrite",
  "set",
  "start",
  "use",
  "write",
  "finish",
  "it",
  "edit",
  "change",
  "declare",
  "turn",
]);

describe("F-112 fixtures", () => {
  it("F-112 step 1: every fixture directory is a registry code, so no fixture is left untested", () => {
    const known = new Set(lints.codes.map((c) => c.code));
    const unregistered = [...new Set(dirs.map((d) => d.code))].filter(
      (c) => !known.has(c),
    );
    expect(unregistered).toEqual([]);
  });

  for (const { code, severity, fixable, spec } of codes) {
    const label = `${code}`;
    it(`F-112 step 1: ${label} has a positive and a negative fixture`, () => {
      expect(treeOf(code, "positive"), "positive").toBeDefined();
      expect(treeOf(code, "negative"), "negative").toBeDefined();
      expect(
        treeOf(code, "fixed") !== undefined,
        "fixed only when fixable",
      ).toBe(fixable);
    });

    it(`F-112 step 1 ${spec.join(" ")}: ${label} fires on its positive fixture and not on its negative`, async () => {
      const positive = (
        await diagnose(treeOf(code, "positive") as string)
      ).filter((d) => d.code === code);
      const negative = (
        await diagnose(treeOf(code, "negative") as string)
      ).filter((d) => d.code === code);
      expect(positive.length).toBeGreaterThanOrEqual(1);
      expect(negative).toEqual([]);
      for (const d of positive) expect(d.severity).toBe(severity);
    });

    it(`F-112 step 1 ADR-0005: ${label} matches nextflow lint on the fixtures`, async () => {
      const ours = (await diagnose(treeOf(code, "positive") as string)).filter(
        (d) => d.code === code,
      );
      const parity = PARITY[code];
      if (!parity) return; // an own or paranoid code: lint has no counterpart
      const cut = (m: string): string =>
        parity.cut ? (m.split(parity.cut)[0] ?? m) : m;
      const theirs = recorded(code, "positive", parity.key ?? "lint").filter(
        (e) => parity.lint.test(e.message),
      );
      expect(
        ours.map((d) => `${d.path}:${d.range.line}:${d.range.column}`),
      ).toEqual(theirs.map((e) => `${e.path}:${e.line}:${e.column}`));
      ours.forEach((d, i) => {
        const t = theirs[i];
        // ours is lint's wording, then advice
        expect(
          cut(d.message).startsWith(cut(t?.message ?? "")),
          d.message,
        ).toBe(true);
      });
    });

    it(`F-112 ADR-0005: ${label}'s severity matches the oracle`, () => {
      const errors = recorded(code, "positive", "lint");
      const warnings = recorded(code, "positive", "warnings");
      if (severity === "error") expect(errors.length).toBeGreaterThan(0);
      else expect(errors).toEqual([]);
      if (severity === "suggestion") expect(warnings).toEqual([]);
      for (const kind of ["negative", "fixed"])
        expect(recorded(code, kind, "lint"), kind).toEqual([]);
    });

    it(`F-112 step 2: every ${label} message states what to do`, async () => {
      const ours = (await diagnose(treeOf(code, "positive") as string)).filter(
        (d) => d.code === code,
      );
      const verbatim = lints.codes.find((c) => c.code === code)?.verbatim ?? [];
      for (const d of ours) {
        if (verbatim.some((p) => p.test(d.message))) continue;
        const clause = d.message.split(" -- ")[1];
        expect(clause, d.message).toBeDefined();
        expect(
          VERBS.has((clause as string).split(" ")[0] as string),
          d.message,
        ).toBe(true);
      }
    });

    if (fixable)
      it(`F-112 step 2 AR-05: every ${label} diagnostic carries a quick fix, and applying the fixes gives its fixed tree with no ${label} left`, async () => {
        const dir = treeOf(code, "positive") as string;
        const list = (await diagnose(dir)).filter((d) => d.code === code);
        expect(list.length).toBeGreaterThan(0);
        for (const d of list) expect(d.fix, d.message).toBeDefined();
        const fixed = readTree(treeOf(code, "fixed") as string);
        const result = readTree(dir).map((f) => ({
          path: f.path,
          text: applyTextEdits(
            f.text,
            list.flatMap((d) =>
              d.path === f.path ? (d.fix?.edits ?? []) : [],
            ),
          ),
        }));
        expect(result).toEqual(fixed);
        const after = await diagnose(treeOf(code, "fixed") as string);
        expect(after.filter((d) => d.code === code)).toEqual([]);
      });
    else
      it(`F-112 step 2: ${label} offers no quick fix`, async () => {
        const list = (
          await diagnose(treeOf(code, "positive") as string)
        ).filter((d) => d.code === code);
        for (const d of list) expect(d.fix).toBeUndefined();
      });
  }

  it("F-112 step 2: the distinct messages of every code are kept in messages.md for review", async () => {
    const lines: string[] = [];
    for (const { code } of codes) {
      const list = await diagnose(treeOf(code, "positive") as string);
      const messages = [
        ...new Set(list.filter((d) => d.code === code).map((d) => d.message)),
      ].sort();
      lines.push(`## ${code}`, "", ...messages.map((m) => `- ${m}`), "");
    }
    await expect(lines.join("\n")).toMatchFileSnapshot("./messages.md");
  });
});
