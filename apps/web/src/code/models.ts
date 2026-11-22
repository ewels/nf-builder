// One Monaco model per path for the session (F-208), shared by the Split and Code views.
import { monaco, NEXTFLOW_LANGUAGE_ID } from "./monaco";

interface FileModel {
  readonly model: monaco.editor.ITextModel;
  /** The text the project holds, as last read or sent. */
  readonly synced: { text: string };
}

const models = new Map<string, FileModel>();

/** The model of `path`; an unedited one follows `text`, an edited one keeps its buffer. */
export function modelFor(path: string, text: string): FileModel {
  const found = models.get(path);
  if (found !== undefined) {
    if (found.model.getValue() === found.synced.text) {
      found.model.setValue(text);
      found.synced.text = text;
    }
    return found;
  }
  const made: FileModel = {
    model: monaco.editor.createModel(
      text,
      NEXTFLOW_LANGUAGE_ID,
      monaco.Uri.from({ scheme: "nf-builder", path: `/${path}` }),
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
