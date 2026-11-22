// The pack's project templates for the new-project dialog (F-203). They come from the engine worker, so the main thread
// holds no pack (F-113).
import type { TemplateList } from "@nf-builder/engine";
import { useEffect, useState } from "react";
import { getEngine } from "../engine/engine-client";

export type TemplatesState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly list: TemplateList }
  | { readonly status: "error"; readonly message: string };

const LOADING: TemplatesState = { status: "loading" };
const requests = new Map<string, Promise<TemplateList>>();

/** One request per version, shared by everyone; a rejected request is forgotten so the next call asks again. */
export function requestTemplates(version: string): Promise<TemplateList> {
  let request = requests.get(version);
  if (!request) {
    request = getEngine().templates(version);
    requests.set(version, request);
    request.catch(() => requests.delete(version));
  }
  return request;
}

/** Loads the template list for `version`; results for a version that is no longer current are ignored. */
export function useTemplates(version: string | undefined): TemplatesState {
  const [state, setState] = useState<{
    readonly version: string;
    readonly result: TemplatesState;
  }>();
  useEffect(() => {
    if (version === undefined) return;
    let current = true;
    requestTemplates(version).then(
      (list) => {
        if (current) setState({ version, result: { status: "ready", list } });
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
  }, [version]);
  return state !== undefined && state.version === version
    ? state.result
    : LOADING;
}
