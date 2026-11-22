import { loadPalette, type PaletteView } from "@nf-builder/engine";
import { useEffect, useState } from "react";

type PaletteViewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: PaletteView }
  | { readonly status: "error" };

const LOADING: PaletteViewState = { status: "loading" };

/** Loads the palette for `version`; results for a version that is no longer current are ignored. */
export function usePaletteView(version: string | undefined): PaletteViewState {
  const [state, setState] = useState<{
    readonly version: string;
    readonly result: PaletteViewState;
  }>();
  useEffect(() => {
    if (version === undefined) return;
    let current = true;
    loadPalette(version).then(
      (view) => {
        if (current) setState({ version, result: { status: "ready", view } });
      },
      () => {
        if (current) setState({ version, result: { status: "error" } });
      },
    );
    return () => {
      current = false;
    };
  }, [version]);
  return state !== undefined && state.version === version
    ? state.result
    : LOADING;
}
