// Types of expressions that read no graph value (LA-28): literals, constructors and catalogue functions.

import type { Expression, FlowType } from "@nf-builder/lang-core";
import type { DataflowLibrary } from "./library";
import { typeFromRef, wrapFlow } from "./types";

export const plain = (name: string): FlowType =>
  wrapFlow("plain", { name, args: [], nullable: false });

/** The type of an expression that doesn't read a variable; null when it isn't known. */
export function inlineType(
  expression: Expression,
  library: DataflowLibrary,
): FlowType | null {
  switch (expression.kind) {
    case "String":
    case "GString":
      return plain("String");
    case "Number":
      return plain(expression.integer ? "Integer" : "Float");
    case "Boolean":
      return plain("Boolean");
    case "Null":
      return plain("Null");
    case "List":
      return plain("List");
    case "Map":
      return plain("Map");
    case "Parenthesized":
      return inlineType(expression.expression, library);
    case "Cast":
    case "New":
      return wrapFlow("plain", typeFromRef(expression.type));
    case "MethodCall": {
      if (
        expression.receiver !== null ||
        expression.method.kind !== "Identifier"
      )
        return null;
      const type = library.functionType(expression.method.name);
      return type === null ? null : wrapFlow("plain", type);
    }
    default:
      return null;
  }
}
