import type { JSX, KeyboardEvent } from "react";
import { useWorkspace } from "../canvas/canvas-store";
import { HistoryControls } from "../history/history-controls";
import { ViewModeToggle } from "../views/view-mode-toggle";

export const workflowTabId = (id: string): string => `workflow-tab-${id}`;

export function TabStrip(): JSX.Element {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const selectTab = useWorkspace((s) => s.selectTab);
  const setMode = useWorkspace((s) => s.setMode);
  const active = tabs.find((t) => t.id === activeTab);
  if (tabs.length === 0)
    return (
      <div className="tab-strip">
        <span className="muted">No files open</span>
        <HistoryControls />
      </div>
    );
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
    void selectTab(target.id);
    document.getElementById(workflowTabId(target.id))?.focus();
  };
  return (
    <div className="tab-strip">
      <div
        role="tablist"
        aria-label="Workflows"
        className="workflow-tabs"
        onKeyDown={move}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={workflowTabId(t.id)}
            className="workflow-tab"
            aria-selected={activeTab === t.id}
            aria-controls="canvas-panel"
            tabIndex={activeTab === t.id ? 0 : -1}
            onClick={() => void selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <HistoryControls />
      {active === undefined ? null : (
        <ViewModeToggle
          mode={active.mode}
          onChange={(mode) => setMode(active.id, mode)}
        />
      )}
    </div>
  );
}
