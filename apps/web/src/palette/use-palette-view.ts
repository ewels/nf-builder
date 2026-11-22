import type { PaletteView } from "@nf-builder/engine";
import { useEffect, useState } from "react";
import { getEngine } from "../engine/engine-client";

type PaletteViewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: PaletteView }
  | { readonly status: "error" };

const LOADING: PaletteViewState = { status: "loading" };

const requests = new Map<string, Promise<PaletteView>>();

/** One palette request per version, shared by everyone; a rejected request is forgotten so the next call asks again. */
export function requestPaletteView(version: string): Promise<PaletteView> {
  let request = requests.get(version);
  if (!request) {
    request = getEngine().palette(version);
    requests.set(version, request);
    request.catch(() => {
      if (requests.get(version) === request) requests.delete(version);
    });
  }
  return request;
}

/** Loads the palette for `version`; results for a version that is no longer current are ignored. */
export function usePaletteView(version: string | undefined): PaletteViewState {
  const [state, setState] = useState<{
    readonly version: string;
    readonly result: PaletteViewState;
  }>();
  useEffect(() => {
    if (version === undefined) return;
    let current = true;
    requestPaletteView(version).then(
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
