// Messages and constants shared by the page, the worker, the end-to-end tests and the unit tests. DOM-free.

/** The five wheels the worker installs by URL, nf-metro first; equal to the wheels/ entries in assets.json. */
export const WHEELS: readonly string[] = [
  "nf_metro-2.1.0-py3-none-any.whl",
  "lark-1.3.1-py3-none-any.whl",
  "drawsvg-2.5.1-py3-none-any.whl",
  "networkx-3.6.1-py3-none-any.whl",
  "pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
];

export type MapName = "rnaseq_metro" | "sarek_metro";

export const MAPS: readonly {
  name: MapName;
  title: string;
  logos: readonly [string, string];
}[] = [
  {
    name: "rnaseq_metro",
    title: "nf-core/rnaseq",
    logos: ["nf-core-rnaseq_logo_light.png", "nf-core-rnaseq_logo_dark.png"],
  },
  {
    name: "sarek_metro",
    title: "nf-core/sarek",
    logos: ["nf-core-sarek_logo_light.png", "nf-core-sarek_logo_dark.png"],
  },
];

export type RenderRequest = { type: "render"; maps: readonly MapName[] };

export type ResourceSize = {
  path: string;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
};

export type Phases = { runtimeMs: number; installMs: number; importMs: number };

export type WorkerMessage =
  | {
      type: "progress";
      stage: "runtime" | "install" | "import" | "render";
      detail: string;
    }
  | { type: "svg"; name: MapName; svg: string; renderMs: number }
  | {
      type: "done";
      pyodideVersion: string;
      nfMetroVersion: string;
      loadedModules: string[];
      phases: Phases;
      resources: ResourceSize[];
    }
  | { type: "error"; message: string };

export type MapMetrics = {
  name: MapName;
  renderMs: number;
  svgBytes: number;
  width: number;
  height: number;
  sameSize: boolean;
  mismatchPixels: number;
  mismatchRatio: number;
  textIdentical: boolean;
};

export type SpikeMetrics = {
  pyodideVersion: string;
  nfMetroVersion: string;
  referenceNfMetro: string;
  firstRenderMs: number;
  phases: Phases;
  maps: MapMetrics[];
  loadedModules: string[];
  workerResources: ResourceSize[];
};
