// Include resolution types shared by the engine and the packs (AR-03, F-105). Packs implement `IncludeRules`.
import type {
  AgentDef,
  EnumDef,
  Expression,
  FunctionDef,
  ParamsBlock,
  ProcessDef,
  RecordDef,
  ScriptAst,
  WorkflowDef,
} from "./ast/script.ts";
import type { Unparsed } from "./ast/unparsed.ts";

/** The files of a project, by project-relative POSIX path. */
export interface ProjectTree {
  isFile(path: string): boolean;
  isDirectory(path: string): boolean;
}

/** What an include source names. `path` is project-relative POSIX; paths outside the project start with `..` or `/`. */
export type IncludeTarget =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly module: string | null;
    }
  | {
      readonly kind: "missing";
      /** The path that was checked; null when the source is not a valid module reference. */
      readonly path: string | null;
      readonly module: string | null;
      readonly message: string;
    }
  | { readonly kind: "plugin"; readonly plugin: string }
  | { readonly kind: "external" };

export type IncludableDeclaration =
  | ProcessDef
  | WorkflowDef
  | AgentDef
  | FunctionDef
  | RecordDef
  | EnumDef
  | ParamsBlock
  | Unparsed
  /** The unnamed workflow of a script with statements (nf-lang wraps them); includable as `workflow`. */
  | ScriptAst;

export interface Includable {
  readonly declaration: IncludableDeclaration;
  /** The entry workflow or the params block: a pipeline include (26.10). */
  readonly pipeline: boolean;
}

export interface IncludeRules {
  /** Never throws. `from` is the including file's path. */
  readonly scriptInclude: (
    from: string,
    source: string,
    tree: ProjectTree,
  ) => IncludeTarget;
  readonly configInclude: (
    from: string,
    source: Expression,
    tree: ProjectTree,
  ) => IncludeTarget;
  /** The names a script can be included by, first match wins. */
  readonly includable: (ast: ScriptAst) => ReadonlyMap<string, Includable>;
  readonly notParsed: (path: string) => string;
  readonly notDefined: (name: string, path: string) => string;
}
