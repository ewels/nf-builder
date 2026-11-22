import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { canvasStore } from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import { problemsToMarkers } from "./markers";
import { type FileModel, modelFor } from "./models";
import { monaco, NEXTFLOW_LANGUAGE_ID } from "./monaco";
import { NEXTFLOW_THEME, registerNextflow } from "./nextflow-language";
import { createTextSync, SYNC_DELAY_MS, type SyncState } from "./text-sync";

const MARKER_OWNER = "nf-builder-refusal";

/**
 * Replaces the model's text with `text` by the smallest edit, keeping the cursor and the editor's own undo stack; the
 * change is one undo step of its own.
 */
function followProject(model: monaco.editor.ITextModel, text: string): void {
  const old = model.getValue();
  let start = 0;
  while (
    start < old.length &&
    start < text.length &&
    old[start] === text[start]
  )
    start++;
  let end = 0;
  while (
    end < old.length - start &&
    end < text.length - start &&
    old[old.length - 1 - end] === text[text.length - 1 - end]
  )
    end++;
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(old.length - end);
  model.pushStackElement();
  model.pushEditOperations(
    [],
    [
      {
        range: new monaco.Range(
          from.lineNumber,
          from.column,
          to.lineNumber,
          to.column,
        ),
        text: text.slice(start, text.length - end),
      },
    ],
    () => null,
  );
  model.pushStackElement();
}

export default function CodeEditor({
  path,
  onSync,
}: {
  readonly path: string;
  readonly onSync: (state: SyncState) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const report = useRef(onSync);
  report.current = onSync;
  useEffect(() => {
    let cancelled = false;
    const cleanup: (() => void)[] = [];
    (async () => {
      const [text] = await Promise.all([
        getEngine().readFile(path),
        registerNextflow(monaco),
      ]);
      if (cancelled || host.current === null) return;
      if (text === null) {
        setProblem(`${path} is not in the project.`);
        return;
      }
      const file: FileModel = modelFor(monaco, path, text);
      const { model } = file;
      monaco.editor.setModelLanguage(model, NEXTFLOW_LANGUAGE_ID);
      const sync = createTextSync(file.synced.text, {
        delayMs: SYNC_DELAY_MS,
        send: async (sent) => {
          const outcome = await canvasStore
            .getState()
            .apply({ kind: "replaceFileText", path, text: sent });
          if (outcome.ok) file.synced.text = sent;
          return outcome;
        },
        onState: (state) => {
          if (state.status === "refused") {
            // markers describe the sent text, so only a buffer that still equals it gets them
            if (model.getValue() === state.text)
              monaco.editor.setModelMarkers(
                model,
                MARKER_OWNER,
                problemsToMarkers(state.problems, (n) =>
                  n <= model.getLineCount() ? model.getLineContent(n) : null,
                ).map((m) => ({ ...m, severity: monaco.MarkerSeverity.Error })),
              );
          } else if (state.status === "idle")
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
          report.current(state);
        },
      });
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const editor = monaco.editor.create(host.current, {
        model,
        theme: NEXTFLOW_THEME,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        minimap: { enabled: false },
        ariaLabel: `Code of ${path}`,
        cursorBlinking: reduced ? "solid" : "blink",
        smoothScrolling: !reduced,
      });
      const onContent = model.onDidChangeContent(() =>
        sync.edit(model.getValue()),
      );
      const onBlur = editor.onDidBlurEditorWidget(() => void sync.flush());
      cleanup.push(
        () => editor.dispose(),
        () => onContent.dispose(),
        () => onBlur.dispose(),
        () => {
          void sync.flush();
          sync.dispose();
        },
      );
      // a draft left in the model (refused earlier) is sent again, so its markers and status come back
      if (model.getValue() !== file.synced.text) {
        sync.edit(model.getValue());
        void sync.flush();
      }
      // the project changed behind the editor: a clean buffer follows it, a dirty one keeps its text
      let reading = 0;
      const follow = async () => {
        const mine = ++reading;
        const current = await getEngine().readFile(path);
        if (cancelled || mine !== reading || current === null) return;
        const value = model.getValue();
        if (value === current || value !== file.synced.text) return;
        sync.reset(current);
        file.synced.text = current;
        followProject(model, current);
      };
      cleanup.push(
        canvasStore.subscribe((state, before) => {
          if (
            state.lastChange !== before.lastChange &&
            state.lastChange?.paths.includes(path)
          )
            void follow();
        }),
      );
    })().catch((error: unknown) =>
      setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      cancelled = true;
      for (const undo of cleanup.reverse()) undo();
    };
  }, [path]);
  return (
    <>
      {problem === null ? null : <p className="muted">{problem}</p>}
      <div className="code-editor-host" ref={host} />
    </>
  );
}
