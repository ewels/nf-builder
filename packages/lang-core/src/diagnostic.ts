// A diagnostic (AR-05, F-105, F-112). In memory only: plain data that crosses the worker boundary.
import type { Range } from "./ast/range.ts";

export type DiagnosticSeverity = "error" | "warning" | "suggestion";

/** A replacement of `text.slice(start, end)` in the diagnosed text; offsets are UTF-16 offsets into that text. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A fix that edits one file's text. Offsets belong to the text that was diagnosed. */
export interface QuickFix {
  readonly title: string;
  /** Project-relative POSIX path of the file to edit. */
  readonly path: string;
  readonly edits: readonly TextEdit[];
}

export interface Diagnostic {
  /** Project-relative POSIX path of the file the diagnostic is in. */
  readonly path: string;
  readonly range: Range;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** A stable identifier, such as `include-target`. */
  readonly code: string;
  readonly fix?: QuickFix;
}
