import { useEffect } from "react";
import { canvasStore } from "../canvas/canvas-store";
import { isReadOnly } from "../read-only/read-only-store";
import { historyActionForKey, isApplePlatform } from "./history-keys";

/** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y undo and redo the project (UX-70); text fields and the code editor keep theirs. */
export function useHistoryKeys(): void {
  useEffect(() => {
    const apple = isApplePlatform(navigator.platform);
    const onKeyDown = (event: KeyboardEvent) => {
      // read-only (F-703): no shortcut, and the browser keeps its own keys
      if (isReadOnly()) return;
      const { summary, undo, redo } = canvasStore.getState();
      if (summary === null) return;
      const action = historyActionForKey(event, apple);
      if (action === null) return;
      event.preventDefault();
      void (action === "undo" ? undo() : redo());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
