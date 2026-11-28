// Edit commands (AR-20, AR-21, F-111): plain, clone-safe data. The engine applies them to a project model and returns
// text patches plus their inverse (AR-23). Nothing here depends on a language pack version.
import type { ParseProblem } from "./ast/parse-result.ts";
import type { DeclarationForm, FieldProblem } from "./declaration-form.ts";
import type { PortRef } from "./projection.ts";

/** A workflow to edit: `workflow` is its name, or null for the unnamed entry workflow. */
export interface WorkflowTarget {
  readonly path: string;
  readonly workflow: string | null;
}

/** Create `modules/local/<name>/main.nf` with a typed process and include it from `caller` (LA-12). */
export interface CreateProcess {
  readonly kind: "createProcess";
  readonly name: string;
  readonly caller: string;
}

/** Create `subworkflows/local/<name>/main.nf` with a named workflow and include it from `caller` (LA-12). */
export interface CreateWorkflow {
  readonly kind: "createWorkflow";
  readonly name: string;
  readonly caller: string;
}

/** Append a bare call of `callee` to the target workflow's `main`. */
export interface AddCall {
  readonly kind: "addCall";
  readonly target: WorkflowTarget;
  readonly callee: string;
}

/** Feed the `from` output port into the `to` input port (UX-25). Both are projection ports of the target workflow. */
export interface Connect {
  readonly kind: "connect";
  readonly target: WorkflowTarget;
  readonly from: PortRef;
  readonly to: PortRef;
}

/** Remove the argument that feeds an input port. */
export interface Disconnect {
  readonly kind: "disconnect";
  readonly target: WorkflowTarget;
  readonly port: PortRef;
}

/** Remove a node's statement, or clear the argument a nested node is. */
export interface DeleteNode {
  readonly kind: "deleteNode";
  readonly target: WorkflowTarget;
  /** A projection node id. */
  readonly node: string;
}

/** Rename a declaration, its references and the include entries that name it. */
export interface RenameDeclaration {
  readonly kind: "renameDeclaration";
  readonly path: string;
  readonly name: string;
  readonly newName: string;
}

/**
 * Replace a declaration's parts with the Configure form's rows (F-303, UX-44). Rows whose fields are unchanged keep their
 * text and comments; the form's `name` is not applied (a rename is `RenameDeclaration`, in the same group).
 */
export interface UpdateDeclaration {
  readonly kind: "updateDeclaration";
  readonly path: string;
  /** The declaration as it is now named. */
  readonly name: string;
  readonly form: DeclarationForm;
}

/**
 * Replace one declaration's text, doc comment included, with text the user wrote in the popup's Code tab (F-304, UX-43,
 * UX-44). The text is applied as written, not reprinted; it must parse alone as one declaration of the same name and kind.
 */
export interface ReplaceDeclaration {
  readonly kind: "replaceDeclaration";
  readonly path: string;
  /** The declaration as it is now named. */
  readonly name: string;
  readonly text: string;
}

/** Replace a file's whole text (the Code tab). */
export interface ReplaceFileText {
  readonly kind: "replaceFileText";
  readonly path: string;
  readonly text: string;
}

/** A process selector as the form addresses it (F-601, FI-06): `withLabel: big_mem`. */
export interface ConfigSelectorRef {
  readonly kind: "withName" | "withLabel";
  readonly pattern: string;
}

/** Where in a config file an option lives: the top level or a profile, and the process selector inside it (F-601). */
export interface ConfigContext {
  readonly profile: string | null;
  readonly selector: ConfigSelectorRef | null;
}

export type MemoryUnitName =
  | "B"
  | "KB"
  | "MB"
  | "GB"
  | "TB"
  | "PB"
  | "EB"
  | "ZB";
export type DurationUnitName = "ms" | "s" | "min" | "h" | "d";

/** A config value a form can write (F-601, FI-02), as the kinds of the plan's 2.4 table. */
export type ConfigValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "decimal"; readonly text: string }
  | {
      readonly kind: "memory";
      readonly amount: number;
      readonly unit: MemoryUnitName;
    }
  | {
      readonly kind: "duration";
      readonly amount: number;
      readonly unit: DurationUnitName;
    }
  | { readonly kind: "stringList"; readonly values: readonly string[] }
  | {
      readonly kind: "map";
      readonly entries: readonly {
        readonly key: string;
        readonly value: ConfigValue;
      }[];
    };

/** Set a config option (F-601, FI-02): replaces its value where it is set, else places a new statement (plan 2.6). `option` is the full option path as the validator names it, also inside a selector. */
export interface SetConfigOption {
  readonly kind: "setConfigOption";
  readonly path: string;
  readonly context: ConfigContext;
  readonly option: readonly string[];
  readonly value: ConfigValue;
}

/** Remove every statement that sets an option in a context, with the comments attached to them. */
export interface RemoveConfigOption {
  readonly kind: "removeConfigOption";
  readonly path: string;
  readonly context: ConfigContext;
  readonly option: readonly string[];
}

/** Ensures the blocks exist: `scope` within the context, or the profile or selector block itself when `scope` is empty. */
export interface AddConfigBlock {
  readonly kind: "addConfigBlock";
  readonly path: string;
  readonly context: ConfigContext;
  readonly scope: readonly string[];
}

/** Add `id '<id>'` to the `plugins` block, which is created when there is none. */
export interface AddConfigPlugin {
  readonly kind: "addConfigPlugin";
  readonly path: string;
  readonly id: string;
}

export interface RemoveConfigPlugin {
  readonly kind: "removeConfigPlugin";
  readonly path: string;
  readonly id: string;
}

/** Create an empty file (UX-16); a new folder is its `.gitkeep`. */
export interface CreateFile {
  readonly kind: "createFile";
  readonly path: string;
}

/**
 * Move a file, or every file under a folder, to `newPath` (F-303, LA-12). Include sources that name a moved script are
 * rewritten in the includers and in the moved scripts themselves.
 */
export interface MoveFile {
  readonly kind: "moveFile";
  readonly path: string;
  readonly newPath: string;
}

export type EditCommand =
  | CreateProcess
  | AddCall
  | Connect
  | Disconnect
  | DeleteNode
  | RenameDeclaration
  | ReplaceFileText
  | SetConfigOption
  | RemoveConfigOption
  | AddConfigBlock
  | AddConfigPlugin
  | RemoveConfigPlugin
  | CreateFile
  | CreateWorkflow
  | UpdateDeclaration
  | ReplaceDeclaration
  | MoveFile;

export const EDIT_COMMAND_KINDS = [
  "createProcess",
  "addCall",
  "connect",
  "disconnect",
  "deleteNode",
  "renameDeclaration",
  "replaceFileText",
  "setConfigOption",
  "removeConfigOption",
  "addConfigBlock",
  "addConfigPlugin",
  "removeConfigPlugin",
  "createFile",
  "createWorkflow",
  "updateDeclaration",
  "replaceDeclaration",
  "moveFile",
] as const satisfies readonly EditCommand["kind"][];

/** Replace `text.slice(start, end)`: UTF-16 offsets into the file as it was before the patch. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** One change to one file; a list holds at most one patch per path. `edit`s are sorted and do not overlap. */
export type TextPatch =
  | {
      readonly kind: "edit";
      readonly path: string;
      readonly edits: readonly TextEdit[];
    }
  | { readonly kind: "create"; readonly path: string; readonly text: string }
  | { readonly kind: "delete"; readonly path: string };

/** A file's text after a command; null when the command deletes it. */
export interface FileText {
  readonly path: string;
  readonly text: string | null;
}

export type RefusalCode =
  | "not-found"
  | "invalid"
  | "does-not-parse"
  | "mixed-definitions"
  | "internal";

export type CommandResult =
  | {
      readonly ok: true;
      readonly patches: readonly TextPatch[];
      /** Applying these restores the exact previous bytes (AR-23). */
      readonly inverse: readonly TextPatch[];
      /** The changed and created files' new text, and deleted ones with null. */
      readonly files: readonly FileText[];
    }
  | {
      readonly ok: false;
      readonly code: RefusalCode;
      /** What was refused and what to do about it. */
      readonly message: string;
      readonly path: string | null;
      /** The new parse problems, for `does-not-parse` and `mixed-definitions`. */
      readonly problems: readonly ParseProblem[];
      /** The form fields a refused `UpdateDeclaration` is about, for the popup to mark. */
      readonly fields?: readonly FieldProblem[];
    };

/** Version-specific text a pack provides for new files (LA-02). */
export interface Scaffold {
  /** A new typed process in its own script (LA-12). `name` is a valid identifier. */
  process(name: string): string;
  /** A new named workflow in its own script (LA-12). `name` is a valid identifier. */
  workflow(name: string): string;
}
