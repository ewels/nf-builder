import { queryTerms } from "@nf-builder/engine";
import { createRegistrySearch, type RegistryIndex } from "@nf-builder/sources";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PalettePanel } from "../src/palette/palette-panel";
import { RegistrySectionView } from "../src/registry/registry-section";
import type { RegistryState } from "../src/registry/registry-store";

const NOW = new Date("2026-11-22T05:00:00Z");
const noop = () => undefined;

const module = (n: number) => ({
  name: `nf-core/tool${String(n).padStart(4, "0")}`,
  version: "1.0.0",
  kind: "process" as const,
  component: null,
  typed: false,
  description: `Tool ${n}`,
  keywords: [],
});

const indexOf = (
  overrides: Partial<RegistryIndex> = {},
  modules = 3,
): RegistryIndex => ({
  source: "snapshot",
  asOf: "2026-11-22T00:00:00.000Z",
  snapshotAt: "2026-11-22T00:00:00.000Z",
  language: "26.10",
  nextflow: "26.10.7",
  modules: Array.from({ length: modules }, (_, i) => module(i)),
  plugins: [
    {
      id: "nf-schema",
      version: "2.0.0",
      requires: null,
      summary: "Schema validation",
      provider: null,
      projectUrl: null,
    } as RegistryIndex["plugins"][number],
  ],
  liveFailure: null,
  ...overrides,
});

const ready = (index: RegistryIndex, refreshing = false): RegistryState => ({
  status: "ready",
  index,
  refreshing,
  refreshFailure: null,
});

const render = (
  state: RegistryState,
  query = "",
  open = { modules: true, plugins: false },
  collapsed: ReadonlySet<string> = new Set(),
) => {
  const index = state.status === "ready" ? state.index : null;
  const matches = index ? createRegistrySearch(index)(queryTerms(query)) : null;
  return renderToStaticMarkup(
    <RegistrySectionView
      state={state}
      now={NOW}
      query={query}
      matches={matches}
      open={open}
      collapsed={collapsed}
      onToggle={noop}
      onToggleNamespace={noop}
      onRefresh={noop}
    />,
  );
};

const typedModule = (
  name: string,
  over: Partial<RegistryIndex["modules"][number]> = {},
): RegistryIndex["modules"][number] => ({
  name,
  version: "1.0.0",
  kind: "process",
  component: null,
  typed: false,
  description: `About ${name}`,
  keywords: [],
  ...over,
});

describe("registry section", () => {
  it("F-502 step 1 UX-14: a snapshot index shows the registry.nextflow.io heading, 'Snapshot · updated 5 hours ago' and a Refresh registry data button described by that line", () => {
    const html = render(ready(indexOf()));
    expect(html).toContain("registry.nextflow.io");
    expect(html).toContain("<span> · updated 5 hours ago</span>");
    expect(html).toMatch(/aria-label="Refresh registry data"/);
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toMatch(
      new RegExp(
        `<p[^>]*id="${describedBy}"[^>]*><span aria-live="polite">Snapshot</span><span> · updated 5 hours ago</span></p>`,
      ),
    );
    expect(html).toContain("Snapshot built 22 Nov 2026, 00:00 UTC");
  });

  it("F-502 step 2 UX-14: a live index says 'Live · updated just now'", () => {
    const html = render(
      ready(indexOf({ source: "live", asOf: "2026-11-22T05:00:00.000Z" })),
    );
    expect(html).toContain('<span aria-live="polite">Live</span>');
    expect(html).toContain("<span> · updated just now</span>");
  });

  it("F-502 UX-14 ADR-0009: the ticking age is outside the live region, so only the source name and state messages are announced", () => {
    const html = render(ready(indexOf()));
    expect(html).not.toMatch(/<p[^>]*aria-live/);
    expect(html).not.toMatch(/aria-live="polite"[^>]*>[^<]*updated/);
    expect(render({ status: "loading" })).toContain(
      '<span aria-live="polite">Loading registry modules…</span>',
    );
  });

  it("F-502 UX-14 ADR-0009: a live index's refresh button title gives both the live read time and the snapshot build time", () => {
    const html = render(
      ready(
        indexOf({
          source: "live",
          asOf: "2026-11-22T05:00:00.000Z",
          snapshotAt: "2026-11-21T00:00:00.000Z",
        }),
      ),
    );
    expect(html).toContain(
      'title="Live data read 22 Nov 2026, 05:00 UTC; snapshot built 21 Nov 2026, 00:00 UTC"',
    );
  });

  it("F-502 UX-14: while refreshing the refresh button is disabled and aria-busy, otherwise enabled and not busy", () => {
    const busy = render(ready(indexOf(), true));
    expect(busy).toMatch(/<button[^>]*aria-busy="true"[^>]*disabled=""/);
    const idle = render(ready(indexOf()));
    expect(idle).toMatch(/<button[^>]*aria-busy="false"/);
    expect(idle).not.toMatch(/<button[^>]*disabled/);
  });

  it("F-502 IO-30: timeout and http failures show their messages", () => {
    const cases = [
      [
        "timeout",
        "Couldn&#x27;t load registry modules. Check your connection, then refresh.",
      ],
      ["http", "The registry snapshot couldn&#x27;t be read."],
    ] as const;
    for (const [code, message] of cases) {
      const html = render({
        status: "failed",
        failure: { code, message: "x" },
        refreshing: false,
      });
      expect(html).toContain(message);
    }
  });

  it("F-502 step 1 IO-30: after a live failure the section says the live registry couldn't be reached", () => {
    const html = render(
      ready(
        indexOf({
          liveFailure: { code: "network", message: "Failed to fetch" },
        }),
      ),
    );
    expect(html).toContain("The live registry couldn&#x27;t be reached.");
    expect(html).toContain("<span> · updated 5 hours ago</span>");
  });

  it("F-502 IO-30 ADR-0035: unavailable, network and invalid failures each show their message and keep the refresh button", () => {
    const cases = [
      ["unavailable", "No registry snapshot is available on this site."],
      [
        "network",
        "Couldn&#x27;t load registry modules. Check your connection, then refresh.",
      ],
      ["invalid", "The registry snapshot couldn&#x27;t be read."],
    ] as const;
    for (const [code, message] of cases) {
      const html = render({
        status: "failed",
        failure: { code, message: "x" },
        refreshing: false,
      });
      expect(html).toContain(message);
      expect(html).toContain('aria-label="Refresh registry data"');
    }
  });

  it("F-503 UX-14: modules render under namespace headings with counts, with short labels, data-name holding the full name, and a hidden process or workflow word", () => {
    const html = render(
      ready(
        indexOf({
          modules: [
            typedModule("cellgeni/anndata/concat"),
            typedModule("nf-core/bam_applybqsr", { kind: "workflow" }),
            typedModule("nf-core/samtools/merge"),
          ],
        }),
      ),
    );
    expect(html).toMatch(/<h4[^>]*><button[^>]*aria-expanded="true"/);
    expect(html.indexOf("nf-core")).toBeLessThan(html.indexOf("cellgeni"));
    expect(html).toMatch(/nf-core<\/span><span[^>]*>2<\/span>/);
    expect(html).toContain('data-name="nf-core/samtools/merge"');
    expect(html).toMatch(
      /<span class="registry-item-label">samtools\/merge<\/span>/,
    );
    expect(html).toMatch(/visually-hidden">workflow</);
    expect(html).toMatch(/visually-hidden">process</);
    expect(html).toContain('title="nf-core/samtools/merge · About');
  });

  it("F-503 UX-14: only typed modules with a version carry the typed tag", () => {
    const html = render(
      ready(
        indexOf({
          modules: [
            typedModule("nf-core/a", { typed: true }),
            typedModule("nf-core/b", { typed: null }),
            typedModule("nf-core/c", { typed: true, version: null }),
          ],
        }),
      ),
    );
    expect(html.match(/registry-badge-typed/g)?.length).toBe(1);
    expect(html).toMatch(
      /data-name="nf-core\/a".*?registry-badge-typed.*?data-name="nf-core\/b"/,
    );
  });

  it("F-503 step 2 UX-14: with 250 modules in one namespace, 100 rows render, followed by a Show 100 more (of 250) button", () => {
    const html = render(ready(indexOf({}, 250)));
    expect(html.match(/data-name="nf-core\//g)?.length).toBe(100);
    expect(html).toMatch(/<button[^>]*>Show 100 more \(of 250\)<\/button>/);
  });

  it("F-503 UX-14: the last window's button counts what is left, with en-GB separators", () => {
    const html = render(ready(indexOf({}, 2500)));
    expect(html).toMatch(/>Show 100 more \(of 2,500\)</);
    const last = render(ready(indexOf({}, 130)));
    expect(last).toMatch(/>Show 30 more \(of 130\)</);
  });

  it("F-503 UX-11: while searching, matching modules and plugins render with every group open; no matches give the plain note and no role=status", () => {
    const index = indexOf({
      modules: [typedModule("nf-core/fastqc"), typedModule("other/hello")],
    });
    const html = render(
      ready(index),
      "fastqc",
      { modules: false, plugins: false },
      new Set(["nf-core"]),
    );
    expect(html).toContain('data-name="nf-core/fastqc"');
    expect(html).not.toContain("other/hello");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("registry.nextflow.io");
    expect(html).toContain("<span> · updated 5 hours ago</span>");
    const plugin = render(ready(index), "schema valid", {
      modules: false,
      plugins: false,
    });
    expect(plugin).toContain('data-name="nf-schema"');
    const none = render(ready(index), "zzzz");
    expect(none).toContain("No registry modules or plugins match.");
    expect(none).not.toContain('role="status"');
    expect(none).not.toContain("registry-item");
  });

  it("F-503 UX-14: registry rows use no palette-item class and the section has no role=status", () => {
    const html = render(ready(indexOf({}, 300)), "", {
      modules: true,
      plugins: true,
    });
    expect(html).toContain("nf-schema");
    expect(html).not.toContain("palette-item");
    expect(html).not.toContain('role="status"');
  });

  it("F-502 UX-14: loading and refreshing states say so", () => {
    expect(render({ status: "loading" })).toContain(
      "Loading registry modules…",
    );
    expect(render(ready(indexOf(), true))).toContain("Refreshing…");
  });

  it("F-204 F-502: before the store loads, PalettePanel still renders statically", () => {
    const html = renderToStaticMarkup(<PalettePanel languageVersion="26.10" />);
    expect(html).toMatch(/role="status"[^>]*>Loading components…/);
    expect(html).toContain("registry.nextflow.io");
    expect(html).toContain("Loading registry modules…");
  });
});
