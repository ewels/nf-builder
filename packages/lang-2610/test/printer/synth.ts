// Trees no parse produced (F-110, plan 4.3 and 5.2): every node carries `NO_RANGE`, so the printer lays them out afresh.
// `synth` is keyed by the path of the printed file in the `printer` tree; a tree that edits a parsed file gives the text
// its positioned nodes were parsed from, whose layout the printer then uses for them.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Argument,
  type AssignmentOperator,
  type Comment,
  type Declaration,
  type Expression,
  type Include,
  type MethodCall,
  type NamedOutput,
  NO_RANGE,
  type ScriptAst,
  type Section,
  type SectionLabel,
  type Statement,
  type TypedName,
  type TypeRef,
  type WorkflowDef,
} from "@nf-builder/lang-core";
import { parseScriptAst } from "../../src/ast/index.ts";

const range = NO_RANGE;

export const identifier = (name: string) => ({
  kind: "Identifier" as const,
  range,
  name,
});
export const variable = (name: string) => ({
  kind: "Variable" as const,
  range,
  name,
});
export const string = (value: string, quote: "'" | '"' = "'") => ({
  kind: "String" as const,
  range,
  text: `${quote}${value}${quote}`,
  value,
  quote,
});
export const typeRef = (
  name: string,
  typeArguments: TypeRef[] = [],
  nullable = false,
): TypeRef => ({ kind: "TypeRef", range, name, typeArguments, nullable });
export const typedName = (name: string, type: TypeRef | null): TypedName => ({
  kind: "TypedName",
  range,
  name: identifier(name),
  type,
});
export const section = <T>(
  label: SectionLabel | null,
  items: T[],
): Section<T> => ({
  kind: "Section",
  range,
  label,
  labelRange: null,
  items,
});

export const named = (name: string, value: Expression): Argument => ({
  kind: "NamedArgument",
  range,
  name: identifier(name),
  value,
});
export function call(
  name: string,
  args: Argument[] = [],
  receiver: Expression | null = null,
): MethodCall {
  return {
    kind: "MethodCall",
    range,
    receiver,
    navigation: receiver ? "." : null,
    method: identifier(name),
    args,
    parens: true,
    trailingComma: false,
    closures: [],
  };
}
export const property = (object: Expression, name: string): Expression => ({
  kind: "Property",
  range,
  object,
  navigation: ".",
  property: identifier(name),
});
export const assign = (
  target: string,
  value: Expression,
  operator: AssignmentOperator = "=",
): Statement => ({
  kind: "Assignment",
  range,
  target: variable(target),
  operator,
  value,
});
export const expressionStatement = (expression: Expression): Statement => ({
  kind: "ExpressionStatement",
  range,
  expression,
});
export const namedOutput = (
  name: string,
  type: TypeRef | null,
  value: Expression | null,
): NamedOutput => ({
  kind: "NamedOutput",
  range,
  name: identifier(name),
  type,
  value,
});

export const doc = (text: string): Comment => ({
  kind: "doc",
  text,
  range,
  ownLine: true,
});

export const featureFlag = (name: string, value: boolean): Declaration => ({
  kind: "FeatureFlag",
  range,
  name: identifier(name),
  value: { kind: "Boolean", range, value },
});
export const include = (names: string[], source: string): Include => ({
  kind: "Include",
  range,
  entries: names.map((name) => ({
    kind: "IncludeEntry" as const,
    range,
    name: identifier(name),
    alias: null,
  })),
  source: string(source),
});

export const script = (body: ScriptAst["body"]): ScriptAst => ({
  kind: "Script",
  range,
  shebang: null,
  body,
  comments: [],
  typesEnabled: body.some(
    (d) => d.kind === "FeatureFlag" && d.name.name === "nextflow.enable.types",
  ),
});

const typesFlag = () => featureFlag("nextflow.enable.types", true);
const channelOf = (arg: TypeRef) => typeRef("Channel", [arg]);

/** A workflow of the typed kind: `main:` is labelled only when another section follows (as parsed text does). */
function workflow(
  name: string | null,
  parts: {
    takes?: TypedName[];
    main: Statement[];
    emits?: NamedOutput[];
    publishers?: NamedOutput[];
  },
): WorkflowDef {
  const others = Boolean(
    parts.takes?.length || parts.emits?.length || parts.publishers?.length,
  );
  return {
    kind: "Workflow",
    range,
    name: name ? identifier(name) : null,
    typed: true,
    takes: parts.takes ? section("take", parts.takes) : null,
    main: section(others ? "main" : null, parts.main),
    emits: parts.emits ? section("emit", parts.emits) : null,
    publishers: parts.publishers ? section("publish", parts.publishers) : null,
    onComplete: null,
    onError: null,
  };
}

/** The CreateProcess shape (LA-12, LA-50): types flag, a doc comment, a typed process and a record. */
function countLines(): ScriptAst {
  const process: Declaration = {
    kind: "Process",
    range,
    typed: true,
    name: identifier("COUNT_LINES"),
    leadingComments: [doc("/**\n * Count the lines of a file.\n */")],
    directives: null,
    inputs: section("input", [
      {
        kind: "RecordInput",
        range,
        fields: [
          typedName("id", typeRef("String")),
          typedName("text", typeRef("Path")),
        ],
        trailingComma: false,
      },
    ]),
    stage: null,
    outputs: section("output", [
      namedOutput(
        "lines",
        typeRef("Path"),
        call("file", [string("lines.txt")]),
      ),
    ]),
    topics: null,
    when: null,
    exec: section("script", [
      expressionStatement({
        kind: "GString",
        range,
        quote: '"""',
        parts: [
          {
            kind: "GStringText",
            range,
            text: "\n    wc -l ",
            value: "\n    wc -l ",
          },
          {
            kind: "Interpolation",
            range,
            braced: true,
            expression: variable("text"),
          },
          {
            kind: "GStringText",
            range,
            text: " > lines.txt\n    ",
            value: " > lines.txt\n    ",
          },
        ],
      }),
    ]),
    stub: null,
  };
  const record: Declaration = {
    kind: "Record",
    range,
    name: identifier("Counted"),
    fields: [
      typedName("id", typeRef("String")),
      typedName("lines", typeRef("Path")),
    ],
  };
  return script([typesFlag(), process, record]);
}

/** A typed workflow calling a legacy process with `tuple(meta, reads)` (LA-14). */
function legacyCall(): ScriptAst {
  return script([
    typesFlag(),
    include(
      ["FASTQC_LEGACY"],
      "../../la14/modules/local/fastqc_legacy/main.nf",
    ),
    workflow(null, {
      main: [
        assign("meta", call("record", [named("id", string("a"))])),
        assign("reads", call("file", [string("a.fastq")])),
        assign(
          "reports",
          call("FASTQC_LEGACY", [
            call("tuple", [variable("meta"), variable("reads")]),
          ]),
        ),
      ],
    }),
  ]);
}

function workflows(): ScriptAst {
  const strings = channelOf(typeRef("String"));
  const greeting: Expression = {
    kind: "GString",
    range,
    quote: '"',
    parts: [
      {
        kind: "Interpolation",
        range,
        braced: true,
        expression: property(variable("params"), "greeting"),
      },
      { kind: "GStringText", range, text: ", ", value: ", " },
      { kind: "Interpolation", range, braced: true, expression: variable("n") },
      { kind: "GStringText", range, text: "!", value: "!" },
    ],
  };
  const map: Expression = {
    ...call("map", [], variable("names")),
    closures: [
      {
        kind: "Closure",
        range,
        params: [
          {
            kind: "Parameter",
            range,
            name: identifier("n"),
            def: false,
            type: null,
            legacyType: null,
            defaultValue: null,
          },
        ],
        body: [expressionStatement(greeting)],
      },
    ],
  };
  return script([
    typesFlag(),
    include(["helper"], "../../typed/lib/a.nf"),
    include(["third"], "../../typed/lib/b.nf"),
    {
      kind: "ParamsBlock",
      range,
      params: [
        {
          kind: "Param",
          range,
          name: identifier("greeting"),
          type: typeRef("String"),
          defaultValue: string("Hello"),
        },
      ],
    },
    workflow("greet", {
      takes: [typedName("names", strings)],
      main: [assign("greetings", map)],
      emits: [namedOutput("greetings", strings, null)],
    }),
    workflow(null, {
      main: [
        assign(
          "names",
          call("of", [string("a"), string("b")], variable("channel")),
        ),
        assign("result", call("greet", [variable("names")])),
      ],
      publishers: [namedOutput("greetings", null, variable("result"))],
    }),
    {
      kind: "OutputBlock",
      range,
      outputs: [
        {
          kind: "Output",
          range,
          name: identifier("greetings"),
          type: strings,
          body: {
            kind: "Block",
            range,
            statements: [
              expressionStatement(call("path", [string("greetings")])),
            ],
          },
        },
      ],
    },
  ]);
}

const here = import.meta.dirname;

/** The edit of the base workflow: an include after the existing one and a call at the end of `main:`. */
function edited(): { ast: ScriptAst; text: string } {
  const text = readFileSync(join(here, "input/synth-base/main.nf"), "utf8");
  const parsed = parseScriptAst(text);
  if (!parsed.ok) throw new Error(parsed.errors[0]?.message);
  const body = [...parsed.ast.body];
  const lastInclude = body.map((d) => d.kind).lastIndexOf("Include");
  body.splice(
    lastInclude + 1,
    0,
    include(["COUNT_LINES"], "./modules/local/count_lines/main.nf"),
  );
  const index = body.findIndex((d) => d.kind === "Workflow");
  const wf = body[index] as WorkflowDef;
  const main = wf.main as Section<Statement>;
  const counted = assign(
    "counted",
    call("COUNT_LINES", [
      call("record", [
        named("id", string("a")),
        named("text", call("file", [string("a.txt")])),
      ]),
    ]),
  );
  body[index] = { ...wf, main: { ...main, items: [...main.items, counted] } };
  return { ast: { ...parsed.ast, body }, text };
}

export type Synth = { ast: ScriptAst; text?: string };

/** The printed files without an input, by path in the `printer` tree. `text` is the source an edited tree was parsed from. */
export const synth: Record<string, () => Synth> = {
  "synth/create-process/modules/local/count_lines/main.nf": () => ({
    ast: countLines(),
  }),
  "synth/create-process/main.nf": edited,
  "synth/workflow/main.nf": () => ({ ast: workflows() }),
  "synth/la14/main.nf": () => ({ ast: legacyCall() }),
};
