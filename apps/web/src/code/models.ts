// One Monaco model per path for the session (F-208), shared by the Split and Code views.
import type { monaco } from "./monaco";

type Monaco = typeof monaco;

export interface FileModel {
  readonly model: monaco.editor.ITextModel;
  /** The text the project holds, as last read or sent. */
  readonly synced: { text: string };
}

const models = new Map<string, FileModel>();

/** The model of `path`; an unedited one follows `text`, an edited one keeps its buffer. */
export function modelFor(m: Monaco, path: string, text: string): FileModel {
  const found = models.get(path);
  if (found !== undefined && !found.model.isDisposed()) {
    if (found.model.getValue() === found.synced.text) {
      found.model.setValue(text);
      found.synced.text = text;
    }
    return found;
  }
  const made: FileModel = {
    model: m.editor.createModel(
      text,
      undefined,
      m.Uri.from({ scheme: "nf-builder", path: `/${path}` }),
    ),
    synced: { text },
  };
  models.set(path, made);
  return made;
}

/** Drops every model, when another project opens. */
export function disposeModels(): void {
  for (const { model } of models.values()) model.dispose();
  models.clear();
}
