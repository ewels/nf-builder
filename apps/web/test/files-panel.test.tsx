import type { FileTreeRow } from "@nf-builder/engine";
import { fileTreeRows } from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FilesPanelView } from "../src/files/files-panel";

const noop = () => undefined;
const html = (
  rows: readonly FileTreeRow[],
  status: "none" | "loading" | "ready" | "unavailable" = "ready",
  selected: string | null = null,
) =>
  renderToStaticMarkup(
    <FilesPanelView
      status={status}
      message="boom"
      projectName="Demo"
      rows={rows}
      selected={selected}
      onSelect={noop}
      onActivate={noop}
    />,
  );
const file = (path: string, problems = 0) => ({
  path,
  language: "nextflow" as const,
  status: problems === 0 ? ("modelled" as const) : ("partial" as const),
  problems,
});

const rows = fileTreeRows({
  files: [
    file("main.nf"),
    file("broken.nf", 1),
    file("modules/nf-core/wordcount/main.nf"),
    file("modules/local/greet/main.nf"),
  ],
  registry: [
    { path: "modules/nf-core/wordcount", module: "nf-core/wordcount" },
  ],
  expanded: new Set(["modules", "modules/nf-core"]),
});

describe("F-210 files panel", () => {
  it('F-210 UX-10 UX-16: with no project the Files panel says "No project open"; the other states say what is happening', () => {
    expect(html([], "none")).toContain("No project open");
    expect(html([], "loading")).toContain("Loading files…");
    expect(html([], "unavailable")).toContain(
      "The files couldn&#x27;t be listed (boom).",
    );
    expect(html(rows)).not.toContain("No project open");
    const full = html(rows);
    expect(full).toContain(">Demo<");
    expect(full).toContain('aria-label="New file"');
    expect(full).toContain('aria-label="New folder"');
    expect(full).toContain('aria-label="Upload files"');
    expect(full).toContain(
      "Drop files or a .zip here to add them to the project.",
    );
    expect(full).toMatch(/role="status"/);
  });

  it('F-210 UX-16 QA-10: role tree labelled "Project files"; treeitems with aria-level, aria-setsize, aria-posinset and aria-selected, aria-expanded on folders only; exactly one row with tabindex 0', () => {
    const markup = html(rows, "ready", "main.nf");
    expect(markup).toMatch(
      /<ul[^>]*role="tree"[^>]*aria-label="Project files"/,
    );
    const items = markup.match(/<li [^>]*>/g) ?? [];
    expect(items).toHaveLength(rows.length);
    for (const item of items) {
      expect(item).toMatch(/aria-level="\d+"/);
      expect(item).toMatch(/aria-setsize="\d+"/);
      expect(item).toMatch(/aria-posinset="\d+"/);
      expect(item).toMatch(/aria-selected="(true|false)"/);
    }
    const expandable = items.filter((i) => i.includes("aria-expanded"));
    expect(expandable).toHaveLength(
      rows.filter((r) => r.kind === "folder").length,
    );
    expect(items.filter((i) => i.includes('tabindex="0"'))).toHaveLength(1);
    expect(items.find((i) => i.includes('data-path="main.nf"'))).toContain(
      'tabindex="0"',
    );
    // nothing selected: the first row is the tab stop
    expect(
      (html(rows).match(/<li [^>]*>/g) ?? []).filter((i) =>
        i.includes('tabindex="0"'),
      ),
    ).toHaveLength(1);
  });

  it('F-210 UX-16 QA-12: a registry folder shows the text registry titled with its module; a failed file shows the error glyph and the text "1 parse error"', () => {
    const markup = html(rows);
    expect(markup).toContain('title="Registry module nf-core/wordcount"');
    expect(markup).toMatch(/>registry</);
    expect(markup.match(/>registry</g)).toHaveLength(1);
    expect(markup).toContain("1 parse error");
    expect(markup).toContain(
      "This file doesn&#x27;t parse completely: 1 parse error.",
    );
    expect(markup.match(/file-badge/g)).toHaveLength(1);
  });
});
