// Dataflow types for projection ports and edges (LA-28). The rules follow nf-lang v26.10.7's TypeCheckingVisitor
// (`workflowEmitType`, L754-L786), which wraps a plain emit type as `Value<T>` (Apache-2.0; see docs/licences.md).

import type {
  Dataflow,
  FlowType,
  TypeExpr,
  TypeRef,
  Wildcard,
} from "@nf-builder/lang-core";

/** Neither the dataflow kind nor the element is known. */
export const UNKNOWN: FlowType = { dataflow: null, element: null };

const WILDCARD: TypeExpr = { name: "?", args: [], nullable: false };

function typeFromArgument(argument: TypeRef | Wildcard): TypeExpr {
  return argument.kind === "Wildcard" ? WILDCARD : typeFromRef(argument);
}

export function typeFromRef(ref: TypeRef): TypeExpr {
  return {
    name: ref.name,
    args: ref.typeArguments.map(typeFromArgument),
    nullable: ref.nullable,
  };
}

/** `Channel<X>` is a channel, `Value<X>` a value, any other type plain; null for no declaration. */
export function flowFromDeclared(ref: TypeRef | null): FlowType | null {
  if (ref === null) return null;
  const type = typeFromRef(ref);
  if (type.name === "Channel" || type.name === "Value")
    return {
      dataflow: type.name === "Channel" ? "channel" : "value",
      element: type.args[0] ?? null,
    };
  return { dataflow: "plain", element: type };
}

/**
 * Parses a catalogue type text such as `Value<Bag<E>>`, `Map<String, ?>`, `Map.Entry<K, V>` or `E...`. A trailing `...`
 * (varargs) is dropped. Text it can't read becomes a bare name.
 */
export function parseTypeText(text: string): TypeExpr {
  const source = text.trim().replace(/\.\.\.$/, "");
  let at = 0;
  const parseType = (): TypeExpr => {
    const start = at;
    while (at < source.length && !"<>,?".includes(source[at] as string)) at++;
    let name = source.slice(start, at).trim();
    if (name === "" && source[at] === "?") {
      name = "?";
      at++;
    }
    const args: TypeExpr[] = [];
    if (source[at] === "<") {
      at++;
      for (;;) {
        args.push(parseType());
        while (source[at] === " ") at++;
        if (source[at] === ",") {
          at++;
          while (source[at] === " ") at++;
          continue;
        }
        break;
      }
      if (source[at] === ">") at++;
    }
    let nullable = false;
    if (name !== "?" && source[at] === "?") {
      nullable = true;
      at++;
    }
    return { name, args, nullable };
  };
  return parseType();
}

export function formatType(type: TypeExpr): string {
  const args =
    type.args.length === 0 ? "" : `<${type.args.map(formatType).join(", ")}>`;
  return `${type.name}${args}${type.nullable ? "?" : ""}`;
}

/** `Channel<Path>`, `Value<Path>`, `Path` for plain, `?` for nothing known. */
export function formatFlowType(type: FlowType): string {
  const element = type.element === null ? "?" : formatType(type.element);
  switch (type.dataflow) {
    case "channel":
      return `Channel<${element}>`;
    case "value":
      return `Value<${element}>`;
    default:
      return element;
  }
}

export function wrapFlow(
  dataflow: Dataflow | null,
  element: TypeExpr | null,
): FlowType {
  return { dataflow, element };
}

/** nf-lang's `workflowEmitType`: a plain emit type is exposed as `Value<T>`; anything else is unchanged. */
export function asEmitType(type: FlowType): FlowType {
  return type.dataflow === "plain" ? { ...type, dataflow: "value" } : type;
}
