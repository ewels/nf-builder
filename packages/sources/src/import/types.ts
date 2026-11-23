export type FixedSkipReason =
  | "too-large"
  | "binary"
  | "unsafe-path"
  | "duplicate"
  | "unsupported";
export type SkipReason = "ignored" | FixedSkipReason;

export interface ImportCandidate {
  readonly path: string;
  readonly size: number;
  readonly text: string | null;
  readonly reason: FixedSkipReason | null;
}

export interface ImportedFile {
  readonly path: string;
  readonly text: string;
}

export interface SkipGroup {
  readonly reason: SkipReason;
  readonly count: number;
  readonly bytes: number;
  readonly paths: readonly string[];
}

export interface IgnoreProblem {
  readonly line: number;
  readonly text: string;
  readonly message: string;
}

export interface ImportSummary {
  readonly source: string;
  readonly stripped: string | null;
  readonly files: number;
  readonly bytes: number;
  readonly skipped: readonly SkipGroup[];
  readonly ignore: string;
  readonly ignoreProblems: readonly IgnoreProblem[];
}

export type ImportRefusalCode =
  | "too-big"
  | "too-many-entries"
  | "too-large-uncompressed"
  | "not-zip"
  | "damaged"
  | "too-slow"
  | "gone";

export interface ImportRefusal {
  readonly ok: false;
  readonly code: ImportRefusalCode;
  readonly message: string;
}
