import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintAdrs } from "../scripts/check-adrs.ts";
import { REPO_ROOT } from "../scripts/check-common.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Spec = {
  file: string;
  title?: string;
  status?: string | null;
  date?: string | null;
  body?: string;
  raw?: string;
};
type Row = { n: string; link: string; decision: string; status: string };

function number(file: string): string {
  return file.slice(0, 4);
}

function makeDir(specs: Spec[], rows?: Row[]): string {
  const dir = mkdtempSync(join(tmpdir(), "nf-builder-adr-"));
  dirs.push(dir);
  for (const s of specs) {
    const n = number(s.file);
    const title = s.title ?? `Title ${n}`;
    const status = s.status === undefined ? "Accepted" : s.status;
    const date = s.date === undefined ? "2026-11-21" : s.date;
    const text =
      s.raw ??
      [
        `# ${n}. ${title}`,
        "",
        ...(status === null ? [] : [`- Status: ${status}`]),
        ...(date === null ? [] : [`- Date: ${date}`]),
        "",
        "## Context",
        s.body ?? "text",
        "",
      ].join("\n");
    writeFileSync(join(dir, s.file), text);
  }
  const indexRows =
    rows ??
    specs
      .filter((s) => /^\d{4}-/.test(s.file))
      .map((s) => ({
        n: number(s.file),
        link: s.file,
        decision: s.title ?? `Title ${number(s.file)}`,
        status: s.status ?? "Accepted",
      }));
  writeFileSync(
    join(dir, "README.md"),
    [
      "# Index",
      "",
      "| # | Decision | Status |",
      "|---|---|---|",
      ...indexRows.map(
        (r) => `| [${r.n}](${r.link}) | ${r.decision} | ${r.status} |`,
      ),
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "template.md"), "# NNNN. Title\n");
  return dir;
}

const valid: Spec[] = [
  { file: "0001-a.md", body: "- Statuses: Proposed, Accepted" },
  { file: "0002-b.md", status: "Accepted (agent)" },
  { file: "0003-c.md", status: "Accepted (spike S4 to confirm)" },
  { file: "0004-d.md", status: "Proposed" },
  { file: "0005-e.md", status: "Superseded by 0001" },
];

describe("ADR lint", () => {
  it("F-003 step 3: ADR lint passes well-formed ADRs and a matching index", () => {
    expect(lintAdrs(makeDir(valid))).toEqual([]);
  });

  it("F-003 step 3: ADR lint rejects a duplicate number, naming both files and the next free number", () => {
    const dir = makeDir([
      { file: "0001-a.md" },
      { file: "0002-b.md" },
      { file: "0003-c.md" },
      { file: "0003-dup.md", title: "Dup" },
    ]);
    const problems = lintAdrs(dir).filter((p) => /number 0003/.test(p.message));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toContain("0003-dup.md");
    expect(problems[0]?.message).toContain("0003-c.md");
    expect(problems[0]?.message).toContain("0004");
  });

  it('F-003 step 3: ADR lint rejects an ADR with no "- Status:" line', () => {
    const dir = makeDir([{ file: "0001-a.md", status: null }]);
    const problems = lintAdrs(dir);
    expect(problems.length).toBeGreaterThan(0);
    const p = problems.find((x) => x.message.includes("Status:"));
    expect(p?.file).toContain("0001-a.md");
    expect(p?.message).toContain("- Status: Proposed");
    expect(p?.message).toContain("Superseded by NNNN");
  });

  it("F-003 step 3: ADR lint rejects an ADR missing from the README index and prints the row to add", () => {
    const dir = makeDir(
      [{ file: "0001-a.md" }, { file: "0003-x.md", title: "T" }],
      [
        {
          n: "0001",
          link: "0001-a.md",
          decision: "Title 0001",
          status: "Accepted",
        },
      ],
    );
    const problems = lintAdrs(dir);
    expect(problems.map((p) => p.message).join("\n")).toContain(
      "| [0003](0003-x.md) | T | Accepted |",
    );
  });

  it.each([["Done"], ["accepted"], ["Superseded"], ["Superseded by 0099"]])(
    "F-003: ADR lint rejects the status %s",
    (status) => {
      const dir = makeDir([
        { file: "0001-a.md" },
        { file: "0002-b.md", status },
      ]);
      expect(lintAdrs(dir)).toHaveLength(1);
    },
  );

  it("F-003: ADR lint rejects the status Superseded by itself", () => {
    const dir = makeDir([
      { file: "0001-a.md" },
      { file: "0002-b.md", status: "Superseded by 0002" },
    ]);
    expect(lintAdrs(dir)).toHaveLength(1);
  });

  it("F-003: ADR lint rejects a title whose number differs from the file name", () => {
    const dir = makeDir(
      [
        {
          file: "0015-x.md",
          raw: "# 15. X\n\n- Status: Accepted\n- Date: 2026-11-21\n\n## C\n",
        },
      ],
      [{ n: "0015", link: "0015-x.md", decision: "X", status: "Accepted" }],
    );
    const problems = lintAdrs(dir);
    expect(problems.some((p) => p.line === 1)).toBe(true);
  });

  it.each([
    ["missing", null],
    ["impossible", "2026-13-01"],
    ["slashed", "21/11/2026"],
  ])("F-003: ADR lint rejects a %s date line", (_name, date) => {
    const dir = makeDir([{ file: "0001-a.md", date }]);
    expect(lintAdrs(dir)).toHaveLength(1);
  });

  it("F-003: ADR lint rejects an index row whose status or decision differs from the ADR", () => {
    const dir = makeDir(
      [{ file: "0001-a.md" }, { file: "0002-b.md" }],
      [
        { n: "0001", link: "0001-a.md", decision: "Wrong", status: "Accepted" },
        {
          n: "0002",
          link: "0002-b.md",
          decision: "Title 0002",
          status: "Proposed",
        },
      ],
    );
    const problems = lintAdrs(dir);
    expect(problems).toHaveLength(2);
    expect(problems.every((p) => typeof p.line === "number")).toBe(true);
    expect(problems[0]?.message).toContain("Wrong");
    expect(problems[0]?.message).toContain("Title 0001");
    expect(problems[1]?.message).toContain("Proposed");
    expect(problems[1]?.message).toContain("Accepted");
  });

  it("F-003: ADR lint rejects an index row that links to a missing file, and rows out of order", () => {
    const dir = makeDir(
      [{ file: "0001-a.md" }, { file: "0002-b.md" }],
      [
        {
          n: "0002",
          link: "0002-b.md",
          decision: "Title 0002",
          status: "Accepted",
        },
        {
          n: "0001",
          link: "0001-a.md",
          decision: "Title 0001",
          status: "Accepted",
        },
        {
          n: "0003",
          link: "0003-gone.md",
          decision: "Gone",
          status: "Accepted",
        },
      ],
    );
    const text = lintAdrs(dir)
      .map((p) => p.message)
      .join("\n");
    expect(text).toContain("0003-gone.md, which does not exist");
    expect(text).toContain("ascending");
  });

  it("F-003: ADR lint rejects a file in docs/adr that is not NNNN-title.md, README.md or template.md", () => {
    const dir = makeDir([{ file: "0001-a.md" }]);
    writeFileSync(join(dir, "notes.md"), "x");
    writeFileSync(join(dir, "15-x.md"), "x");
    const files = lintAdrs(dir).map((p) => p.file ?? "");
    expect(files.some((f) => f.endsWith("notes.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("15-x.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("template.md"))).toBe(false);
  });

  it("F-003 step 2: node scripts/check-adrs.ts --dir <broken> exits 1 with file-located problems", () => {
    const good = makeDir(valid);
    const broken = makeDir(
      [
        { file: "0001-a.md" },
        { file: "0002-b.md", status: null },
        { file: "0002-dup.md" },
        { file: "0003-c.md" },
      ],
      [
        {
          n: "0001",
          link: "0001-a.md",
          decision: "Title 0001",
          status: "Accepted",
        },
        {
          n: "0002",
          link: "0002-b.md",
          decision: "Title 0002",
          status: "Accepted",
        },
      ],
    );
    const run = (dir: string, env: Record<string, string> = {}) =>
      spawnSync(process.execPath, ["scripts/check-adrs.ts", "--dir", dir], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "", ...env },
      });
    const bad = run(broken);
    expect(bad.status).toBe(1);
    const out = bad.stdout + bad.stderr;
    expect(out).toContain("ADR number 0002");
    expect(out).toContain("- Status:");
    expect(out).toContain("not listed in");
    expect(run(broken, { GITHUB_ACTIONS: "true" }).stdout).toContain(
      "::error file=",
    );
    expect(run(good).status).toBe(0);
  });
});
