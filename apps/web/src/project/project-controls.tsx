// The connected project switcher and whichever dialog is open (F-202, F-203). The dialog state is in the store, so the
// header's Templates button opens the New project dialog too.
import { installedPackVersions } from "@nf-builder/engine";
import { type JSX, useEffect, useRef } from "react";
import { focusTarget } from "./focus-target";
import { NewProjectDialog } from "./new-project-dialog";
import { DeleteProjectDialog, ProjectNameDialog } from "./project-dialogs";
import { useProjects } from "./project-store";
import { ProjectSwitcher } from "./project-switcher";
import { useTemplates } from "./templates";

const languageVersions = installedPackVersions();

export function ProjectControls(): JSX.Element {
  const status = useProjects((s) => s.status);
  const opener = useProjects((s) => s.opener);
  const dialog = useProjects((s) => s.dialog);
  const create = useProjects((s) => s.create);
  const open = useProjects((s) => s.open);
  const rename = useProjects((s) => s.rename);
  const remove = useProjects((s) => s.remove);
  const showDialog = useProjects((s) => s.showDialog);
  const closeDialog = useProjects((s) => s.closeDialog);
  // a dialog's own unmount can't restore focus, so put it back on the element that opened it once the dialog has gone
  // (WCAG 2.4.3). The store recorded that element when the dialog was requested, before the dialog took focus; if it has
  // left the page, the switcher's button gets focus.
  const button = useRef<HTMLButtonElement>(null);
  const shown = useRef(false);
  useEffect(() => {
    if (dialog === null && shown.current) {
      focusTarget(opener, button.current)?.focus();
    }
    shown.current = dialog !== null;
  }, [dialog, opener]);
  const { current } = status;
  return (
    <>
      <ProjectSwitcher
        projects={status.projects}
        current={current}
        buttonRef={button}
        disabled={status.storage !== "ready"}
        onOpen={(id) => void open(id).catch(() => undefined)} // the status carries `openError`
        onNew={() => showDialog({ kind: "new", route: "blank" })}
        onRename={() => showDialog({ kind: "rename" })}
        onDelete={() => showDialog({ kind: "delete" })}
      />
      {dialog?.kind === "new" ? (
        <NewProjectDialog
          languageVersions={languageVersions}
          useTemplates={useTemplates}
          projects={status.projects}
          currentId={current?.id ?? null}
          initialRoute={dialog.route}
          onCreate={create}
          onOpen={open}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "rename" && current ? (
        <ProjectNameDialog
          initialName={current.name}
          onSubmit={(name) => rename(current.id, name)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "delete" && current ? (
        <DeleteProjectDialog
          project={current}
          onConfirm={() => remove(current.id)}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}
