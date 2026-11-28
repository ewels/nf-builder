import type {
  Diagnostic,
  NodeDetails,
  NodeView,
  Projection,
  WorkflowSummary,
} from "@nf-builder/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DetailsContent } from "../src/canvas/canvas-store";
import { DetailsHeaderView } from "../src/details/details-header";
import { DetailsBody, diagnosticsAt } from "../src/details/details-pane";
import { DiagnosticList } from "../src/details/diagnostic-list";
import { NodeDetailsView } from "../src/details/node-details";
import { WorkflowSummaryView } from "../src/details/workflow-summary";

const range = {
  start: 0,
  end: 1,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 2,
};

const summaryOf = (coverage: WorkflowSummary["coverage"]): WorkflowSummary => ({
  name: "WF",
  path: "main.nf",
  entry: false,
  typed: false,
  takes: [],
  emits: [],
  params: [],
  outputs: [],
  calls: [],
  modules: [],
  coverage,
});

// finds the first <button> element in a React element tree without rendering it
type Tree = {
  props?: { children?: unknown; onClick?: () => void };
  type?: unknown;
};
function findButton(node: unknown): { props: { onClick: () => void } } {
  const found = search(node);
  if (found === null) throw new Error("no button");
  return found as { props: { onClick: () => void } };
}
function search(node: unknown): Tree | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = search(child);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;
  const el = node as Tree;
  if (el.type === "button") return el;
  return search(el.props?.children);
}

const view: NodeView = {
  id: "main.nf#/trimmed",
  kind: "call",
  name: "TRIM",
  kindLabel: "Typed process",
  module: null,
  path: "modules/local/trim/main.nf",
  line: null,
  inputs: [
    {
      id: "names",
      label: "names",
      type: "Channel<String>",
      connections: [
        { direction: "from", node: "n", text: "from ch_names" },
        { direction: "from", node: "m", text: "from MIX.out" },
      ],
      unconnected: null,
      argumentType: null,
    },
    {
      id: "greeting",
      label: "greeting",
      type: null,
      connections: [],
      unconnected: "inline",
      argumentType: "String",
    },
    {
      id: "extra",
      label: "extra",
      type: "Path",
      connections: [],
      unconnected: "not-connected",
      argumentType: null,
    },
  ],
  outputs: [
    {
      id: "out",
      label: "out",
      type: "Channel<String>",
      connections: [{ direction: "to", node: "o", text: "to output" }],
      unconnected: null,
      argumentType: null,
    },
    {
      id: "unused",
      label: "unused",
      type: null,
      connections: [],
      unconnected: "unused",
      argumentType: null,
    },
  ],
};

const diagnostic = (
  severity: Diagnostic["severity"],
  message: string,
): Diagnostic => ({
  path: "main.nf",
  range,
  severity,
  message,
  code: "x",
});

const details: NodeDetails = {
  node: view.id,
  declaration: {
    path: "modules/local/trim/main.nf",
    line: 12,
    description: "Trims each name.",
    directives: [
      { name: "tag", value: "name" },
      { name: "cpus", value: "2" },
    ],
    topics: [{ name: "versions", value: "tuple(task.process, 'x')" }],
    operators: [],
    preview: { title: "Script", text: "echo hi\necho there", truncated: true },
  },
  diagnostics: [diagnostic("suggestion", "Use the typed form")],
};

const ready: DetailsContent = {
  status: "ready",
  node: view.id,
  revision: 1,
  details,
};

const html = (content: DetailsContent, v: NodeView = view) =>
  renderToStaticMarkup(<NodeDetailsView view={v} details={content} />);

describe("F-206 details pane", () => {
  it("F-206 UX-30: node details show name, kind, file, description, inputs and outputs with types and connections, directives, topics, script preview and problems", () => {
    const out = html(ready);
    for (const text of [
      "TRIM",
      "Typed process",
      "modules/local/trim/main.nf:12",
      "Trims each name.",
      "Channel&lt;String&gt;",
      "from ch_names",
      "from MIX.out",
      "to output",
      "Unknown type",
      "Inline argument",
      "String",
      "Not connected",
      "Not used",
      "tag",
      "cpus",
      "versions",
      "echo hi",
      "Use the typed form",
    ])
      expect(out).toContain(text);
    for (const heading of [
      "File",
      "Inputs",
      "Outputs",
      "Directives",
      "Topics",
      "Script",
      "Problems",
    ])
      expect(out).toMatch(new RegExp(`<h4[^>]*>${heading}</h4>`));
    expect(out).toContain("Showing the first lines only");
  });

  it('F-206 UX-30: sections with nothing to show are omitted; "Loading details…" until the worker answers', () => {
    const loading = html({ status: "loading", node: view.id });
    expect(loading).toContain("Loading details…");
    expect(loading).toContain("Typed process");
    expect(loading).toContain("from ch_names");
    expect(loading).not.toContain("Problems");
    const bare = html({
      ...ready,
      details: {
        ...details,
        declaration: {
          ...details.declaration,
          description: null,
          directives: [],
          topics: [],
          preview: null,
        },
      },
    });
    for (const heading of ["Directives", "Topics", "Script", "Operators"])
      expect(bare).not.toContain(`>${heading}</h4>`);
    expect(bare).not.toContain("Loading details…");
    const unavailable = html({
      status: "unavailable",
      node: view.id,
      message: "The project changed. Select the node again.",
    });
    expect(unavailable).toContain(
      "The project changed. Select the node again.",
    );
  });

  it('F-206 UX-30 QA-12: problems show a severity word; none shows "No problems found"', () => {
    const list = renderToStaticMarkup(
      <DiagnosticList
        diagnostics={[
          diagnostic("error", "Bad"),
          diagnostic("warning", "Hmm"),
          diagnostic("suggestion", "Consider"),
        ]}
      />,
    );
    for (const word of ["Error", "Warning", "Suggestion"])
      expect(list).toContain(word);
    expect(renderToStaticMarkup(<DiagnosticList diagnostics={[]} />)).toContain(
      "No problems found",
    );
  });

  it('F-309 F-206 UX-30: a node with problems offers "Show in problems panel"; a clean node doesn\'t', () => {
    const link = "Show in problems panel";
    const withProblems = renderToStaticMarkup(
      <NodeDetailsView
        view={view}
        details={ready}
        onShowProblems={() => undefined}
      />,
    );
    expect(withProblems).toContain(link);
    // without the handler, as in the unit renders above, there is no button
    expect(html(ready)).not.toContain(link);
    const clean: DetailsContent = {
      ...ready,
      details: { ...details, diagnostics: [] },
    };
    expect(
      renderToStaticMarkup(
        <NodeDetailsView
          view={view}
          details={clean}
          onShowProblems={() => undefined}
        />,
      ),
    ).not.toContain(link);
  });

  it("F-206 UX-31: the summary shows take, emit, calls and registry modules", () => {
    const summary: WorkflowSummary = {
      name: "SHOUT",
      path: "workflows.nf",
      entry: false,
      typed: true,
      takes: [{ node: "t", name: "names", type: "Channel<String>" }],
      emits: [{ node: "e", name: "loud", type: null }],
      params: [{ node: "p", name: "greeting", type: "String" }],
      outputs: [{ node: "o", name: "greetings", type: null }],
      calls: [
        {
          node: "c",
          name: "WORDCOUNT",
          callee: "WORDCOUNT",
          kindLabel: "Legacy process · registry module nf-core/wordcount",
          module: "nf-core/wordcount",
          status: "modelled",
        },
      ],
      modules: [{ module: "nf-core/wordcount", calls: ["WORDCOUNT"] }],
      coverage: { statements: 4, modelled: 3, percent: 75 },
    };
    const out = renderToStaticMarkup(<WorkflowSummaryView summary={summary} />);
    for (const heading of ["Take", "Emit", "Calls", "Registry modules"])
      expect(out).toMatch(new RegExp(`<h4[^>]*>${heading}</h4>`));
    expect(out).not.toContain(">Parameters</h4>");
    const entry = renderToStaticMarkup(
      <WorkflowSummaryView summary={{ ...summary, entry: true }} />,
    );
    for (const heading of ["Parameters", "Outputs"])
      expect(entry).toMatch(new RegExp(`<h4[^>]*>${heading}</h4>`));
    expect(entry).not.toContain(">Take</h4>");
    for (const text of [
      "SHOUT",
      "names",
      "loud",
      "WORDCOUNT",
      "nf-core/wordcount",
    ])
      expect(out).toContain(text);
    const empty = renderToStaticMarkup(
      <WorkflowSummaryView
        summary={{
          ...summary,
          takes: [],
          emits: [],
          params: [],
          outputs: [],
          calls: [],
          modules: [],
        }}
      />,
    );
    expect(empty).not.toContain(">Registry modules</h4>");
    expect(empty).not.toContain(">Parameters</h4>");
    expect(empty).toContain('<h4>Take</h4><p class="details-none">None</p>');
    expect(empty).toContain('<h4>Emit</h4><p class="details-none">None</p>');
  });

  it("F-206 UX-32: a selected node's header has disabled Edit and Code buttons; with no selection there are none", () => {
    const selected = renderToStaticMarkup(<DetailsHeaderView selected />);
    expect(selected).toMatch(/<h2[^>]*>Details<\/h2>/);
    for (const name of ["Edit", "Code"])
      expect(selected).toMatch(
        new RegExp(`<button[^>]*disabled[^>]*>${name}</button>`),
      );
    const none = renderToStaticMarkup(<DetailsHeaderView selected={false} />);
    expect(none).toBe('<h2 class="column-title">Details</h2>');
  });

  it("F-703 UX-04 UX-32: read-only, the details header has no Edit or Code buttons while a node is selected", () => {
    const html = renderToStaticMarkup(<DetailsHeaderView selected readOnly />);
    expect(html).not.toContain("<button");
    expect(html).toMatch(/<h2[^>]*>Details<\/h2>/);
  });

  it("F-206 F-201: with no project, or while one loads, the body is exactly Nothing selected", () => {
    const body = (content: Parameters<typeof DetailsBody>[0]["content"]) =>
      renderToStaticMarkup(
        <DetailsBody
          content={content}
          selected={null}
          details={{ status: "idle" }}
        />,
      );
    expect(body({ status: "empty" })).toBe(
      '<p class="muted">Nothing selected</p>',
    );
    expect(body({ status: "loading" })).toBe(
      '<p class="muted">Nothing selected</p>',
    );
  });

  it("F-206 UX-30 UX-31: a project with no selection shows the summary; a selection shows the node", () => {
    const projection = {
      workflow: {
        path: "main.nf",
        name: null,
        modelled: true,
        typed: true,
        range,
      },
      nodes: [],
      edges: [],
      statements: [],
    } as unknown as Projection;
    const content = {
      status: "ready",
      revision: 1,
      projection,
      positions: {},
      refit: true,
      notice: null,
    } as const;
    const summary = renderToStaticMarkup(
      <DetailsBody
        content={content}
        selected={null}
        details={{ status: "idle" }}
      />,
    );
    expect(summary).toContain('data-details-state="summary"');
    expect(summary).toContain("Entry workflow");
    expect(summary).not.toContain("<h4>Take</h4>");
    expect(summary).not.toContain("<h4>Emit</h4>");
    // a selection shows the node, not the summary
    const picked = renderToStaticMarkup(
      <DetailsBody
        content={{
          status: "ready",
          revision: 1,
          positions: {},
          refit: true,
          notice: null,
          projection: {
            ...projection,
            nodes: [
              {
                id: "main.nf#/:take:reads",
                kind: "take",
                name: "reads",
                label: "reads",
                range,
                inputs: [],
                outputs: [],
              },
            ],
          } as unknown as Projection,
        }}
        selected="main.nf#/:take:reads"
        details={{ status: "loading", node: "main.nf#/:take:reads" }}
      />,
    );
    expect(picked).toContain('data-details-state="loading"');
    expect(picked).toContain("reads");
    expect(picked).not.toContain('data-details-state="summary"');
    expect(picked).not.toContain("Entry workflow");
    // a named workflow with no takes or emits says so, and has no parameters or outputs sections
    const named = renderToStaticMarkup(
      <DetailsBody
        content={{
          status: "ready",
          revision: 1,
          positions: {},
          refit: true,
          notice: null,
          projection: {
            ...projection,
            workflow: { ...projection.workflow, name: "LIB" },
          },
        }}
        selected={null}
        details={{ status: "idle" }}
      />,
    );
    expect(named).toContain('<h4>Take</h4><p class="details-none">None</p>');
    expect(named).toContain('<h4>Emit</h4><p class="details-none">None</p>');
    expect(named).not.toContain("<h4>Parameters</h4>");
    expect(named).not.toContain("<h4>Outputs</h4>");
  });

  it("F-405 ADR-0004 UX-31: the summary shows 'N of M statements (P%)', 'All N statements (100%)' and 'No statements'", () => {
    const base = summaryOf({ statements: 184, modelled: 165, percent: 89 });
    const text = (c: WorkflowSummary["coverage"]) =>
      renderToStaticMarkup(
        <WorkflowSummaryView summary={{ ...base, coverage: c }} />,
      );
    const partial = text({ statements: 184, modelled: 165, percent: 89 });
    expect(partial).toMatch(/<h4[^>]*>Modelled<\/h4>/);
    expect(partial).toContain("165 of 184 statements (89%)");
    expect(partial).toContain('data-coverage="165/184"');
    expect(text({ statements: 3, modelled: 3, percent: 100 })).toContain(
      "All 3 statements (100%)",
    );
    expect(text({ statements: 0, modelled: 0, percent: null })).toContain(
      "No statements",
    );
  });

  it("F-405 LA-35: the summary shows the workflow's suggestion count and Show suggestions calls back with the first one; it shows none while diagnostics load", () => {
    const base = summaryOf({ statements: 1, modelled: 1, percent: 100 });
    const first: Diagnostic = {
      path: "main.nf",
      range,
      severity: "suggestion",
      message: "Legacy workflow",
      code: "legacy-workflow",
    };
    const shown = (suggestions: readonly Diagnostic[] | null) =>
      WorkflowSummaryView({ summary: base, suggestions });
    const html = (suggestions: readonly Diagnostic[] | null) =>
      renderToStaticMarkup(shown(suggestions));
    expect(html([first, first])).toContain("2 suggestions in this workflow");
    expect(html([first])).toContain("1 suggestion in this workflow");
    expect(html([first])).toContain("Show suggestions</button>");
    expect(html([])).toContain("No suggestions in this workflow");
    expect(html([])).not.toContain("Show suggestions");
    expect(html(null)).toContain("Checking for suggestions");
    expect(
      renderToStaticMarkup(<WorkflowSummaryView summary={base} />),
    ).not.toContain("suggestion");
    let got: Diagnostic | null = null;
    const element = WorkflowSummaryView({
      summary: base,
      suggestions: [first],
      onShowSuggestions: (d) => {
        got = d;
      },
    });
    const button = findButton(element);
    button.props.onClick();
    expect(got).toBe(first);
  });
});

describe("F-405 UX-31: which diagnostics the summary shows", () => {
  const ready = (revision: number) =>
    ({ status: "ready", revision }) as unknown as Parameters<
      typeof diagnosticsAt
    >[0];
  const list = [{ code: "x" }] as unknown as readonly Diagnostic[];

  it("F-405: diagnostics made at the projection's revision are shown", () => {
    expect(diagnosticsAt(ready(3), "ready", 3, list)).toBe(list);
  });

  it("F-405: diagnostics of another revision, or no projection, are still being pulled (null)", () => {
    expect(diagnosticsAt(ready(3), "refreshing", 2, list)).toBeNull();
    expect(diagnosticsAt(ready(3), "loading", null, list)).toBeNull();
    expect(diagnosticsAt({ status: "loading" }, "ready", 3, list)).toBeNull();
  });

  it("F-405: failed diagnostics leave the section out (undefined), whatever the revision", () => {
    expect(diagnosticsAt(ready(3), "failed", 3, list)).toBeUndefined();
    expect(diagnosticsAt(ready(3), "failed", 2, list)).toBeUndefined();
  });
});
