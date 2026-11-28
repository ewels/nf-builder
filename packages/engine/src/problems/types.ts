// The problems panel's pure views over diagnostics (F-309, UX-03). Plain data; none holds file text (AR-30).
import type { Diagnostic } from "@nf-builder/lang-core";

export type ProblemsView = "problems" | "suggestions";

export interface ProblemGroup {
  readonly path: string;
  readonly diagnostics: readonly Diagnostic[];
  /** The registry module reference of the folder holding the file; null for the project's own files (F-405). */
  readonly module: string | null;
}

export interface ProblemCounts {
  readonly errors: number;
  readonly warnings: number;
  readonly suggestions: number;
  /** Errors plus warnings (UX-03). */
  readonly problems: number;
}

export interface ProblemSections {
  readonly problems: readonly ProblemGroup[];
  readonly suggestions: readonly ProblemGroup[];
  readonly counts: ProblemCounts;
}

export type ProblemTarget =
  | {
      readonly kind: "workflow";
      readonly path: string;
      /** Null for the entry workflow. */
      readonly workflow: string | null;
      /** True when the diagnostic lies inside the workflow's own range. */
      readonly inside: boolean;
    }
  | { readonly kind: "file"; readonly path: string };
