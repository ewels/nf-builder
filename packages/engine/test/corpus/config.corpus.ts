// F-601 (FI-01, FI-03, FI-06, AR-22, AR-23, AR-30): the config view and the config edit commands over every pinned
// corpus pipeline. Run by `pnpm test:corpus` after `pnpm corpus:fetch`; writes .cache/reports/config-corpus.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ConfigAst,
  ConfigSourceFile,
  EditCommand,
} from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { ConfigViewItem, ScopeCard } from "../../src/config/types";
import { EXCERPT_LIMIT } from "../../src/config/types";
import {
  applyCommand,
  createEditState,
  type EditState,
} from "../../src/edit/apply";
import { applyPatches } from "../../src/edit/patches";
import type { Opened } from "../config/helpers";
import { open } from "../config/helpers";
import { checkUntouched } from "../edit/config-untouched";
import { version } from "../edit/helpers";
import { readTree } from "../model/read-tree";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");

const IDS = [
  ...readFileSync(join(ROOT, "tools/corpus/corpus.yaml"), "utf8").matchAll(
    /^\s*- id: (\S+)/gm,
  ),
].map((m) => m[1] as string);

const opened = new Map<string, Opened>();
const states = new Map<string, EditState>();
const timings: number[] = [];
const outcomes = new Map<string, number>();
const report: string[] = [];
const zeroMatches: string[] = [];
let configs = 0;

beforeAll(async () => {
  for (const id of IDS) {
    opened.set(id, await open(readTree(join(CORPUS, id))));
    states.set(id, await createEditState(version, readTree(join(CORPUS, id))));
  }
});

const configPaths = (o: Opened): string[] =>
  o.model.paths().filter((p) => o.model.file(p)?.source.language === "config");

/** Every excerpt the view carries. */
function excerpts(items: readonly ConfigViewItem[], out: string[] = []) {
  for (const item of items) {
    if (item.kind === "code") out.push(item.text);
    else if (item.kind === "include") out.push(item.source);
    else {
      const card = item.card;
      for (const r of [
        ...card.rows,
        ...card.selectors.flatMap((s) => s.rows),
      ]) {
        if (r.kind === "option" && r.code !== null) out.push(r.code);
        else if (r.kind === "code") out.push(r.text);
        else if (r.kind === "include") out.push(r.source);
      }
      for (const p of card.profiles) excerpts(p.items, out);
    }
  }
  return out;
}

const cardsOf = (items: readonly ConfigViewItem[]): ScopeCard[] =>
  items.flatMap((i) => (i.kind === "scope" ? [i.card] : []));

describe("F-601 config view corpus", () => {
  it("F-601 FI-01 AR-30: configView never throws on the corpus configs, accounts for every statement and keeps excerpts short", () => {
    for (const [id, o] of opened)
      for (const path of configPaths(o)) {
        const source = o.model.file(path)?.source as ConfigSourceFile;
        const view = o.view(path);
        configs += 1;
        expect(view.path).toBe(path);
        expect(view.editable).toBe(
          source.status === "modelled" && source.problems.length === 0,
        );
        for (const s of (source.ast as ConfigAst | null)?.statements ?? [])
          expect(
            view.items.some(
              (i) =>
                (i.kind === "scope" ? i.card.range : i.range).start <=
                  s.range.start &&
                (i.kind === "scope" ? i.card.range : i.range).end >=
                  s.range.end,
            ),
            `${id}/${path}: statement at ${s.range.line} is in the view`,
          ).toBe(true);
        for (const e of excerpts(view.items)) {
          expect(e.length).toBeLessThanOrEqual(EXCERPT_LIMIT);
          expect(e).not.toMatch(/[\r\n]/);
        }
      }
    expect(configs).toBeGreaterThan(100);
  });

  it("F-601 FI-03: on the five pins the unknown-option warnings are exactly the eight plugin-scope options", () => {
    const found: string[] = [];
    for (const o of opened.values())
      for (const d of o.diagnoser.all())
        if (d.code === "config-unknown-option")
          found.push(
            /Unrecognized config option '([^']+)'/.exec(d.message)?.[1] ??
              d.message,
          );
    const scopes = found.map((n) => n.split(".")[0]).sort();
    expect(found).toHaveLength(8);
    expect(scopes.filter((s) => s === "validation")).toHaveLength(6);
    expect(scopes.filter((s) => s === "prov")).toHaveLength(2);
    report.push(`Unknown-option warnings: ${found.sort().join(", ")}`);
  });

  it("F-601 FI-06: selector counts on the pins; zero matches are listed in the report", () => {
    let selectors = 0;
    for (const [id, o] of opened)
      for (const path of configPaths(o)) {
        const walk = (items: readonly ConfigViewItem[]) => {
          for (const card of cardsOf(items)) {
            for (const s of card.selectors) {
              if (s.match === null) continue;
              selectors += 1;
              if (s.match.count === 0)
                zeroMatches.push(`${id}/${path}: ${s.written}`);
              else expect(s.match.count).toBeGreaterThan(0);
            }
            for (const p of card.profiles) walk(p.items);
          }
        };
        walk(o.view(path).items);
      }
    expect(selectors).toBeGreaterThan(0);
    report.push(`Selectors evaluated: ${selectors}`);
  });

  it("F-601 AR-22 AR-23: set, remove and add-block on every corpus config pass the guards, keep untouched statements byte for byte and undo exactly", () => {
    let accepted = 0;
    for (const [id, o] of opened) {
      const state = states.get(id) as EditState;
      for (const path of configPaths(o)) {
        const view = o.view(path);
        // the first option the file sets at its top level, for the removal
        const first = cardsOf(view.items)
          .flatMap((c) => c.rows)
          .find((r) => r.kind === "option" && r.class === "option");
        const commands: EditCommand[] = [
          {
            kind: "setConfigOption",
            path,
            context: { profile: null, selector: null },
            option: ["docker", "enabled"],
            value: { kind: "boolean", value: true },
          },
          {
            kind: "setConfigOption",
            path,
            context: { profile: "corpus-test", selector: null },
            option: ["process", "cpus"],
            value: { kind: "integer", value: 2 },
          },
          {
            kind: "setConfigOption",
            path,
            context: {
              profile: null,
              selector: { kind: "withLabel", pattern: "corpus_label" },
            },
            option: ["process", "memory"],
            value: { kind: "memory", amount: 8, unit: "GB" },
          },
          {
            kind: "addConfigBlock",
            path,
            context: { profile: null, selector: null },
            scope: ["wave"],
          },
          { kind: "addConfigPlugin", path, id: "nf-corpus@1.0.0" },
          ...(first?.kind === "option"
            ? [
                {
                  kind: "removeConfigOption",
                  path,
                  context: { profile: null, selector: null },
                  option: first.option,
                } satisfies EditCommand,
              ]
            : []),
        ];
        const before = state.model.file(path)?.source as ConfigSourceFile;
        for (const command of commands) {
          const started = performance.now();
          const result = applyCommand(state, command);
          timings.push(performance.now() - started);
          const key = `${command.kind}:${result.ok ? "ok" : result.code}`;
          outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
          if (!result.ok) {
            expect(
              ["invalid", "not-found", "does-not-parse"],
              `${id}/${path} ${command.kind}: ${result.message}`,
            ).toContain(result.code);
            continue;
          }
          accepted += 1;
          for (const patch of result.patches) {
            if (patch.kind !== "edit") throw new Error("edits only");
            const text = result.files.find((f) => f.path === patch.path)
              ?.text as string;
            if (before.ast !== null)
              checkUntouched(
                before,
                text,
                patch.edits,
                `${id}/${path} ${command.kind}`,
              );
          }
          const after = result.files.find((f) => f.path === path)?.text ?? "";
          const undone = applyPatches(new Map([[path, after]]), result.inverse);
          expect(
            undone.files.get(path),
            `${id}/${path} ${command.kind} undoes`,
          ).toBe(before.text);
        }
      }
    }
    expect(accepted).toBeGreaterThan(500);
  });

  it("F-601: the config corpus report is written", () => {
    mkdirSync(REPORTS, { recursive: true });
    const lines = [
      "# Config editor over the corpus (F-601)",
      "",
      `Config files viewed: ${configs}.`,
      "",
      `Edit commands over every config (${timings.length}; p95 ${[...timings].sort((a, b) => a - b)[Math.floor(timings.length * 0.95)]?.toFixed(1)} ms, max ${Math.max(...timings).toFixed(1)} ms):`,
      "",
      ...[...outcomes].sort().map(([k, n]) => `- ${k}: ${n}`),
      "",
      ...report.map((l) => `- ${l}`),
      "",
      `Selectors matching no process (${zeroMatches.length}):`,
      "",
      ...zeroMatches.map((l) => `- ${l}`),
    ];
    writeFileSync(join(REPORTS, "config-corpus.md"), `${lines.join("\n")}\n`);
    expect(lines.length).toBeGreaterThan(4);
  });
});
