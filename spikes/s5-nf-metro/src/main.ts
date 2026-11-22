// Page controller for the spike (F-010). Presentational: the worker renders, this shows and measures.
import { normaliseSvg, pixelDiff, type Raster } from "./compare.ts";
import {
  MAPS,
  type MapMetrics,
  type MapName,
  type SpikeMetrics,
  type WorkerMessage,
} from "./protocol.ts";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing from index.html`);
  return found;
}

const status = element("status");
const mapsSection = element("maps");
const metricsOutput = element("metrics");

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** <img src=blob:> of the SVG, decoded, drawn to a canvas of its natural size and read back. */
async function rasterise(svg: string): Promise<Raster> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2D canvas context");
    context.drawImage(image, 0, 0);
    const { width, height, data } = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return { width, height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Shows the SVG as an <img src=blob:> and waits until it has decoded. */
async function show(name: MapName, svg: string): Promise<void> {
  const title = MAPS.find((m) => m.name === name)?.title ?? name;
  const figure = document.createElement("figure");
  const image = document.createElement("img");
  image.alt = `${title} metro map, rendered in the browser`;
  image.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const caption = document.createElement("figcaption");
  caption.textContent = `${title}, rendered by nf-metro in the browser`;
  figure.append(image, caption);
  mapsSection.append(figure);
  await image.decode();
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.text();
}

async function compare(
  name: MapName,
  svg: string,
  renderMs: number,
): Promise<MapMetrics> {
  const reference = await fetchText(`/reference/${name}.svg`);
  const [browser, cli] = await Promise.all([
    rasterise(svg),
    rasterise(reference),
  ]);
  return {
    name,
    renderMs,
    svgBytes: new TextEncoder().encode(svg).length,
    width: browser.width,
    height: browser.height,
    ...pixelDiff(browser, cli),
    textIdentical: normaliseSvg(svg) === normaliseSvg(reference),
  };
}

const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

let firstRenderMs = 0;
// One entry per svg message, in MAPS order.
const decoding: Promise<MapMetrics>[] = [];

worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "progress":
      status.textContent = message.detail;
      break;
    case "svg": {
      const { name, svg, renderMs } = message;
      decoding.push(
        show(name, svg).then(() => {
          if (firstRenderMs === 0) firstRenderMs = performance.now();
          return compare(name, svg, renderMs);
        }),
      );
      break;
    }
    case "done":
      void Promise.all([
        Promise.all(decoding),
        fetchText("/reference/manifest.json"),
      ])
        .then(([maps, manifest]) => {
          const reference = JSON.parse(manifest) as { nfMetro: string };
          const metrics: SpikeMetrics = {
            pyodideVersion: message.pyodideVersion,
            nfMetroVersion: message.nfMetroVersion,
            referenceNfMetro: reference.nfMetro,
            firstRenderMs,
            phases: message.phases,
            maps,
            loadedModules: message.loadedModules,
            workerResources: message.resources,
            workerCspViolations: message.cspViolations,
          };
          metricsOutput.textContent = JSON.stringify(metrics, null, 2);
          status.textContent = "Done";
        })
        .catch((error: unknown) => {
          status.textContent = `Failed: ${messageOf(error)}`;
        });
      break;
    case "error": {
      const violations = message.cspViolations.length
        ? ` (CSP violations in the worker: ${message.cspViolations.join("; ")})`
        : "";
      status.textContent = `Failed: ${message.message}${violations}`;
      break;
    }
  }
};
worker.onerror = (event) => {
  status.textContent = `Failed: ${event.message}`;
};
