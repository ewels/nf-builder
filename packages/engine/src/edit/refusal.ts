import type {
  FieldProblem,
  ParseProblem,
  RefusalCode,
} from "@nf-builder/lang-core";

/** A command that cannot be applied, with what to tell the user. `applyCommand` turns it into a refusal result. */
export class EditRefusal extends Error {
  readonly code: RefusalCode;
  readonly path: string | null;
  readonly problems: readonly ParseProblem[];
  readonly fields: readonly FieldProblem[] | undefined;

  constructor(
    code: RefusalCode,
    message: string,
    path: string | null = null,
    problems: readonly ParseProblem[] = [],
    fields?: readonly FieldProblem[],
  ) {
    super(message);
    this.name = "EditRefusal";
    this.code = code;
    this.path = path;
    this.problems = problems;
    this.fields = fields;
  }
}
