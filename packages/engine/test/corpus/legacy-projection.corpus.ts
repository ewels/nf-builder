// F-107 steps 1 and 2 (AR-14, LA-21, ADR 0004): the legacy projection over the pinned corpus. Every legacy workflow of
// the rnaseq, sarek, fetchngs and rnaseq-nf pins has a committed snapshot; the share of main statements modelled
// (no code node) is reported per workflow and is at least 90% overall. Run by `pnpm test:corpus` after
// `pnpm corpus:fetch`; adds "Legacy projection (F-107)" to .cache/reports/parse-corpus.md.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Projection } from "@nf-builder/lang-core";
import { beforeAll, describe, expect, it } from "vitest";
import type { ProjectModel } from "../../src/index";
import { projectionCoverage } from "../../src/projection/coverage";
import type { Projector } from "../../src/projection/project";
import { readTree } from "../model/read-tree";
import { openFiles, projectorFor } from "../projection/open";
import { renderProjection } from "../projection/render";

const ROOT = join(import.meta.dirname, "../../../..");
const CORPUS = join(ROOT, ".cache/corpus");
const REPORTS = join(ROOT, ".cache/reports");
const SNAPSHOTS = join(import.meta.dirname, "snapshots/legacy-projection");
const PINS = ["rnaseq", "sarek", "fetchngs", "rnaseq-nf"];

interface Pin {
  id: string;
  model: ProjectModel;
  projector: Projector;
}
const pins: Pin[] = [];

beforeAll(async () => {
  for (const id of PINS) {
    if (!existsSync(join(CORPUS, id))) continue;
    const model = await openFiles(readTree(join(CORPUS, id)));
    pins.push({ id, model, projector: await projectorFor(model) });
  }
});

const name = (path: string, workflow: string | null) =>
  `${path.replaceAll("/", "__")}--${workflow ?? "entry"}.txt`;

/** The legacy workflows of a pin: modelled and not typed. */
const legacy = (pin: Pin) =>
  pin.projector.workflows().filter((w) => w.modelled && w.typed === false);

// the corpus is read when the test starts, so the snapshot tests are made from the pins on disk
const present = PINS.filter((id) => existsSync(join(CORPUS, id)));

describe("F-107 step 1 AR-14 LA-21 legacy corpus snapshots", async () => {
  for (const id of present) {
    const model = await openFiles(readTree(join(CORPUS, id)));
    const projector = await projectorFor(model);
    const workflows = projector
      .workflows()
      .filter((w) => w.modelled && w.typed === false);
    for (const ref of workflows)
      it(`F-107 step 1 AR-14 LA-21: ${id}/${ref.path}#${ref.name ?? ""} matches its projection snapshot`, async () => {
        const projection = projector.project(ref.path, ref.name);
        if (projection === null) throw new Error(`no projection ${ref.path}`);
        const text = model.file(ref.path)?.source.text ?? "";
        const rendered = renderProjection(projection, text);
        expect(rendered).toMatch(
          /^workflow .*\nstatements \d+, modelled \d+\n/,
        );
        await expect(rendered).toMatchFileSnapshot(
          `${SNAPSHOTS}/${id}/${name(ref.path, ref.name)}`,
        );
      });
  }

  it("F-107 step 1: every workflow of the pins has a snapshot", () => {
    expect(pins.length).toBe(PINS.length);
    let total = 0;
    for (const pin of pins) {
      const expected = legacy(pin)
        .map((w) => name(w.path, w.name))
        .sort();
      const dir = `${SNAPSHOTS}/${pin.id}`;
      const found = existsSync(dir) ? readdirSync(dir).sort() : [];
      expect(found, pin.id).toEqual(expected);
      total += expected.length;
    }
    expect(total).toBe(119);
  });
});

describe("F-107 IO-14 AR-11 legacy corpus projection", () => {
  it("F-107 IO-14 AR-11: every corpus workflow projects without throwing, with unique ids", () => {
    for (const pin of pins)
      for (const ref of pin.projector.workflows()) {
        if (!ref.modelled) continue;
        let p: Projection | null = null;
        expect(() => {
          p = pin.projector.project(ref.path, ref.name);
        }, `${pin.id}:${ref.path}`).not.toThrow();
        const projection = p as Projection | null;
        if (projection === null) throw new Error(`${pin.id}:${ref.path}`);
        const ids = projection.nodes.map((n) => n.id);
        expect(new Set(ids).size, `${pin.id}:${ref.path}`).toBe(ids.length);
      }
  });
});

/** What an unmodelled statement is, for the gap table. */
function construct(projection: Projection, text: string, at: number): string {
  const statement = projection.statements[at];
  if (statement === undefined) return "?";
  const head = text.slice(statement.range.start, statement.range.end);
  const word = /^\s*([A-Za-z_][\w.]*)/.exec(head)?.[1] ?? head.slice(0, 12);
  if (/^(if|else|try|for|while|switch|return|throw|assert)\b/.test(word))
    return word;
  if (/^\s*def\b/.test(head)) return "def";
  return /^\s*[\w.]+\s*=/.test(head) ? "assignment" : "call or expression";
}

describe("F-107 step 2 ADR-0004 statements modelled", () => {
  it("F-107 step 2 ADR-0004: the share of statements modelled is reported per workflow and is at least 90% overall", () => {
    const rows: { pin: string; workflow: string; s: number; m: number }[] = [];
    const gaps = new Map<string, number>();
    for (const pin of pins)
      for (const ref of legacy(pin)) {
        const p = pin.projector.project(ref.path, ref.name);
        if (p === null) throw new Error(`${pin.id}:${ref.path}`);
        const { statements, modelled } = projectionCoverage(p);
        rows.push({
          pin: pin.id,
          workflow: `${ref.path}#${ref.name ?? ""}`,
          s: statements,
          m: modelled,
        });
        const text = pin.model.file(ref.path)?.source.text ?? "";
        p.statements.forEach((st, i) => {
          if (st.modelled) return;
          const key = construct(p, text, i);
          gaps.set(key, (gaps.get(key) ?? 0) + 1);
        });
      }
    const share = (m: number, s: number) =>
      s === 0 ? "100.0" : ((100 * m) / s).toFixed(1);
    const sum = (list: typeof rows) => ({
      s: list.reduce((n, r) => n + r.s, 0),
      m: list.reduce((n, r) => n + r.m, 0),
    });
    const all = sum(rows);
    const lines = [
      "## Legacy projection (F-107)",
      "",
      "Share of main statements modelled (no code node), per pin. A transparent `if` counts by its branch statements.",
      "",
      "| Pin | Workflows | Statements | Modelled | Share (%) |",
      "|---|---|---|---|---|",
      ...pins.map((pin) => {
        const mine = rows.filter((r) => r.pin === pin.id);
        const t = sum(mine);
        return `| ${pin.id} | ${mine.length} | ${t.s} | ${t.m} | ${share(t.m, t.s)} |`;
      }),
      `| overall | ${rows.length} | ${all.s} | ${all.m} | ${share(all.m, all.s)} |`,
      "",
      "Statements left as code nodes, by construct:",
      "",
      "| Construct | Statements |",
      "|---|---|",
      ...[...gaps]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `| ${k} | ${n} |`),
      "",
      "Per workflow, lowest share first:",
      "",
      "| Pin | Workflow | Statements | Modelled | Share (%) |",
      "|---|---|---|---|---|",
      ...[...rows]
        .sort((a, b) => a.m / (a.s || 1) - b.m / (b.s || 1))
        .map(
          (r) =>
            `| ${r.pin} | ${r.workflow} | ${r.s} | ${r.m} | ${share(r.m, r.s)} |`,
        ),
      "",
    ].join("\n");
    mkdirSync(REPORTS, { recursive: true });
    writeFileSync(join(REPORTS, "legacy-projection.md"), lines);
    const file = join(REPORTS, "parse-corpus.md");
    const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
    const base = previous
      .split(/\n(?=## )/)
      .filter((part) => !part.startsWith("## Legacy projection"))
      .join("\n")
      .trimEnd();
    writeFileSync(file, `${base}${base ? "\n\n" : ""}${lines}`);
    expect(all.s).toBeGreaterThan(0);
    expect(all.m / all.s, `${all.m} of ${all.s}`).toBeGreaterThanOrEqual(0.9);
  });
});
