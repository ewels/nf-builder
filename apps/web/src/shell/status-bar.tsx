import type { JSX } from "react";
import { CheckIcon } from "./icons";

export interface StatusBarProps {
  readonly problems: number;
  readonly suggestions: number;
  readonly nodes: number;
  readonly channels: number;
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

export function StatusBar({
  problems,
  suggestions,
  nodes,
  channels,
  languageVersion,
}: StatusBarProps): JSX.Element {
  return (
    <footer className="status-bar">
      <div className="status-group">
        <span className="status-item">
          {problems === 0 ? <CheckIcon /> : null}
          {formatCount(problems, "problem", "problems", "No problems")}
        </span>
        <span className="status-item">
          {formatCount(
            suggestions,
            "suggestion",
            "suggestions",
            "No suggestions",
          )}
        </span>
        <span className="status-item">
          {formatCount(nodes, "node", "nodes")} ·{" "}
          {formatCount(channels, "channel", "channels")}
        </span>
      </div>
      {languageVersion === undefined ? null : (
        <span className="status-item">Nextflow {languageVersion}</span>
      )}
    </footer>
  );
}
