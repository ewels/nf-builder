import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell";
import { getEngine } from "./engine/engine-client";
import "./styles.css";
import { workspaceStore } from "./workspace/workspace-store";

const root = document.getElementById("root");
if (!root) throw new Error("nf-builder: #root element missing");

// Test hook (F-113): the engine API, started on first access. Same-origin under the strict CSP.
Object.defineProperty(window, "nfBuilderEngine", { get: getEngine });

// Test hook (F-205): opens a project in the UI. Same rationale; no user path opens a project until F-202.
Object.defineProperty(window, "nfBuilderWorkspace", {
  get: () => {
    const { open, openWorkflow } = workspaceStore.getState();
    return { open, openWorkflow };
  },
});

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
