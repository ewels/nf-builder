// Advice appended to parse and include messages (F-112, LA-30, AR-03). Messages keep nf-lang's wording as their start;
// the clause after ` -- ` says what to do, in nf-lang's own form. Messages that already have one are left alone.

const GENERIC_PARSE_ADVICE =
  "check the syntax around this point, or edit the file as text";

/** One row per parser, lexer and builder message the pack can produce: the first matching pattern gives the advice. */
export const PARSE_ADVICE: readonly (readonly [RegExp, string])[] = [
  [
    /^Unexpected input: /,
    "check for a missing or misplaced symbol, keyword or closing bracket",
  ],
  [
    /^Unexpected character: /,
    "remove the character, or put it inside a string",
  ],
  [
    /^Invalid escape sequence: /,
    "use a valid escape sequence, or write `\\\\` for a literal backslash",
  ],
  [/^Number of value .* does not fit in the range of /, "use a smaller number"],
  [/^out of range$/, "use a smaller number"],
  [
    /^Duplicated named argument /,
    "remove the repeated argument, or give it a different name",
  ],
  [/^Empty list literal should not contain any comma/, "write it as `[]`"],
  [
    /^Entry workflow cannot have an? (take|emit) section/,
    "remove the section, or give the workflow a name",
  ],
  [
    /^Entry workflow defined more than once/,
    "keep one workflow without a name and name the others",
  ],
  [
    /^Every (emit|output) must be assigned to a name when there are multiple/,
    "give each one a name, as in `name = expression`",
  ],
  [
    /^Feature flag value must be a literal value/,
    "use a number, a string, `true` or `false`",
  ],
  [
    /^(If statements|Try-catch blocks|Variable declarations) cannot be mixed with config statements/,
    "remove it from the config file, or set the value with an assignment",
  ],
  [
    /^Config settings must be assigned with an equals sign/,
    "write `name = value`",
  ],
  [/^Incomplete (declaration|expression|statement)/, "finish it, or remove it"],
  [
    /^Invalid (agent|process|stage) directive/,
    "write a directive as its name followed by its arguments",
  ],
  [
    /^Invalid input declaration in typed process/,
    "write an input as `name: Type`",
  ],
  [
    /^Invalid output declaration/,
    "write an output as a name, an assignment or an expression",
  ],
  [
    /^Invalid parameter declaration/,
    "write a parameter as `name: Type`, optionally followed by `= value`",
  ],
  [
    /^Invalid process input/,
    "start the input with a qualifier such as `val`, `path` or `tuple`",
  ],
  [/^Invalid process topic statement/, "write it as `value >> 'topic'`"],
  [
    /^Invalid workflow take/,
    "write a take as a name, or as `name: Type` in a typed workflow",
  ],
  [
    /(Legacy parameter declarations cannot be mixed with the params block|Params block cannot be mixed with legacy parameter declarations)/,
    "use either a `params` block or `params.name = value` assignments in one script",
  ],
  [/^Missing (agent|record) body/, "add the body between braces"],
  [/^Missing process script body/, "add the script after the `script:` label"],
  [/^Missing field type/, "write the field as `name: Type`"],
  [
    /^Named workflow cannot have an? (publish|onComplete|onError) section/,
    "move the section to the entry workflow",
  ],
  [/^Nested parenthesis is not allowed/, "remove the extra parentheses"],
  [
    /^(Output|Params) block cannot be defined without an entry workflow/,
    "add an entry workflow, which is a `workflow` without a name",
  ],
  [/ (block )?defined more than once/, "keep only one"],
  [
    /^Process tuple input must have more than one component/,
    "add another component, or use a single input",
  ],
  [
    /^The `(stage|topic):` section is not supported in a legacy process/,
    "set `nextflow.enable.types = true` to use typed processes in this script, or remove the section",
  ],
  [
    /^The `script:` or `exec:` label is required/,
    "add a `script:` or `exec:` section",
  ],
  [/is not allowed as an identifier/, "rename it"],
  [
    /^`(for|while)` loops are no longer supported/,
    "rewrite it with channel operators or collection methods",
  ],
  [
    /^`switch` statements are no longer supported/,
    "use `if` and `else if` instead",
  ],
];

/** Include advice by code; nf-lang's wording stays the start of the message. */
export const INCLUDE_ADVICE: Readonly<Record<string, string>> = {
  "include-target": "create the file, or correct the path in the include",
  "include-not-parsed": "fix the syntax errors in that file first",
  "include-name": "check the name, or define it in that file",
  // engine-owned: an internal problem or a rule that threw (IO-14)
  internal: "it is kept as written; edit it as text",
};

/** The message with advice appended, unless it already has a ` -- ` clause or the code takes no pack advice. */
export function advise(code: string, message: string): string {
  if (message.includes(" -- ")) return message;
  if (code === "syntax") {
    const row = PARSE_ADVICE.find(([pattern]) => pattern.test(message));
    return `${message} -- ${row ? row[1] : GENERIC_PARSE_ADVICE}`;
  }
  const advice = INCLUDE_ADVICE[code];
  return advice === undefined ? message : `${message} -- ${advice}`;
}
