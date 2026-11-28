import { useEffect } from "react";
import { isApplePlatform } from "../history/history-keys";
import { isReadOnly } from "../read-only/read-only-store";
import { shownMode } from "../views/view-mode";
import { canvasKeyAction } from "./canvas-keys";
import { canvasStore } from "./canvas-store";
import { activeViewport } from "./viewport";

/**
 * Delete, Ctrl/⌘+C and Ctrl/⌘+V act on the nodes of the active workflow canvas (F-310, UX-70). Listened for on the
 * document, so they work after a marquee or a project switch without focusing a node first. An edge's Delete is
 * handled by the canvas first and arrives here already handled.
 */
export function useClipboardKeys(): void {
  useEffect(() => {
    const apple = isApplePlatform(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      const state = canvasStore.getState();
      const tab = state.tabs.find((t) => t.id === state.activeTab);
      if (state.summary === null || tab?.kind !== "workflow") return;
      const readOnly = isReadOnly();
      // the canvas isn't shown in Code mode
      if (shownMode(tab.mode, readOnly) === "code") return;
      const action = canvasKeyAction(event, {
        readOnly,
        apple,
        nodesSelected: state.selection.length > 0,
        textSelected: (window.getSelection()?.toString() ?? "") !== "",
      });
      if (action === null) return;
      event.preventDefault();
      if (action === "delete-nodes") void state.deleteSelection();
      else if (action === "copy") void state.copySelection();
      else {
        const viewport = activeViewport(tab.id);
        const at = viewport?.pointer?.() ?? viewport?.centre() ?? null;
        void state.paste(at);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
