// ADR lint (ADR 0001): numbering, title, status and date lines, and agreement with docs/adr/README.md.
// Imports only node: built-ins and check-common.ts, so CI can run it without `pnpm install`.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isMain,
  type Problem,
  REPO_ROOT,
  reportProblems,
} from "./check-common.ts";

export const ADR_DIR: string = join(REPO_ROOT, "docs/adr");
export const ADR_FILE_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
export const ALLOWED_STATUS =
  /^(Proposed|Accepted|Accepted \(agent\)|Accepted \(spike S\d+ to confirm\)|Superseded by (\d{4}))$/;
const ALLOWED_TEXT =
  "Proposed, Accepted, Accepted (agent), Accepted (spike Sn to confirm), Superseded by NNNN (ADR 0001)";

export type Adr = {
  file: string;
  number: string;
  title: string | null;
  status: string | null;
  date: string | null;
};
export type IndexRow = {
  line: number;
  number: string;
  link: string;
  decision: string;
  status: string;
};

const lines = (text: string): string[] => text.split(/\r?\n/);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseAdr(
  file: string,
  text: string,
): { adr: Adr; problems: Problem[] } {
  const name = file.split(/[\\/]/).pop() ?? file;
  const number = name.slice(0, 4);
  const problems: Problem[] = [];
  const all = lines(text);
  const first = all[0] ?? "";
  const titleMatch = /^# (\d{4})\. (.+)$/.exec(first);
  let title: string | null = null;
  if (titleMatch && titleMatch[1] === number)
    title = (titleMatch[2] ?? "").trim();
  else
    problems.push({
      file,
      line: 1,
      message: `the first line must be "# ${number}. <decision>"; found "${first}"`,
    });

  const end = all.findIndex((l, i) => i > 0 && l.startsWith("## "));
  const header = all.slice(1, end === -1 ? undefined : end);
  const statusLines = header.filter((l) => /^- Status:/.test(l));
  const dateLines = header.filter((l) => /^- Date:/.test(l));

  let status: string | null = null;
  if (statusLines.length === 0)
    problems.push({
      file,
      message: `no "- Status:" line under the title. Add one, for example "- Status: Proposed". Allowed: ${ALLOWED_TEXT}.`,
    });
  else if (statusLines.length > 1)
    problems.push({
      file,
      message: `${statusLines.length} "- Status:" lines under the title; keep exactly one.`,
    });
  else {
    status = (statusLines[0] ?? "").replace(/^- Status:\s*/, "").trim();
    if (!ALLOWED_STATUS.test(status)) {
      problems.push({
        file,
        message: `status "${status}" is not allowed. Allowed: ${ALLOWED_TEXT}.`,
      });
    }
  }

  let date: string | null = null;
  if (dateLines.length !== 1)
    problems.push({
      file,
      message:
        dateLines.length === 0
          ? 'no "- Date: YYYY-MM-DD" line under the title. Add one.'
          : `${dateLines.length} "- Date:" lines under the title; keep exactly one.`,
    });
  else {
    date = (dateLines[0] ?? "").replace(/^- Date:\s*/, "").trim();
    if (!validDate(date))
      problems.push({
        file,
        message: `date "${date}" is not a real YYYY-MM-DD date. Fix the "- Date:" line.`,
      });
  }

  return { adr: { file, number, title, status, date }, problems };
}

const ROW = /^\| \[(\d{4})\]\(([^)]+)\) \| (.+?) \| (.+?) \|$/;

export function parseIndex(
  text: string,
  indexFile: string,
): { rows: IndexRow[]; problems: Problem[] } {
  const rows: IndexRow[] = [];
  const problems: Problem[] = [];
  lines(text).forEach((raw, i) => {
    const match = ROW.exec(raw);
    if (match)
      rows.push({
        line: i + 1,
        number: match[1] ?? "",
        link: match[2] ?? "",
        decision: match[3] ?? "",
        status: match[4] ?? "",
      });
    else if (raw.startsWith("| ["))
      problems.push({
        file: indexFile,
        line: i + 1,
        message: `cannot read this index row; use "| [NNNN](NNNN-title.md) | <decision> | <status> |"`,
      });
  });
  return { rows, problems };
}

export function lintAdrs(dir: string = ADR_DIR): Problem[] {
  const problems: Problem[] = [];
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort();
  const adrNames: string[] = [];
  for (const name of names) {
    if (name === "README.md" || name === "template.md") continue;
    if (ADR_FILE_NAME.test(name)) adrNames.push(name);
    else
      problems.push({
        file: join(dir, name),
        message:
          "ADR files are named NNNN-short-title.md (lower case, hyphens); rename it or move it out of docs/adr",
      });
  }

  const max = adrNames.reduce((m, n) => Math.max(m, Number(n.slice(0, 4))), 0);
  const nextFree = String(max + 1).padStart(4, "0");
  const firstByNumber = new Map<string, string>();
  const adrs = new Map<string, Adr>();
  const known = new Set(adrNames.map((n) => n.slice(0, 4)));

  for (const name of adrNames) {
    const file = join(dir, name);
    const number = name.slice(0, 4);
    const earlier = firstByNumber.get(number);
    if (earlier === undefined) firstByNumber.set(number, name);
    else
      problems.push({
        file,
        message: `ADR number ${number} is also used by docs/adr/${earlier}. Give this one the next free number, ${nextFree}: rename the file, fix its title line, and fix its row in docs/adr/README.md.`,
      });
    const parsed = parseAdr(file, readFileSync(file, "utf8"));
    problems.push(...parsed.problems);
    const status = parsed.adr.status;
    if (status !== null) {
      const target = ALLOWED_STATUS.exec(status)?.[2];
      if (target !== undefined) {
        if (target === number)
          problems.push({
            file,
            message: `"${status}" names the ADR itself; name the ADR that replaces it.`,
          });
        else if (!known.has(target))
          problems.push({
            file,
            message: `"${status}" names ADR ${target}, which does not exist in docs/adr.`,
          });
      }
    }
    adrs.set(name, parsed.adr);
  }

  const indexFile = join(dir, "README.md");
  if (!existsSync(indexFile)) {
    problems.push({
      file: indexFile,
      message: "docs/adr/README.md is missing; it must list every ADR.",
    });
    return problems;
  }
  const { rows, problems: indexProblems } = parseIndex(
    readFileSync(indexFile, "utf8"),
    indexFile,
  );
  problems.push(...indexProblems);

  const listed = new Map<string, number>();
  let previous = "";
  for (const row of rows) {
    const where = { file: indexFile, line: row.line };
    const linkNumber = row.link.slice(0, 4);
    if (linkNumber !== row.number)
      problems.push({
        ...where,
        message: `row number ${row.number} does not match its link ${row.link}`,
      });
    if (row.number < previous)
      problems.push({
        ...where,
        message: `row ${row.number} is out of order; keep rows in ascending number order`,
      });
    previous = row.number;
    const adr = adrs.get(row.link);
    if (adr === undefined) {
      problems.push({
        ...where,
        message: `links to ${row.link}, which does not exist`,
      });
      continue;
    }
    listed.set(row.link, (listed.get(row.link) ?? 0) + 1);
    if (adr.title !== null && row.decision !== adr.title)
      problems.push({
        ...where,
        message: `decision text "${row.decision}" differs from the title of ${row.link}: "${adr.title}"`,
      });
    if (adr.status !== null && row.status !== adr.status)
      problems.push({
        ...where,
        message: `status "${row.status}" differs from the status in ${row.link}: "${adr.status}"`,
      });
  }
  for (const name of adrNames) {
    const count = listed.get(name) ?? 0;
    const adr = adrs.get(name);
    if (count === 0)
      problems.push({
        file: join(dir, name),
        message: `not listed in docs/adr/README.md. Add this row in number order: | [${name.slice(0, 4)}](${name}) | ${adr?.title ?? "<title>"} | ${adr?.status ?? "Proposed"} |`,
      });
    else if (count > 1)
      problems.push({
        file: join(dir, name),
        message: `listed ${count} times in docs/adr/README.md; keep one row`,
      });
  }
  return problems;
}

if (isMain(import.meta)) {
  const args = process.argv.slice(2);
  let dir = ADR_DIR;
  if (args[0] === "--dir" && args[1] !== undefined) dir = args[1];
  else if (args.length > 0) {
    console.error("usage: node scripts/check-adrs.ts [--dir <path>]");
    process.exit(2);
  }
  const problems = lintAdrs(dir);
  if (reportProblems("ADR lint", problems)) {
    const count = readdirSync(dir).filter((n) => ADR_FILE_NAME.test(n)).length;
    console.log(`ADR lint: ${count} ADRs agree with docs/adr/README.md`);
  } else process.exitCode = 1;
}
