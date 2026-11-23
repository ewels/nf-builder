import type { HistoryStatus } from "@nf-builder/engine";
import type { JSX } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import {
  ariaKeyShortcuts,
  type HistoryAction,
  isApplePlatform,
  shortcutText,
} from "./history-keys";

/** The Undo and Redo buttons, each naming the step it acts on, and a live region for the result (UX-70, QA-11). */
export function HistoryControlsView({
  history,
  notice,
  apple,
  onUndo,
  onRedo,
}: {
  readonly history: HistoryStatus;
  readonly notice: string | null;
  readonly apple: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}): JSX.Element {
  const button = (
    action: HistoryAction,
    label: string,
    step: string | null,
    count: number,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className="history-button"
      disabled={count === 0}
      aria-keyshortcuts={ariaKeyShortcuts(action, apple)}
      title={`${label}${step === null ? "" : `: ${step}`} (${shortcutText(action, apple)})`}
      onClick={onClick}
    >
      {label}
    </button>
  );
  return (
    <div className="history-controls">
      {button("undo", "Undo", history.undo, history.undoCount, onUndo)}
      {button("redo", "Redo", history.redo, history.redoCount, onRedo)}
      <span className="visually-hidden" role="status" aria-live="polite">
        {notice}
      </span>
    </div>
  );
}

/** The controls of the open project; nothing while no project is open. */
export function HistoryControls(): JSX.Element | null {
  const open = useWorkspace((s) => s.summary !== null);
  const history = useWorkspace((s) => s.history);
  const notice = useWorkspace((s) => s.historyNotice);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  if (!open) return null;
  return (
    <HistoryControlsView
      history={history}
      notice={notice}
      apple={isApplePlatform(navigator.platform)}
      onUndo={() => void undo()}
      onRedo={() => void redo()}
    />
  );
}
