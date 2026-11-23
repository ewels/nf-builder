import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { canvasStore } from "../canvas/canvas-store";
import { getEngine } from "../engine/engine-client";
import { problemsToMarkers } from "./markers";
import { modelFor } from "./models";
import { monaco } from "./monaco";
import { NEXTFLOW_THEME, registerNextflow } from "./nextflow-language";
import { createTextSync, type PaneSyncState, withoutText } from "./text-sync";

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

// the newest reveal request shown: an editor mounted later (another tab, a mode switch) doesn't repeat it
let handledReveal = 0;

export default function CodeEditor({
  path,
  onSync,
}: {
  readonly path: string;
  readonly onSync: (state: PaneSyncState) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const report = useRef(onSync);
  report.current = onSync;
  useEffect(() => {
    let cancelled = false;
    // the project this editor belongs to: its text is never sent to another (ADR 0004, IO-01)
    const session = canvasStore.getState().session;
    const cleanup: (() => void)[] = [];
    (async () => {
      const [text] = await Promise.all([
        getEngine().readFile(path),
        registerNextflow(),
      ]);
      if (cancelled || host.current === null) return;
      if (canvasStore.getState().session !== session) return;
      if (text === null) {
        setProblem(`${path} is not in the project.`);
        return;
      }
      const file = modelFor(path, text);
      const { model } = file;
      const sync = createTextSync(file.synced.text, {
        send: async (sent) => {
          const outcome = await canvasStore
            .getState()
            .apply({ kind: "replaceFileText", path, text: sent }, session);
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
                problemsToMarkers(state.problems, model.getLinesContent()).map(
                  (m) => ({ ...m, severity: monaco.MarkerSeverity.Error }),
                ),
              );
          } else if (state.status === "idle")
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
          report.current(withoutText(state));
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
        renderLineHighlightOnlyWhenFocus: true,
        ariaLabel: `Code of ${path}`,
        cursorBlinking: reduced ? "solid" : "blink",
        smoothScrolling: !reduced,
      });
      // the selection as line:column pairs, for the end-to-end tests
      const publishSelection = () => {
        const r = editor.getSelection();
        if (r !== null && host.current !== null)
          host.current.dataset.selection = `${r.startLineNumber}:${r.startColumn}-${r.endLineNumber}:${r.endColumn}`;
      };
      publishSelection();
      // F-309: select and scroll to a range; the focus stays where it is (the problems panel)
      const showReveal = () => {
        const request = canvasStore.getState().reveal;
        if (
          request === null ||
          request.path !== path ||
          request.seq <= handledReveal
        )
          return;
        handledReveal = request.seq;
        const from = model.getPositionAt(request.start);
        const to = model.getPositionAt(request.end);
        const range = new monaco.Range(
          from.lineNumber,
          from.column,
          to.lineNumber,
          to.column,
        );
        editor.setSelection(range);
        editor.revealRangeInCenterIfOutsideViewport(range);
      };
      const onSelection = editor.onDidChangeCursorSelection(publishSelection);
      showReveal();
      cleanup.push(
        () => onSelection.dispose(),
        canvasStore.subscribe((state, before) => {
          if (state.reveal !== before.reveal) showReveal();
        }),
      );
      const onContent = model.onDidChangeContent(() =>
        sync.edit(model.getValue()),
      );
      const onBlur = editor.onDidBlurEditorWidget(() => void sync.flush());
      cleanup.push(
        () => editor.dispose(),
        () => onContent.dispose(),
        () => onBlur.dispose(),
        // a flush within the same project still sends; after a project change the sync is already disposed
        () => void sync.flush(),
        // an undo or redo first sends what is pending, so a pending edit is the step that gets undone (F-209)
        canvasStore.getState().registerFlush(() => sync.flush()),
        canvasStore.subscribe((state) => {
          if (state.session !== session) sync.dispose();
        }),
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
