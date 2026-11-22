import { loadPalette, type PaletteView } from "@nf-builder/engine";
import { useEffect, useState } from "react";

export type PaletteViewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: PaletteView }
  | { readonly status: "error"; readonly message: string };

const LOADING: PaletteViewState = { status: "loading" };

/** Loads the palette for `version`; results for a version that is no longer current are ignored. */
export function usePaletteView(
  version: string | undefined,
  load: (version: string) => Promise<PaletteView> = loadPalette,
): PaletteViewState {
  const [state, setState] = useState<{
    readonly version: string;
    readonly result: PaletteViewState;
  }>();
  useEffect(() => {
    if (version === undefined) return;
    let current = true;
    load(version).then(
      (view) => {
        if (current) setState({ version, result: { status: "ready", view } });
      },
      (error: unknown) => {
        if (current)
          setState({
            version,
            result: {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          });
      },
    );
    return () => {
      current = false;
    };
  }, [version, load]);
  return state !== undefined && state.version === version
    ? state.result
    : LOADING;
}
