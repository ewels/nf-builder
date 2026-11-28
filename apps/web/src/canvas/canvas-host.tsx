import { edgeMismatches } from "@nf-builder/engine";
import type { JSX } from "react";
import { lazy, Suspense, useMemo } from "react";
import { paletteAdd } from "../palette/use-palette-add";
import { openPopup } from "../popup/popup-store";
import { useProblems } from "../problems/problems-store";
import { CanvasPlaceholder } from "../project/project-status";
import { useProjects } from "../project/project-store";
import { useReadOnly } from "../read-only/read-only-store";
import { CanvasErrorBoundary } from "./canvas-error-boundary";
import { useWorkspace } from "./canvas-store";

// React Flow is in this chunk only (QA-01, ADR 0003).
const WorkflowCanvas = lazy(() => import("./workflow-canvas"));

export function CanvasHost(): JSX.Element {
  const summary = useWorkspace((s) => s.summary);
  const projects = useProjects((s) => s.status);
  const activeTab = useWorkspace((s) => s.activeTab);
  const content = useWorkspace((s) => s.content);
  const portLabels = useWorkspace((s) => s.portLabels);
  const setPortLabels = useWorkspace((s) => s.setPortLabels);
  const selected = useWorkspace((s) => s.selected);
  const select = useWorkspace((s) => s.select);
  const focus = useWorkspace((s) => s.focusNode);
  const layoutNotice = useWorkspace((s) => s.layoutNotice);
  const readOnly = useReadOnly();
  const moveNodes = useWorkspace((s) => s.moveNodes);
  const placeNodes = useWorkspace((s) => s.placeNodes);
  const connect = useWorkspace((s) => s.connect);
  const disconnect = useWorkspace((s) => s.disconnect);
  const connectionTargets = useWorkspace((s) => s.connectionTargets);
  const canvasNotice = useWorkspace((s) => s.canvasNotice);
  const navigationNotice = useWorkspace((s) => s.navigationNotice);
  const openCallee = useWorkspace((s) => s.openCallee);
  const diagnostics = useProblems((s) => s.diagnostics);
  const diagnosedAt = useProblems((s) => s.revision);
  const shownRevision = content.status === "ready" ? content.revision : null;
  const shownProjection =
    content.status === "ready" ? content.projection : null;
  // red only for diagnostics made at the revision on screen (UX-24, LA-32)
  const mismatches = useMemo(
    () =>
      shownProjection === null || diagnosedAt !== shownRevision
        ? new Map<string, string>()
        : edgeMismatches(shownProjection, diagnostics),
    [shownProjection, shownRevision, diagnosedAt, diagnostics],
  );
  if (summary === null)
    return (
      <div className="canvas-area">
        <CanvasPlaceholder status={projects} />
      </div>
    );
  let body: JSX.Element;
  if (content.status === "ready")
    body = (
      <CanvasErrorBoundary>
        <Suspense fallback={<p className="muted">Loading canvas…</p>}>
          <WorkflowCanvas
            key={activeTab ?? ""}
            tab={activeTab ?? ""}
            refit={content.refit}
            onPaletteDrop={(key, at) => void paletteAdd({ key }, at)}
            projection={content.projection}
            readOnly={readOnly}
            portLabels={portLabels}
            onPortLabelsChange={setPortLabels}
            selected={selected}
            focus={focus}
            onSelect={(id) => void select(id)}
            positions={content.positions}
            mismatches={mismatches}
            onConnectionTargets={connectionTargets}
            onConnect={(from, to) => void connect(from, to)}
            onDisconnect={(port) => void disconnect(port)}
            onOpenCallee={(node) => void openCallee(node)}
            onOpenNode={
              readOnly
                ? undefined
                : (node, opener) =>
                    void openPopup({ tab: activeTab ?? "", node, opener })
            }
            notices={[
              layoutNotice,
              content.notice,
              canvasNotice,
              navigationNotice,
            ].filter((m): m is string => m !== null)}
            onMove={(moves) => void moveNodes(moves)}
            onPlace={(placement) =>
              void placeNodes(
                { tab: activeTab ?? "", revision: content.revision },
                placement,
              )
            }
          />
        </Suspense>
      </CanvasErrorBoundary>
    );
  else if (content.status === "unavailable")
    body = <p className="muted">{content.message}</p>;
  else if (content.status === "loading")
    body = <p className="muted">Loading workflow…</p>;
  else body = <p className="muted">No workflow open</p>;
  return <div className="canvas-area">{body}</div>;
}
