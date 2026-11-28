// The Configure form of the edit popup (F-303, UX-41): plain, clone-safe data the engine reads from a declaration and
// writes back through `UpdateDeclaration`. Rows carry `origin`, the index of the AST item they came from (null for a
// new row), so the engine keeps an untouched row's node and comments and knows how inputs moved.
import type { ConfigValueKind } from "./config.ts";

export type FormSection =
  | "name"
  | "description"
  | "inputs"
  | "stage"
  | "outputs"
  | "topics"
  | "directives"
  | "script"
  | "stub";

/** A place in the form: the section, the row in it (null for the section itself) and the part of the row. */
export interface FormField {
  readonly section: FormSection;
  readonly row: number | null;
  readonly part: string | null;
}

export interface FieldProblem {
  readonly field: FormField;
  readonly message: string;
}

/** A row the form can't model: kept as written, shown read-only ("Edit it in the Code tab"). */
export interface CodeRow {
  readonly origin: number;
  readonly kind: "code";
  readonly text: string;
}

export type InputRow =
  | {
      readonly origin: number | null;
      readonly kind: "named";
      readonly name: string;
      /** The type without its `?`. */
      readonly type: string;
      readonly nullable: boolean;
    }
  | CodeRow;

export interface StageRow {
  readonly origin: number | null;
  readonly directive: string;
  readonly args: string;
}

export interface OutputRow {
  readonly origin: number | null;
  /** Empty only for a sole unnamed output. */
  readonly name: string;
  /** Empty when the output has no type. */
  readonly type: string;
  readonly value: string;
}

export type TopicRow =
  | {
      readonly origin: number | null;
      readonly kind: "emit";
      readonly value: string;
      readonly topic: string;
    }
  | CodeRow;

export type DirectiveRow =
  | {
      readonly origin: number | null;
      readonly kind: "named";
      readonly name: string;
      readonly args: string;
      readonly deprecated: boolean;
      readonly known: boolean;
    }
  | CodeRow;

export interface TypedProcessForm {
  readonly kind: "typedProcess";
  readonly name: string;
  /** The doc comment's text before its first tag. */
  readonly description: string;
  /** The doc comment from its first tag on, kept as it is; null when there is none. */
  readonly docTags: string | null;
  readonly inputs: readonly InputRow[];
  readonly stage: readonly StageRow[];
  readonly outputs: readonly OutputRow[];
  readonly topics: readonly TopicRow[];
  readonly directives: readonly DirectiveRow[];
  readonly script: {
    readonly label: "script" | "exec" | "shell";
    readonly text: string;
  };
  /** Null when the process has no stub. */
  readonly stub: string | null;
  /** What the form keeps as written without a row ("when: section"). */
  readonly kept: readonly string[];
}

/** F-305 and F-306 extend this union. */
export type DeclarationForm = TypedProcessForm;

export interface DirectiveChoice {
  readonly name: string;
  readonly summary: string;
  readonly kind: ConfigValueKind;
  /** What a new row starts with; empty when the user has to enter a value. */
  readonly defaultArgs: string;
}

export interface StageChoice {
  readonly name: string;
  readonly hint: string;
}

export interface FormChoices {
  readonly directives: readonly DirectiveChoice[];
  readonly stage: readonly StageChoice[];
  /** Type names to suggest for an input. */
  readonly types: readonly string[];
}
