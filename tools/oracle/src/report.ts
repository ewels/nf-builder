import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { stripAnsi } from "./check.ts";
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
    if (r.problems.length > 0) {
      out.push("", ...r.problems.map((p) => `- Problem: ${p}`));
    }
    if (r.errors.length > 0)
      out.push("", ...r.errors.map((e) => `- Error: ${e}`));
    if (r.warnings.length > 0) {
      out.push("", ...r.warnings.map((w) => `- Warning: ${w}`));
    }
    out.push("", "```", excerpt, "```");
  }
  out.push("");
  return out.join("\n");
}

/** One `::error` annotation per mismatched check. */
export function annotations(run: OracleRun, repoRoot: string): string[] {
  const file = relative(repoRoot, run.manifest).split("\\").join("/");
  return run.results
    .filter((r) => !r.matched)
    .map(
      (r) =>
        `::error file=${escapeProperty(file)},title=Nextflow oracle::${escapeData(`${r.caseId} ${r.kind}: ${r.problems.join("; ")}`)}`,
    );
}
