import type { JSX, KeyboardEvent, ReactNode } from "react";
import {
  canvasStore,
  useWorkspace,
  type WorkflowTab,
} from "../canvas/canvas-store";
import { HistoryControls } from "../history/history-controls";
import { useReadOnly } from "../read-only/read-only-store";
import { modesFor, type ViewMode } from "../views/view-mode";
import { ViewModeToggle } from "../views/view-mode-toggle";
import { GlyphIcon } from "./icons";

export const workflowTabId = (id: string): string => `workflow-tab-${id}`;

/**
 * The strip's layout. `controls` sits in the same child slot whether or not tabs are open, so React keeps the history
 * live region mounted when the tabs come and go (QA-10).
 */
export function TabStripView({
  tabs,
  activeTab,
  controls,
  onSelect,
  onMode,
  onClose,
  readOnly = false,
}: {
  readonly tabs: readonly WorkflowTab[];
  readonly activeTab: string | null;
  readonly controls: ReactNode;
  readonly onSelect: (id: string) => void;
  readonly onMode: (id: string, mode: ViewMode) => void;
  /** `byKeyboard`: closed with Delete, so focus should move to the tab that takes over. */
  readonly onClose: (id: string, byKeyboard?: boolean) => void;
  /** Below 1024 px (F-703, UX-04): the workflow tabs only, with no view-mode toggle. */
  readonly readOnly?: boolean;
}): JSX.Element {
  const active = tabs.find((t) => t.id === activeTab);
  const modes = active === undefined ? [] : modesFor(active.kind, active.path);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Delete") {
      const id = (event.target as HTMLElement).id;
      const tab = tabs.find((t) => workflowTabId(t.id) === id);
      if (tab?.kind !== "file") return;
      event.preventDefault();
      onClose(tab.id, true);
      return;
    }
    const index = tabs.findIndex((t) => t.id === activeTab);
    const last = tabs.length - 1;
    const targets: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const target = tabs[targets[event.key] ?? -1];
    if (!target) return;
    event.preventDefault();
    onSelect(target.id);
    document.getElementById(workflowTabId(target.id))?.focus();
  };
  return (
    <div className="tab-strip">
      {tabs.length === 0 ? (
        <span className="muted">No files open</span>
      ) : (
        <div className="workflow-tabs">
          <div
            role="tablist"
            aria-label="Open workflows and files"
            className="workflow-tablist"
            onKeyDown={move}
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={workflowTabId(t.id)}
                className="workflow-tab"
                title={t.title}
                aria-selected={activeTab === t.id}
                aria-controls="canvas-panel"
                aria-keyshortcuts={t.kind === "file" ? "Delete" : undefined}
                tabIndex={activeTab === t.id ? 0 : -1}
                onClick={() => onSelect(t.id)}
              >
                {t.label}
                {t.kind === "file" ? (
                  // pointer-only: keyboard users close with Delete, so this stays out of the tab order and the a11y tree
                  <span
                    className="workflow-tab-close"
                    aria-hidden="true"
                    title={`Close ${t.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(t.id);
                    }}
                  >
                    <GlyphIcon name="close" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {controls}
      {readOnly || active === undefined || modes.length === 0 ? null : (
        <ViewModeToggle
          modes={modes}
          mode={active.mode}
          onChange={(mode) => onMode(active.id, mode)}
        />
      )}
    </div>
  );
}

export function TabStrip(): JSX.Element {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const selectTab = useWorkspace((s) => s.selectTab);
  const setMode = useWorkspace((s) => s.setMode);
  const closeTab = useWorkspace((s) => s.closeTab);
  const readOnly = useReadOnly();
  return (
    <TabStripView
      tabs={tabs}
      activeTab={activeTab}
      controls={readOnly ? null : <HistoryControls />}
      readOnly={readOnly}
      onSelect={(id) => void selectTab(id)}
      onMode={setMode}
      onClose={(id, byKeyboard) =>
        void closeTab(id).then(() => {
          const next = canvasStore.getState().activeTab;
          if (byKeyboard && next !== null)
            requestAnimationFrame(() =>
              document.getElementById(workflowTabId(next))?.focus(),
            );
        })
      }
    />
  );
}
