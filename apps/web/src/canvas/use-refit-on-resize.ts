import { useReactFlow } from "@xyflow/react";
import { type RefObject, useEffect } from "react";

/**
 * Fits the graph again when the host's size changes, as when a view-mode switch halves the pane (F-208, UX-27). The
 * first size report is the initial layout, which the canvas fits itself. Every later change re-fits, so a window
 * resize also resets the user's own pan and zoom.
 */
export function useRefitOnResize(
  host: RefObject<HTMLElement | null>,
  options: { readonly maxZoom: number },
): void {
  const { fitView } = useReactFlow();
  const maxZoom = options.maxZoom;
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    let first = true;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void fitView({ maxZoom }));
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [host, fitView, maxZoom]);
}
