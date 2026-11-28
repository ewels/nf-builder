// Types for the Files view (F-210). Plain, clone-safe data; nothing here depends on a language pack version.
import type { SourceLanguage } from "@nf-builder/lang-core";
import type { FileSummary } from "../service/types";

/** Why a file can't be edited: `managed` files under `.nf-builder/` are written by nf-builder itself (F-207). */
export type ReadOnlyReason = "managed";

/** A folder of a registry module (UX-16, AR-03): `module` is its reference, such as `nf-core/fastqc`. */
export interface RegistryFolder {
  readonly path: string;
  readonly module: string;
}

/** What the Files view lists: every file with its parse status, and the registry module folders. No file text. */
export interface ProjectFiles {
  readonly revision: number;
  readonly files: readonly FileSummary[];
  readonly registry: readonly RegistryFolder[];
}

/** One visible row of the tree. Levels, set sizes and positions start at 1 (WAI-ARIA tree). */
export interface FileTreeRow {
  readonly path: string;
  readonly name: string;
  readonly kind: "folder" | "file";
  readonly level: number;
  readonly setSize: number;
  readonly posInSet: number;
  readonly parent: string | null;
  /** Null for files. */
  readonly expanded: boolean | null;
  /** Null for folders. */
  readonly language: SourceLanguage | null;
  /** The module reference of a registry folder. */
  readonly registry: string | null;
  /** The parse problems of a file. */
  readonly problems: number;
  /** The file didn't parse completely (UX-16's error badge). */
  readonly failed: boolean;
  readonly readOnly: ReadOnlyReason | null;
}

export type AddConflictReason = "managed" | "folder" | "under-file";

export interface AddConflict {
  /** The target path that was skipped. */
  readonly path: string;
  readonly reason: AddConflictReason;
  /** For `under-file`: the file that stands where a folder is needed. */
  readonly ancestor?: string;
}

export interface AddPlan {
  readonly writes: readonly { readonly from: string; readonly to: string }[];
  /** Targets that already exist and are replaced. */
  readonly replaced: readonly string[];
  readonly conflicts: readonly AddConflict[];
}
