import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell";
import { getEngine } from "./engine/engine-client";
import { FramedNotice, isFramed } from "./frame-guard";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("nf-builder: #root element missing");

// Test hook (F-113): the engine API, started on first access. Same-origin under the strict CSP.
Object.defineProperty(window, "nfBuilderEngine", { get: getEngine });

createRoot(root).render(
  isFramed(window) ? (
    <FramedNotice href={location.href} />
  ) : (
    <StrictMode>
      <AppShell />
    </StrictMode>
  ),
);
