import type { ParseProblem, RefusalCode } from "@nf-builder/lang-core";

/** A command that cannot be applied, with what to tell the user. `applyCommand` turns it into a refusal result. */
export class EditRefusal extends Error {
  readonly code: RefusalCode;
  readonly path: string | null;
  readonly problems: readonly ParseProblem[];

  constructor(
    code: RefusalCode,
    message: string,
    path: string | null = null,
    problems: readonly ParseProblem[] = [],
  ) {
    super(message);
    this.name = "EditRefusal";
    this.code = code;
    this.path = path;
    this.problems = problems;
  }
}
