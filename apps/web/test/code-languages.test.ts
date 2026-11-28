import { beforeEach, describe, expect, it, vi } from "vitest";

const loadLanguage = vi.fn();
const createHighlighterCore = vi.fn();
const shikiToMonaco = vi.fn();
const register = vi.fn();
const createModel = vi.fn(() => ({}));

vi.mock("../src/code/monaco", () => ({
  NEXTFLOW_LANGUAGE_ID: "nextflow",
  monaco: {
    languages: { register, setLanguageConfiguration: vi.fn() },
    editor: { createModel },
    Uri: { from: (parts: unknown) => parts },
  },
}));
vi.mock("../src/canvas/canvas-store", () => ({
  canvasStore: {
    getState: () => ({ session: 1 }),
    subscribe: () => () => undefined,
  },
}));
vi.mock("shiki/core", () => ({ createHighlighterCore }));
vi.mock("shiki/engine/javascript", () => ({
  createJavaScriptRegexEngine: () => ({}),
}));
vi.mock("shiki/langs/nextflow.mjs", () => ({ default: {} }));
vi.mock("shiki/themes/github-light.mjs", () => ({ default: {} }));
vi.mock("@shikijs/monaco", () => ({ shikiToMonaco }));

async function fresh() {
  vi.resetModules();
  return import("../src/code/languages");
}

describe("F-605 editor languages", () => {
  beforeEach(() => {
    for (const mock of [
      loadLanguage,
      createHighlighterCore,
      shikiToMonaco,
      register,
      createModel,
    ])
      mock.mockClear();
    createHighlighterCore.mockResolvedValue({ loadLanguage });
    loadLanguage.mockResolvedValue(undefined);
  });

  it("F-605 FI-32 QA-01: Nextflow and plain text load no extra grammars; the first other language loads them all once, registers each Monaco language and binds the highlighting a second time only", async () => {
    const { registerLanguage } = await fresh();
    await registerLanguage("nextflow");
    await registerLanguage("plaintext");
    expect(loadLanguage).not.toHaveBeenCalled();
    expect(shikiToMonaco).toHaveBeenCalledTimes(1);
    await registerLanguage("yaml");
    await registerLanguage("markdown");
    await registerLanguage("python");
    expect(loadLanguage).toHaveBeenCalledTimes(1);
    expect(loadLanguage.mock.calls[0]?.length).toBeGreaterThanOrEqual(13);
    expect(shikiToMonaco).toHaveBeenCalledTimes(2);
    expect(createHighlighterCore).toHaveBeenCalledTimes(1);
    const ids = register.mock.calls.map((c) => (c[0] as { id: string }).id);
    for (const id of [
      "markdown",
      "yaml",
      "json",
      "shellscript",
      "python",
      "r",
      "groovy",
      "toml",
      "ini",
      "csv",
      "tsv",
      "diff",
      "mermaid",
    ])
      expect(ids, id).toContain(id);
  });

  it("F-605 FI-32 ADR-0048: a failed grammar load leaves plain tokens and a later file tries again", async () => {
    const { registerLanguage } = await fresh();
    loadLanguage.mockRejectedValueOnce(new Error("no grammars"));
    await expect(registerLanguage("yaml")).resolves.toBeUndefined();
    expect(shikiToMonaco).toHaveBeenCalledTimes(1);
    await registerLanguage("json");
    expect(loadLanguage).toHaveBeenCalledTimes(2);
    expect(shikiToMonaco).toHaveBeenCalledTimes(2);
  });

  it("F-605 FI-32: a model takes its language from its path", async () => {
    vi.resetModules();
    const { modelFor } = await import("../src/code/models");
    modelFor("conf/params.yml", "a: 1");
    modelFor("main.nf", "");
    modelFor("notes.txt", "");
    expect(createModel.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      "yaml",
      "nextflow",
      "plaintext",
    ]);
  });
});
