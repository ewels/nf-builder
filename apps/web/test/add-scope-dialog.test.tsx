import type { ConfigSchema, ConfigSchemaNode } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AddScopeDialog,
  firstParagraph,
  firstSentence,
  matches,
  optionItems,
  scopeItems,
} from "../src/config/add-scope-dialog";

const node = (
  name: string,
  kind: ConfigSchemaNode["kind"],
  description: string,
  children: ConfigSchemaNode[] = [],
  path: string[] = [name],
): ConfigSchemaNode => ({
  kind,
  name,
  path,
  description,
  docsUrl: null,
  types: kind === "option" ? ["String"] : [],
  valueKind: kind === "option" ? "string" : null,
  children,
});
const schema: ConfigSchema = {
  version: "26.10",
  pluginsKey: "",
  forms: { scopes: [], maps: {} },
  scopes: [
    node(
      "docker",
      "scope",
      "The `docker` scope controls Docker.\n\nSecond paragraph.",
    ),
    node("process", "scope", "The `process` scope sets process defaults."),
    node("plugins", "dsl", "The `plugins` block declares plugins."),
    node("cleanup", "option", "Delete the work directory when done. Really."),
  ],
};

describe("F-601 add scope dialog", () => {
  it("F-601 FI-03: lists every catalogue scope with its first paragraph, the unscoped options in their own group, and marks scopes in use", () => {
    const { scopes, unscoped } = scopeItems(schema, new Set(["process"]));
    expect(scopes.map((s) => s.name)).toEqual(["docker", "process", "plugins"]);
    expect(unscoped.map((s) => s.name)).toEqual(["cleanup"]);
    expect(scopes[0]?.description).toBe("The `docker` scope controls Docker.");
    expect(scopes.map((s) => s.inUse)).toEqual([false, true, false]);
    const out = renderToStaticMarkup(
      <AddScopeDialog
        schema={schema}
        inUse={new Set(["process"])}
        onPick={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(out).toContain("In use");
    expect(out).toContain("docker");
    expect(out).toContain("Unscoped options");
    expect(out).toContain('aria-label="Filter scopes"');
  });

  it("F-601 FI-03: the filter matches name and description, ignoring case", () => {
    const { scopes } = scopeItems(schema, new Set());
    expect(scopes.filter((s) => matches(s, "DOCK")).map((s) => s.name)).toEqual(
      ["docker"],
    );
    expect(
      scopes.filter((s) => matches(s, "defaults")).map((s) => s.name),
    ).toEqual(["process"]);
    expect(scopes.filter((s) => matches(s, "")).length).toBe(3);
  });

  it("F-601 FI-03: Add option lists the scope's options not yet set, nested scopes flattened as dotted names, with the first sentence", () => {
    const wave = node("wave", "scope", "Wave.", [
      node(
        "enabled",
        "option",
        "Enable Wave. More text.",
        [],
        ["wave", "enabled"],
      ),
      node(
        "build",
        "scope",
        "Build.",
        [
          node(
            "repository",
            "option",
            "Where.",
            [],
            ["wave", "build", "repository"],
          ),
        ],
        ["wave", "build"],
      ),
    ]);
    const items = optionItems(wave, new Set(["enabled"]));
    expect(items.map((i) => i.name)).toEqual(["build.repository"]);
    expect(optionItems(wave, new Set()).map((i) => i.name)).toEqual([
      "enabled",
      "build.repository",
    ]);
    expect(optionItems(wave, new Set())[0]?.description).toBe("Enable Wave.");
    expect(firstSentence("One. Two.")).toBe("One.");
    expect(firstParagraph("A\nB\n\nC")).toBe("A B");
  });
});
