import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell";
import { getEngine } from "./engine/engine-client";
import { startProjects } from "./project/project-store";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("nf-builder: #root element missing");

// Test hook (F-113): the engine API, started on first access. Same-origin under the strict CSP.
Object.defineProperty(window, "nfBuilderEngine", { get: getEngine });

startProjects();
// Best effort: write pending changes when the page goes away (IO-01).
window.addEventListener("pagehide", () => {
  void getEngine()
    .flush()
    .catch(() => undefined);
});

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
