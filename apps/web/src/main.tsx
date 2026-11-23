import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell";
import { canvasStore } from "./canvas/canvas-store";
import { getEngine } from "./engine/engine-client";
import { startProjects } from "./project/project-store";
import { registryStore } from "./registry/registry-store";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("nf-builder: #root element missing");

// Test hook (F-113): the engine API, started on first access. Same-origin under the strict CSP.
Object.defineProperty(window, "nfBuilderEngine", { get: getEngine });

// Test hook (F-205): opens a project in the UI. Same rationale.
Object.defineProperty(window, "nfBuilderWorkspace", {
  get: () => {
    const { open, openWorkflow } = canvasStore.getState();
    return { open, openWorkflow };
  },
});

// Test hook (F-502): forces the live or snapshot registry path, then reads again. Does nothing unless called.
Object.defineProperty(window, "nfBuilderRegistry", {
  get: () => ({
    reload: (options: { live: boolean }) =>
      registryStore.getState().reload(options),
  }),
});

startProjects();
// Best effort: write pending changes when the page goes away (IO-01).
const flushNow = () =>
  void getEngine()
    .flush()
    .catch(() => undefined);
window.addEventListener("pagehide", flushNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushNow();
});

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
