import type { ProblemCounts, ProblemsView } from "@nf-builder/engine";
import type { JSX } from "react";
import type { DiagnosticsStatus } from "../problems/problems-store";
import { SEVERITY_GLYPHS } from "../problems/severity";
import "../problems/problems.css";
import { CheckIcon } from "./icons";

/** The status bar's view of the project's diagnostics (UX-03, F-309); null with no project. */
export interface StatusProblems {
  readonly status: DiagnosticsStatus;
  readonly counts: ProblemCounts;
  readonly message?: string | null;
  /** The tab the problems panel is open on, or null while it is closed. */
  readonly open: ProblemsView | null;
  /** Opens the panel on `view`, or closes it when it is already open there. */
  onToggle(view: ProblemsView): void;
}

interface StatusBarProps {
  readonly diagnostics: StatusProblems | null;
  /** Null when the active tab has no canvas. */
  readonly nodes: number | null;
  readonly channels: number | null;
  readonly languageVersion: string | undefined;
}

export function formatCount(
  count: number,
  singular: string,
  plural: string,
  none?: string,
): string {
  if (count === 0 && none !== undefined) return none;
  return `${count} ${count === 1 ? singular : plural}`;
}

export const PROBLEMS_PANEL_ID = "problems-panel";
const PROBLEMS_FAILURE_ID = "problems-failure";
export const statusLinkId = (view: ProblemsView): string => `status-${view}`;

function ProblemsGlyph({ counts }: { counts: ProblemCounts }): JSX.Element {
  if (counts.problems === 0) return <CheckIcon />;
  const severity = counts.errors > 0 ? "error" : "warning";
  return <span aria-hidden="true">{SEVERITY_GLYPHS[severity]}</span>;
}

function ProblemCounters({
  diagnostics,
}: {
  diagnostics: StatusProblems;
}): JSX.Element {
  const { status, counts, open, onToggle } = diagnostics;
  if (status === "loading")
    return <span className="status-item">Checking for problems…</span>;
  if (status === "failed")
    return (
      <span
        className="status-item"
        title={diagnostics.message ?? undefined}
        aria-describedby={diagnostics.message ? PROBLEMS_FAILURE_ID : undefined}
      >
        Problems unavailable
        {diagnostics.message ? (
          <span id={PROBLEMS_FAILURE_ID} className="visually-hidden">
            {`: ${diagnostics.message}`}
          </span>
        ) : null}
      </span>
    );
  const link = (view: ProblemsView, title?: string) => ({
    type: "button" as const,
    id: statusLinkId(view),
    className: "status-item status-link",
    "aria-controls": PROBLEMS_PANEL_ID,
    "aria-expanded": open === view,
    title,
    onClick: () => onToggle(view),
  });
  return (
    <>
      <button
        {...link(
          "problems",
          `${formatCount(counts.errors, "error", "errors")}, ${formatCount(counts.warnings, "warning", "warnings")}`,
        )}
        data-count={counts.problems}
      >
        <ProblemsGlyph counts={counts} />
        {formatCount(counts.problems, "problem", "problems", "No problems")}
      </button>
      <button {...link("suggestions")} data-count={counts.suggestions}>
        {formatCount(
          counts.suggestions,
          "suggestion",
          "suggestions",
          "No suggestions",
        )}
      </button>
    </>
  );
}

export function StatusBar({
  diagnostics,
  nodes,
  channels,
  languageVersion,
}: StatusBarProps): JSX.Element {
  return (
    <footer className="status-bar" data-diagnostics={diagnostics?.status}>
      <div className="status-group">
        {diagnostics === null ? (
          <>
            <span className="status-item">
              <CheckIcon />
              No problems
            </span>
            <span className="status-item">No suggestions</span>
          </>
        ) : (
          <ProblemCounters diagnostics={diagnostics} />
        )}
        {nodes === null || channels === null ? null : (
          <span className="status-item">
            {formatCount(nodes, "node", "nodes")} ·{" "}
            {formatCount(channels, "channel", "channels")}
          </span>
        )}
      </div>
      {languageVersion === undefined ? null : (
        <span className="status-item">Nextflow {languageVersion}</span>
      )}
    </footer>
  );
}
