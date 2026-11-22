import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { stripAnsi } from "./check.ts";
import {
  AST_ERRORS_FILE,
  AST_FIXTURES_FILE,
  CONFIG_AST_ERRORS_FILE,
  FIXTURES_FILE,
} from "./paths.ts";
import type { OracleRun } from "./run.ts";

const escapeData = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

/** Markdown: the version line; a table of every check; then each check's command and the first 60 lines of its log. */
export function formatReport(run: OracleRun): string {
  const out: string[] = [
    "# Nextflow oracle",
    "",
    `Nextflow ${run.nextflowVersion}, manifest \`${run.manifest}\`, started ${run.startedAt}.`,
    "",
    "| case | check | expected | actual | exit | result |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of run.results) {
    out.push(
      `| ${r.caseId} | ${r.kind} | ${r.expected} | ${r.actual} | ${r.exitCode ?? "signal"} | ${r.matched ? "matched" : "MISMATCH"} |`,
    );
  }
  for (const r of run.results) {
    let excerpt = "";
    try {
      excerpt = stripAnsi(readFileSync(r.logFile, "utf8"))
        .split("\n")
        .slice(0, 60)
        .join("\n");
    } catch {
      excerpt = "(log not available)";
    }
    out.push(
      "",
      `## ${r.caseId} ${r.kind}`,
      "",
      `Command: \`nextflow ${r.command.join(" ")}\``,
    );
    for (const [label, items] of [
      ["Problem", r.problems],
      ["Error", r.errors],
      ["Warning", r.warnings],
    ] as const) {
      if (items.length > 0)
        out.push("", ...items.map((i) => `- ${label}: ${i}`));
    }
    out.push("", "```", excerpt, "```");
  }
  out.push("");
  return out.join("\n");
}

/** The file a row belongs to: fixture rows are in fixtures.yaml, AST tree rows in the pack's JSON, case rows in the manifest. */
const sourceOf = (caseId: string, manifest: string): string =>
  caseId.startsWith("fixture:")
    ? FIXTURES_FILE
    : caseId.startsWith("ast-fixtures:")
      ? AST_FIXTURES_FILE
      : caseId.startsWith("ast-errors:")
        ? AST_ERRORS_FILE
        : caseId.startsWith("config-ast-errors:")
          ? CONFIG_AST_ERRORS_FILE
          : manifest;

/** One `::error` annotation per mismatched check, pointing at the file that records what was expected. */
export function annotations(run: OracleRun, repoRoot: string): string[] {
  const rel = (file: string): string =>
    relative(repoRoot, file).split("\\").join("/");
  return run.results
    .filter((r) => !r.matched)
    .map((r) => {
      const file = rel(sourceOf(r.caseId, run.manifest));
      return `::error file=${escapeProperty(file)},title=Nextflow oracle::${escapeData(`${r.caseId} ${r.kind}: ${r.problems.join("; ")}`)}`;
    });
}
