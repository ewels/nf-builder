// Comparing and reading forms (F-303, UX-44).
import type { DeclarationForm } from "@nf-builder/lang-core";

/** Whether Apply has anything to do: forms are plain data, so equal JSON is equal forms. */
export const formChanged = (a: DeclarationForm, b: DeclarationForm): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);

/** The origin of each input row, in row order: where the input was, null for a new one. */
export const inputOrigins = (form: DeclarationForm): (number | null)[] =>
  form.inputs.map((row) => row.origin);
