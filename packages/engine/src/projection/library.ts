// The dataflow library: operators, factories, functions and typed outputs, all read from the pack's script catalogue
// (LA-02: no version literals here). Result types follow the declared signatures with generic substitution, as nf-lang's
// type checker does; `DataflowOpResolver` only refines `combine`, `groupBy` and `join`, which this doesn't (Apache-2.0,
// see docs/licences.md).

import type {
  CatalogueEntry,
  Dataflow,
  FlowType,
  OperatorEntry,
  ScriptCatalogue,
  Signature,
  TypeExpr,
} from "@nf-builder/lang-core";
import { parseTypeText, UNKNOWN, WILDCARD, wrapFlow } from "./types";

export interface OperatorArguments {
  /** Positional arguments that aren't closures, in order; null when the type is unknown. */
  readonly positional: readonly (FlowType | null)[];
  /** Named arguments are present; together they count as one `Map` argument. */
  readonly named: boolean;
  readonly closures: number;
}

export interface DataflowLibrary {
  isFactory(namespace: string, name: string): boolean;
  /** A catalogue operator of the receiver's dataflow type; an unknown (or plain) receiver accepts either. */
  isOperator(name: string, receiver: Dataflow | null): boolean;
  factoryType(
    name: string,
    args: readonly (TypeExpr | null)[],
    named: boolean,
  ): FlowType;
  operatorType(
    name: string,
    receiver: FlowType,
    args: OperatorArguments,
  ): FlowType | "void";
  /** The parameter names of the first overload an operator call fits (for port labels); null when none fits. */
  parameterNames(
    name: string,
    receiver: FlowType,
    args: OperatorArguments,
  ): readonly string[] | null;
  /** The return type of a catalogue function (`file` gives `Path`); null for `void` or an unknown name. */
  functionType(name: string): TypeExpr | null;
  /** `stdout`, `env` and `eval` in a typed output. */
  typedOutputType(name: string): TypeExpr | null;
}

const isGeneric = (name: string): boolean => /^[A-Z]$/.test(name);
const baseName = (type: string): string => type.replace(/<.*$/, "");

function substitute(type: TypeExpr, element: TypeExpr | null): TypeExpr {
  if (type.args.length === 0 && isGeneric(type.name))
    return type.name === "E" || type.name === "V"
      ? (element ?? WILDCARD)
      : WILDCARD;
  return { ...type, args: type.args.map((a) => substitute(a, element)) };
}

/** A return type text as a flow type; `void` is null. A top-level `?` element is "not known". */
function flowOf(returns: string, element: TypeExpr | null): FlowType | null {
  if (returns === "void") return null;
  const type = substitute(parseTypeText(returns), element);
  if (type.name === "Channel" || type.name === "Value") {
    const inner = type.args[0] ?? null;
    return wrapFlow(
      type.name === "Channel" ? "channel" : "value",
      inner === null || inner.name === "?" ? null : inner,
    );
  }
  return wrapFlow("plain", type);
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** The result of several candidate overloads: a type they all agree on, else their shared kind, else unknown. */
function merge(results: readonly (FlowType | null)[]): FlowType | "void" {
  if (results.length === 0) return UNKNOWN;
  if (results.every((r) => r === null)) return "void";
  const flows = results.filter((r): r is FlowType => r !== null);
  if (flows.length !== results.length) return UNKNOWN;
  const [first] = flows as [FlowType, ...FlowType[]];
  if (flows.every((f) => same(f, first))) return first;
  const kind = first.dataflow;
  return kind !== null && flows.every((f) => f.dataflow === kind)
    ? wrapFlow(kind, null)
    : UNKNOWN;
}

const isMap = (type: string): boolean => baseName(type) === "Map";

/** Whether a known argument kind is ruled out by a `Channel` or `Value` parameter. */
function kindFits(parameter: string, argument: FlowType | null): boolean {
  const base = baseName(parameter);
  if (argument === null || argument.dataflow === null) return true;
  if (base === "Channel") return argument.dataflow === "channel";
  if (base === "Value") return argument.dataflow === "value";
  return true;
}

function operatorCandidates(
  entries: readonly OperatorEntry[],
  args: OperatorArguments,
): Signature[] {
  const total = args.positional.length + (args.named ? 1 : 0) + args.closures;
  const fits = (s: Signature): boolean => {
    if (s.parameters.length !== total) return false;
    const [first] = s.parameters;
    if (args.named && !(first && isMap(first.type))) return false;
    const offset = args.named ? 1 : 0;
    return args.positional.every((a, i) => {
      const p = s.parameters[i + offset];
      return p === undefined || kindFits(p.type, a);
    });
  };
  const all = entries.flatMap((e) => e.signatures).filter(fits);
  if (args.named) return all;
  // a leading Map parameter takes named arguments; use it for positional ones only when nothing else fits
  const rest = all.filter(
    (s) => !(s.parameters[0] && isMap(s.parameters[0].type)),
  );
  return rest.length > 0 ? rest : all;
}

function returnOf(entry: CatalogueEntry | undefined): TypeExpr | null {
  if (entry === undefined) return null;
  const returns = new Set(entry.signatures.map((s) => s.returns));
  const [only] = [...returns];
  return returns.size === 1 && only !== undefined && only !== "void"
    ? parseTypeText(only)
    : null;
}

function factoryArgumentTypes(
  signature: Signature,
  args: readonly (TypeExpr | null)[],
  named: boolean,
): readonly (TypeExpr | null)[] {
  // `E` and `V` come from the arguments passed for a parameter of exactly that type
  const found: (TypeExpr | null)[] = [];
  const offset = named ? 1 : 0;
  args.forEach((arg, i) => {
    const parameter =
      signature.parameters[
        Math.min(i + offset, signature.parameters.length - 1)
      ];
    if (parameter === undefined) return;
    const text = parameter.type.replace(/\.\.\.$/, "");
    if (text === "E" || text === "V") found.push(arg);
  });
  return found;
}

function makeLibrary(catalogue: ScriptCatalogue): DataflowLibrary {
  const byName = (entries: readonly CatalogueEntry[]) =>
    new Map(entries.map((e) => [e.name, e]));
  const channel = new Map<string, OperatorEntry[]>();
  const value = new Map<string, OperatorEntry[]>();
  for (const entry of catalogue.operators) {
    const table = entry.receiver === "Channel" ? channel : value;
    table.set(entry.name, [...(table.get(entry.name) ?? []), entry]);
  }
  const factories = byName(catalogue.factories);
  const functions = byName(catalogue.functions);
  const typedOutputs = byName(catalogue.processSections.typedOutputs);
  // a plain or unknown receiver takes operators of either type
  const operatorsFor = (
    name: string,
    receiver: Dataflow | null,
  ): OperatorEntry[] => [
    ...(receiver === "value" ? [] : (channel.get(name) ?? [])),
    ...(receiver === "channel" ? [] : (value.get(name) ?? [])),
  ];
  return {
    isFactory: (namespace, name) =>
      (namespace === "channel" || namespace === "Channel") &&
      factories.has(name),
    isOperator: (name, receiver) => operatorsFor(name, receiver).length > 0,
    factoryType(name, args, named) {
      const entry = factories.get(name);
      if (entry === undefined) return UNKNOWN;
      const total = args.length + (named ? 1 : 0);
      const exact = entry.signatures.filter((s) =>
        s.varargs
          ? total >= s.parameters.length - 1
          : s.parameters.length === total,
      );
      const candidates = exact.length > 0 ? exact : entry.signatures;
      return merge(
        candidates.map((s) => {
          const types = factoryArgumentTypes(s, args, named);
          const [first] = types;
          const element =
            first !== undefined &&
            first !== null &&
            types.every((x) => same(x, first))
              ? first
              : null;
          return flowOf(s.returns, element);
        }),
      ) as FlowType;
    },
    operatorType(name, receiver, args) {
      const candidates = operatorCandidates(
        operatorsFor(name, receiver.dataflow),
        args,
      );
      return merge(candidates.map((s) => flowOf(s.returns, receiver.element)));
    },
    parameterNames(name, receiver, args) {
      const [first] = operatorCandidates(
        operatorsFor(name, receiver.dataflow),
        args,
      );
      return first === undefined ? null : first.parameters.map((p) => p.name);
    },
    functionType: (name) => returnOf(functions.get(name)),
    typedOutputType: (name) => returnOf(typedOutputs.get(name)),
  };
}

const libraries = new WeakMap<ScriptCatalogue, DataflowLibrary>();

export function dataflowLibrary(catalogue: ScriptCatalogue): DataflowLibrary {
  let library = libraries.get(catalogue);
  if (library === undefined) {
    library = makeLibrary(catalogue);
    libraries.set(catalogue, library);
  }
  return library;
}
