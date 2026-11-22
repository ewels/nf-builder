// Module worker: Pyodide plus nf-metro (F-010). Wheels are installed by URL, so nothing is dependency-resolved and
// av and resvg-py are never fetched.

import {
  MAPS,
  type MapName,
  type RenderRequest,
  type ResourceSize,
  WHEELS,
  type WorkerMessage,
} from "./protocol.ts";
import { loadPyodideFrom } from "./pyodide.ts";

export const BOOT_TIMEOUT_MS = 90_000;

const scope = self as unknown as {
  location: Location;
  postMessage(message: WorkerMessage): void;
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
};

const HELPER = `
import json, sys, warnings
from pathlib import Path
import nf_metro
from nf_metro import render_string

def nfm_render(name):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return render_string(Path(f"/maps/{name}.mmd").read_text(), source_dir="/maps")

def nfm_modules():
    return json.dumps(sorted({m.split(".")[0] for m in sys.modules}))
`;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function resources(): ResourceSize[] {
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry as PerformanceResourceTiming)
    .map((entry) => ({
      path: new URL(entry.name).pathname,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    }));
}

async function render(maps: readonly MapName[]): Promise<void> {
  const origin = scope.location.origin;
  const progress = (
    stage: "runtime" | "install" | "import" | "render",
    detail: string,
  ) => scope.postMessage({ type: "progress", stage, detail });

  progress("runtime", "Starting Python");
  let mark = performance.now();
  const pyodide = await loadPyodideFrom(
    new URL("/pyodide/", origin).href,
    BOOT_TIMEOUT_MS,
  );
  const runtimeMs = performance.now() - mark;

  progress("install", "Installing nf-metro and its dependencies");
  mark = performance.now();
  await pyodide.loadPackage(
    WHEELS.map((wheel) => new URL(`/wheels/${wheel}`, origin).href),
  );
  const installMs = performance.now() - mark;

  progress("import", "Importing nf-metro");
  mark = performance.now();
  pyodide.FS.mkdirTree("/maps");
  for (const name of maps) {
    const map = MAPS.find((m) => m.name === name);
    if (!map) throw new Error(`unknown map ${name}`);
    const text = await fetchBytes(
      new URL(`/examples/${name}.mmd`, origin).href,
    );
    pyodide.FS.writeFile(`/maps/${name}.mmd`, text);
    for (const logo of map.logos)
      pyodide.FS.writeFile(
        `/maps/${logo}`,
        await fetchBytes(new URL(`/examples/${logo}`, origin).href),
      );
  }
  pyodide.runPython(HELPER);
  const importMs = performance.now() - mark;

  for (const name of maps) {
    progress("render", `Rendering ${name}`);
    mark = performance.now();
    const svg = pyodide.runPython(`nfm_render(${JSON.stringify(name)})`);
    if (typeof svg !== "string") throw new Error("nf-metro returned no SVG");
    scope.postMessage({
      type: "svg",
      name,
      svg,
      renderMs: performance.now() - mark,
    });
  }

  scope.postMessage({
    type: "done",
    pyodideVersion: pyodide.version,
    nfMetroVersion: String(pyodide.runPython("nf_metro.__version__")),
    loadedModules: JSON.parse(String(pyodide.runPython("nfm_modules()"))),
    phases: { runtimeMs, installMs, importMs },
    resources: resources(),
  });
}

scope.onmessage = (event) => {
  render(event.data.maps).catch((error: unknown) => {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
