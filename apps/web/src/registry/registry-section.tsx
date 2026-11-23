import type { RegistryErrorCode } from "@nf-builder/sources";
import { type JSX, useEffect, useState } from "react";
import { ChevronIcon, RefreshIcon } from "../shell/icons";
import { formatBuildTime, sourceLine } from "./age";
import { type RegistryState, useRegistry } from "./registry-store";

/** The interim lists show this many names each; F-503 replaces them. */
export const REGISTRY_LIST_LIMIT = 50;

const SOURCE_ID = "registry-source";

const FAILURE_MESSAGES: Record<RegistryErrorCode, string> = {
  unavailable: "No registry snapshot is available on this site.",
  network:
    "Couldn't load registry modules. Check your connection, then refresh.",
  timeout:
    "Couldn't load registry modules. Check your connection, then refresh.",
  invalid: "The registry snapshot couldn't be read.",
  http: "The registry snapshot couldn't be read.",
};

export interface RegistrySectionViewProps {
  readonly state: RegistryState;
  readonly now: Date;
  readonly searching: boolean;
  readonly open: { readonly modules: boolean; readonly plugins: boolean };
  readonly onToggle: (list: "modules" | "plugins") => void;
  readonly onRefresh: () => void;
}

interface Row {
  readonly key: string;
  readonly label: string;
  readonly title: string;
}

function RegistryList({
  id,
  label,
  noun,
  rows,
  total,
  open,
  onToggle,
}: {
  readonly id: string;
  readonly label: string;
  readonly noun: string;
  readonly rows: readonly Row[];
  readonly total: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const listId = `registry-${id}`;
  return (
    <div className="registry-list">
      <h3 className="palette-category-heading">
        <button
          type="button"
          className="palette-category-button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
        >
          <ChevronIcon direction={open ? "down" : "right"} />
          {label}
        </button>
      </h3>
      <div id={listId} hidden={!open}>
        <ul className="registry-items" aria-label={label}>
          {rows.map((row) => (
            <li key={row.key} className="registry-item" title={row.title}>
              <span className="registry-item-label">{row.label}</span>
            </li>
          ))}
        </ul>
        {total > rows.length ? (
          <p className="registry-note">
            Showing {rows.length.toLocaleString("en-GB")} of{" "}
            {total.toLocaleString("en-GB")} {noun}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Presentational: the registry.nextflow.io section of the palette (UX-14). */
export function RegistrySectionView({
  state,
  now,
  searching,
  open,
  onToggle,
  onRefresh,
}: RegistrySectionViewProps): JSX.Element {
  const index = state.status === "ready" ? state.index : null;
  const refreshing =
    (state.status === "ready" || state.status === "failed") && state.refreshing;
  const canRefresh = state.status === "ready" || state.status === "failed";
  let line: string;
  if (refreshing) line = "Refreshing…";
  else if (index) line = sourceLine(index, now);
  else if (state.status === "failed")
    line = FAILURE_MESSAGES[state.failure.code];
  else line = "Loading registry modules…";

  return (
    <section aria-labelledby="registry-heading" className="palette-registry">
      <div className="registry-heading-row">
        <h2 id="registry-heading" className="palette-heading">
          registry.nextflow.io
        </h2>
        <button
          type="button"
          className="registry-refresh"
          aria-label="Refresh registry data"
          aria-describedby={SOURCE_ID}
          aria-busy={refreshing}
          disabled={!canRefresh || refreshing}
          title={
            index
              ? `${index.source === "live" ? "Live data read" : "Snapshot built"} ${formatBuildTime(index.asOf)}`
              : "Refresh registry data"
          }
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
      </div>
      <p id={SOURCE_ID} className="registry-source" aria-live="polite">
        {line}
      </p>
      {index?.liveFailure ? (
        <p className="registry-note">The live registry couldn't be reached.</p>
      ) : null}
      {state.status === "ready" && state.refreshFailure ? (
        <p className="registry-note">Couldn't refresh the registry data.</p>
      ) : null}
      {index && !searching ? (
        <>
          <RegistryList
            id="modules"
            label="Modules"
            noun="modules"
            rows={index.modules.slice(0, REGISTRY_LIST_LIMIT).map((m) => ({
              key: m.name,
              label: m.name,
              title: m.description,
            }))}
            total={index.modules.length}
            open={open.modules}
            onToggle={() => onToggle("modules")}
          />
          <RegistryList
            id="plugins"
            label="Plugins"
            noun="plugins"
            rows={index.plugins.slice(0, REGISTRY_LIST_LIMIT).map((p) => ({
              key: p.id,
              label: p.id,
              title: p.summary,
            }))}
            total={index.plugins.length}
            open={open.plugins}
            onToggle={() => onToggle("plugins")}
          />
        </>
      ) : null}
    </section>
  );
}

/** Wires the store, a 60 s clock and session-only open state. */
export function RegistrySection({
  searching,
}: {
  readonly searching: boolean;
}): JSX.Element {
  const state = useRegistry((s) => s.state);
  const load = useRegistry((s) => s.load);
  const refresh = useRegistry((s) => s.refresh);
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState({ modules: true, plugins: false });
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <RegistrySectionView
      state={state}
      now={now}
      searching={searching}
      open={open}
      onToggle={(list) => setOpen((o) => ({ ...o, [list]: !o[list] }))}
      onRefresh={refresh}
    />
  );
}
