import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TypeRef } from "@nf-builder/lang-core";
import { describe, expect, it } from "vitest";
import { parseScriptAst } from "../../src/ast/index.ts";
import {
  catchTypeName,
  hasLegacyType,
  hasType,
  legacyTypeText,
  NAMESPACES,
  typeName,
} from "../../src/printer/types.ts";

/** The type of `def x: <text> = null`. */
function typeOf(text: string): TypeRef {
  const result = parseScriptAst(`def x: ${text} = null\n`);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  const decl = result.ast.body[0];
  if (decl?.kind !== "VariableDeclaration")
    throw new Error("not a declaration");
  return decl.targets[0]?.type as TypeRef;
}

function legacyTypeOf(text: string) {
  const result = parseScriptAst(`${text} x = null\n`);
  if (!result.ok) throw new Error(result.errors[0]?.message);
  const decl = result.ast.body[0];
  if (decl?.kind !== "VariableDeclaration")
    throw new Error("not a declaration");
  return decl.legacyType;
}

describe("printer types", () => {
  it("F-110 ADR-0005: type annotations print as written, Object becomes ? inside type arguments and is dropped as an annotation", () => {
    expect(typeName(typeOf("Map<String,List<Integer>>"))).toBe(
      "Map<String, List<Integer>>",
    );
    expect(typeName(typeOf("Integer?"))).toBe("Integer?");
    expect(typeName(typeOf("java.nio.file.Path"))).toBe("java.nio.file.Path");
    expect(typeName(typeOf("List<Object>"))).toBe("List<?>");
    expect(typeName(typeOf("Channel<?>"))).toBe("Channel<?>");
    // nothing is renamed through the class hierarchy
    expect(typeName(typeOf("ArrayList<String>"))).toBe("ArrayList<String>");
    expect(typeName(typeOf("int"))).toBe("int");
    expect(hasType(typeOf("Object"))).toBe(false);
    expect(hasType(typeOf("String"))).toBe(true);
    expect(hasType(null)).toBe(false);

    const legacy = legacyTypeOf("Map<String, Integer>");
    expect(legacy && legacyTypeText(legacy)).toBe("Map<String,Integer>");
    expect(hasLegacyType(legacy)).toBe(true);
    expect(hasLegacyType(legacyTypeOf("String[]"))).toBe(false);
    expect(hasLegacyType(legacyTypeOf("Object"))).toBe(false);
    expect(hasLegacyType(null)).toBe(false);
  });

  it("F-110: catch types drop only a default-imported package", () => {
    expect(catchTypeName(typeOf("java.io.IOException"))).toBe("IOException");
    expect(catchTypeName(typeOf("java.lang.Exception"))).toBe("Exception");
    expect(catchTypeName(typeOf("java.math.BigDecimal"))).toBe("BigDecimal");
    expect(catchTypeName(typeOf("java.nio.file.AccessDeniedException"))).toBe(
      "java.nio.file.AccessDeniedException",
    );
    expect(catchTypeName(typeOf("IOException"))).toBe("IOException");
  });

  it("F-110 LA-02: the namespace receivers are the catalogue constants of a Namespace type", () => {
    const catalogue = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../catalogue/script.json"),
        "utf8",
      ),
    ) as {
      constants: { name: string; signatures: { returns: string }[] }[];
    };
    const expected = catalogue.constants
      .filter((c) => c.signatures.some((s) => s.returns.endsWith("Namespace")))
      .map((c) => c.name)
      .sort();
    expect([...NAMESPACES].sort()).toEqual(expected);
    expect(expected).toEqual(["channel", "log", "nextflow", "workflow"]);
  });
});
