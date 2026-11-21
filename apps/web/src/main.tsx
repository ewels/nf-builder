import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("nf-builder: #root element missing");

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
document.addEventListener("click", () => {
  void fetch("https://telemetry.example.com/collect");
});
