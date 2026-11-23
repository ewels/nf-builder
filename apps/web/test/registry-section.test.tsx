import type { RegistryIndex } from "@nf-builder/sources";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PalettePanel } from "../src/palette/palette-panel";
import {
  REGISTRY_LIST_LIMIT,
  RegistrySectionView,
} from "../src/registry/registry-section";
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
  searching = false,
  open = { modules: true, plugins: false },
) =>
  renderToStaticMarkup(
    <RegistrySectionView
      state={state}
      now={NOW}
      searching={searching}
      open={open}
      onToggle={noop}
      onRefresh={noop}
    />,
  );

describe("registry section", () => {
  it("F-502 step 1 UX-14: a snapshot index shows the registry.nextflow.io heading, 'Snapshot · updated 5 hours ago' and a Refresh registry data button described by that line", () => {
    const html = render(ready(indexOf()));
    expect(html).toContain("registry.nextflow.io");
    expect(html).toContain("Snapshot · updated 5 hours ago");
    expect(html).toMatch(/aria-label="Refresh registry data"/);
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toMatch(
      new RegExp(`<p[^>]*id="${describedBy}"[^>]*>Snapshot · updated 5 hours`),
    );
    expect(html).toContain("Snapshot built 22 Nov 2026, 00:00 UTC");
  });

  it("F-502 step 2 UX-14: a live index says 'Live · updated just now'", () => {
    const html = render(
      ready(indexOf({ source: "live", asOf: "2026-11-22T05:00:00.000Z" })),
    );
    expect(html).toContain("Live · updated just now");
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
    expect(html).toContain("Snapshot · updated 5 hours ago");
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

  it("F-502 UX-14: lists show at most 50 names with a 'Showing 50 of N' note, are hidden while searching, and use no palette-item classes and no role=status", () => {
    const big = ready(indexOf({}, 2322));
    const html = render(big, false, { modules: true, plugins: true });
    expect(html.match(/class="registry-item"/g)?.length).toBe(
      REGISTRY_LIST_LIMIT + 1,
    );
    expect(html).toContain("Showing 50 of 2,322 modules.");
    expect(html).toContain("nf-schema");
    expect(html).not.toContain("palette-item");
    expect(html).not.toContain('role="status"');
    const searching = render(big, true, { modules: true, plugins: true });
    expect(searching).not.toContain("registry-item");
    expect(searching).toContain("Snapshot · updated 5 hours ago");
    expect(searching).toContain("registry.nextflow.io");
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
