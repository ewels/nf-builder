import type { JSX, KeyboardEvent, ReactNode } from "react";
import { useWorkspace, type WorkflowTab } from "../canvas/canvas-store";
import { HistoryControls } from "../history/history-controls";
import type { ViewMode } from "../views/view-mode";
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
}: {
  readonly tabs: readonly WorkflowTab[];
  readonly activeTab: string | null;
  readonly controls: ReactNode;
  readonly onSelect: (id: string) => void;
  readonly onMode: (id: string, mode: ViewMode) => void;
  readonly onClose: (id: string) => void;
}): JSX.Element {
  const active = tabs.find((t) => t.id === activeTab);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
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
        <div
          role="tablist"
          aria-label="Open workflows and files"
          className="workflow-tabs"
          onKeyDown={move}
        >
          {tabs.map((t) => (
            <span key={t.id} className="workflow-tab-item">
              <button
                type="button"
                role="tab"
                id={workflowTabId(t.id)}
                className="workflow-tab"
                title={t.title}
                aria-selected={activeTab === t.id}
                aria-controls="canvas-panel"
                tabIndex={activeTab === t.id ? 0 : -1}
                onClick={() => onSelect(t.id)}
              >
                {t.label}
              </button>
              {t.kind === "file" ? (
                <button
                  type="button"
                  className="workflow-tab-close"
                  aria-label={`Close ${t.label}`}
                  title={`Close ${t.label}`}
                  onClick={() => onClose(t.id)}
                >
                  <GlyphIcon name="close" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}
      {controls}
      {active === undefined || active.kind === "file" ? null : (
        <ViewModeToggle
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
  return (
    <TabStripView
      tabs={tabs}
      activeTab={activeTab}
      controls={<HistoryControls />}
      onSelect={(id) => void selectTab(id)}
      onMode={setMode}
      onClose={(id) => void closeTab(id)}
    />
  );
}
