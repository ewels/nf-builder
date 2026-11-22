// Helpers and expectations for the details pane end-to-end tests (F-206). Node ids are projection keys (ADR 0036).
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { REPO_ROOT } from "../scripts/check-common.ts";
import { NODE, openProject } from "./canvas.ts";
import { readProject } from "./engine.ts";

export const F206_FIXTURE = join(REPO_ROOT, "tools/oracle/cases/f206-details");

export const openDetailsFixture = (page: Page) =>
  openProject(page, readProject(F206_FIXTURE));

export interface ExpectedPort {
  label: string;
  type: string;
  /** The connection rows, or the note ("Not used", "Not connected") when there is none. */
  connections: string[];
}

export interface ExpectedDetails {
  name: string;
  kind: string;
  /** The file; the line after it is not asserted. */
  file: string;
  inputs: ExpectedPort[];
  outputs: ExpectedPort[];
}

const port = (
  label: string,
  type: string,
  ...connections: string[]
): ExpectedPort => ({ label, type, connections });

/** One entry per node of `f205-canvas`'s entry workflow and `SHOUT`, and the unparsed `SECOND` of `bad-declaration`. */
export const DETAILS_EXPECTED: Record<string, ExpectedDetails> = {
  [NODE.params]: {
    name: "params",
    kind: "Params block",
    file: "main.nf",
    inputs: [],
    outputs: [
      port(
        "greeting",
        "String",
        `to log.info "greeting: \${params.greeting}"`,
        "to GREET.greeting",
      ),
      port("words", "Path", "to SHOUT.words"),
    ],
  },
  [NODE.code]: {
    name: `log.info "greeting: \${params.greeting}"`,
    kind: "Code",
    file: "main.nf",
    inputs: [port("params.greeting", "Unknown type", "from params.greeting")],
    outputs: [],
  },
  [NODE.names]: {
    name: "channel.of",
    kind: "Channel factory",
    file: "main.nf",
    inputs: [],
    outputs: [port("out", "Channel<String>", "to GREET.name", "to map")],
  },
  [NODE.greeted]: {
    name: "GREET",
    kind: "Typed process",
    file: "modules/local/greet/main.nf",
    inputs: [
      port("name", "String", "from ch_names"),
      port("greeting", "String", "from params.greeting"),
    ],
    outputs: [
      port(
        "line",
        "Channel<String>",
        "to SHOUT.names",
        "to map → collect",
        "to output.greetings",
      ),
    ],
  },
  "main.nf#/ch_pairs": {
    name: "map",
    kind: "Operator chain",
    file: "main.nf",
    inputs: [port("in", "Unknown type", "from ch_names")],
    outputs: [port("out", "Channel<?>", "to LEGACY_COUNT", "to WORDCOUNT")],
  },
  [NODE.counted]: {
    name: "LEGACY_COUNT",
    kind: "Legacy process",
    file: "modules/local/legacy_count/main.nf",
    inputs: [port("tuple(meta, words)", "Tuple", "from ch_pairs")],
    outputs: [
      port("txt", "Channel<Path>", "to output.counts"),
      port("versions", "Channel<Path>", "Not used"),
    ],
  },
  [NODE.wc]: {
    name: "WORDCOUNT",
    kind: "Legacy process · registry module nf-core/wordcount",
    file: "modules/nf-core/wordcount/main.nf",
    inputs: [port("tuple(meta, words)", "Tuple", "from ch_pairs")],
    outputs: [port("counts", "Channel<Tuple>", "Not used")],
  },
  [NODE.shouted]: {
    name: "SHOUT",
    kind: "Typed workflow",
    file: "workflows.nf",
    inputs: [
      port("names", "Channel<String>", "from greeted"),
      port("words", "Path", "from params.words"),
    ],
    outputs: [port("loud", "Channel<String>", "to LEGACY_TAIL", "to UPPER")],
  },
  [NODE.tail]: {
    name: "LEGACY_TAIL",
    kind: "Legacy workflow",
    file: "legacy.nf",
    inputs: [port("items", "Unknown type", "from shouted")],
    outputs: [port("tagged", "Unknown type", "to output.tails")],
  },
  "main.nf#/upper": {
    name: "UPPER",
    kind: "Pipeline",
    file: "pipelines/upper.nf",
    inputs: [port("input", "Channel<String>", "from shouted")],
    outputs: [port("upper", "Channel<String>", "to output.uppers")],
  },
  [NODE.total]: {
    name: "map → collect",
    kind: "Operator chain",
    file: "main.nf",
    inputs: [port("in", "Unknown type", "from greeted")],
    outputs: [port("out", "Value<Bag<?>>", "to output.total")],
  },
  [NODE.output]: {
    name: "output",
    kind: "Output block",
    file: "main.nf",
    inputs: [
      port("greetings", "Channel<String>", "from greeted"),
      port("counts", "Channel<Path>", "from counted.txt"),
      port("total", "Value<Bag<Integer>>", "from total"),
      port("uppers", "Channel<String>", "from upper"),
      port("tails", "Channel<String>", "from tail"),
    ],
    outputs: [],
  },
};

/** The named workflow `SHOUT` in `workflows.nf` (open it with `openWorkflow`). */
export const SHOUT_EXPECTED: Record<string, ExpectedDetails> = {
  "workflows.nf#SHOUT/:take:names": {
    name: "names",
    kind: "Take",
    file: "workflows.nf",
    inputs: [],
    outputs: [port("out", "Channel<String>", "to map")],
  },
  "workflows.nf#SHOUT/:take:words": {
    name: "words",
    kind: "Take",
    file: "workflows.nf",
    inputs: [],
    outputs: [port("out", "Path", "Not used")],
  },
  "workflows.nf#SHOUT/loud": {
    name: "map",
    kind: "Operator chain",
    file: "workflows.nf",
    inputs: [port("in", "Unknown type", "from names")],
    outputs: [port("out", "Channel<?>", "to loud")],
  },
  "workflows.nf#SHOUT/:emit:loud": {
    name: "loud",
    kind: "Emit",
    file: "workflows.nf",
    inputs: [port("in", "Channel<String>", "from loud")],
    outputs: [],
  },
};

/** The unparsed `SECOND` call of `bad-declaration.nf`, opened as `main.nf`. */
export const SECOND_ID = "main.nf#/SECOND@1";
export const SECOND_EXPECTED: ExpectedDetails = {
  name: "SECOND",
  kind: "Process (could not be parsed)",
  file: "main.nf",
  inputs: [port("$1", "Unknown type", "from channel.of")],
  outputs: [port("out", "Unknown type", "Not used")],
};

export const TRIM_ID = "main.nf#/trimmed";

/** The id of the call to `callee` in the entry workflow of `main.nf` (an unassigned call has no variable to key it). */
export function calleeNodeId(page: Page, callee: string): Promise<string> {
  return page.evaluate(async (name) => {
    const engine = (
      window as unknown as {
        nfBuilderEngine: {
          project(path: string, workflow: string | null): Promise<unknown>;
        };
      }
    ).nfBuilderEngine;
    const result = (await engine.project("main.nf", null)) as {
      projection: {
        nodes: { id: string; kind: string; callee?: { name: string } }[];
      };
    };
    const found = result.projection.nodes.find(
      (n) => n.kind === "call" && n.callee?.name === name,
    );
    if (found === undefined) throw new Error(`no call to ${name}`);
    return found.id;
  }, callee);
}

export const detailsPane = (page: Page): Locator =>
  page.locator(".details-pane");

/** Waits until the worker's part of the details has arrived. */
export async function detailsReady(page: Page): Promise<void> {
  await page
    .locator('.details-pane[data-details-state="ready"]')
    .waitFor({ state: "visible" });
}

/** The pane's port rows under `title` ("Inputs" or "Outputs"). */
export function readPorts(
  pane: Locator,
  title: string,
): Promise<ExpectedPort[]> {
  return pane
    .locator("section.details-section", {
      has: pane.page().locator(`h4:text-is("${title}")`),
    })
    .first()
    .evaluate((section) =>
      [...section.querySelectorAll(":scope > ul > li")].map((li) => {
        const text = (selector: string) =>
          li.querySelector(`:scope > ${selector}`)?.textContent ?? "";
        const rows = [...li.querySelectorAll(":scope > ul > li")].map(
          (c) => c.textContent ?? "",
        );
        const note = li.querySelector(":scope > .details-note")?.textContent;
        return {
          label: text(".details-port-name"),
          type: text(".details-type"),
          connections:
            note === undefined || note === null ? rows : [...rows, note],
        };
      }),
    );
}
