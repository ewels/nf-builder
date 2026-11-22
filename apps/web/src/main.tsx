import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./app-shell";
import { FramedNotice, isFramed } from "./frame-guard";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("nf-builder: #root element missing");

createRoot(root).render(
  isFramed(window) ? (
    <FramedNotice href={location.href} />
  ) : (
    <StrictMode>
      <AppShell />
    </StrictMode>
  ),
);
