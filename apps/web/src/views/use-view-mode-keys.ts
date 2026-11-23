import { useEffect } from "react";
import { canvasStore } from "../canvas/canvas-store";
import { viewModeForKey } from "./view-mode";

/** G, S and C switch the active tab's view mode (UX-70); typing into a field never does. */
export function useViewModeKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { activeTab, setMode } = canvasStore.getState();
      if (activeTab === null) return;
      const mode = viewModeForKey(event);
      if (mode === null) return;
      event.preventDefault();
      setMode(activeTab, mode);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
