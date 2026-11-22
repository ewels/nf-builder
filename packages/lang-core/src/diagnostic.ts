// A diagnostic from the semantic model (AR-05, F-105). In memory only; quick fixes and other sources come with F-112.
import type { Range } from "./ast/range.ts";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  /** Project-relative POSIX path of the file the diagnostic is in. */
  readonly path: string;
  readonly range: Range;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** A stable identifier, such as `include-target`. */
  readonly code: string;
}
