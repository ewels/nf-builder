import {
  groupModules,
  type RegistryErrorCode,
  type RegistryMatches,
} from "@nf-builder/sources";
import { type JSX, useEffect, useMemo, useState } from "react";
import { addRegistryPlugin } from "../palette/use-palette-add";
import { useReadOnly } from "../read-only/read-only-store";
import { RefreshIcon } from "../shell/icons";
import { formatAge, formatBuildTime, sourceName } from "./age";
import { usePlugins } from "./plugin-store";
import { RegistryModules, RegistryPlugins } from "./registry-lists";
import { type RegistryState, useRegistry } from "./registry-store";

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

interface RegistrySectionViewProps {
  readonly state: RegistryState;
  readonly now: Date;
  readonly query: string;
  /** Null until the registry is ready; the whole index when the query is empty. */
  readonly matches: RegistryMatches | null;
  readonly open: { readonly modules: boolean; readonly plugins: boolean };
  /** Namespaces the user has collapsed. */
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: (list: "modules" | "plugins") => void;
  readonly onToggleNamespace: (namespace: string) => void;
  readonly onRefresh: () => void;
  /** Ids of the plugins `nextflow.config` declares (F-505). */
  readonly declared?: ReadonlySet<string>;
  readonly readOnly?: boolean;
  readonly onAddPlugin?: (id: string) => void;
}

const NO_PLUGINS: ReadonlySet<string> = new Set();

/** Presentational: the registry.nextflow.io section of the palette (UX-14). */
export function RegistrySectionView({
  state,
  now,
  query,
  matches,
  open,
  collapsed,
  onToggle,
  onToggleNamespace,
  onRefresh,
  declared = NO_PLUGINS,
  readOnly = false,
  onAddPlugin = () => undefined,
}: RegistrySectionViewProps): JSX.Element {
  const searching = query.trim() !== "";
  const groups = useMemo(
    () => (matches ? groupModules(matches.modules) : []),
    [matches],
  );
  const index = state.status === "ready" ? state.index : null;
  const canRefresh = state.status === "ready" || state.status === "failed";
  const refreshing = canRefresh && state.refreshing;
  // The live region holds only what changes on a state change; the age ticks outside it.
  let status: string;
  if (refreshing) status = "Refreshing…";
  else if (index) status = sourceName(index);
  else if (state.status === "failed")
    status = FAILURE_MESSAGES[state.failure.code];
  else status = "Loading registry modules…";
  const age =
    index && !refreshing ? ` · updated ${formatAge(index.asOf, now)}` : null;
  const title = !index
    ? "Refresh registry data"
    : index.source === "live"
      ? `Live data read ${formatBuildTime(index.asOf)}; snapshot built ${formatBuildTime(index.snapshotAt)}`
      : `Snapshot built ${formatBuildTime(index.asOf)}`;

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
          title={title}
          onClick={onRefresh}
        >
          <RefreshIcon />
        </button>
      </div>
      <p id={SOURCE_ID} className="registry-source">
        <span aria-live="polite">{status}</span>
        {age === null ? null : <span>{age}</span>}
      </p>
      {index?.liveFailure ? (
        <p className="registry-note">The live registry couldn't be reached.</p>
      ) : null}
      {state.status === "ready" && state.refreshFailure ? (
        <p className="registry-note">Couldn't refresh the registry data.</p>
      ) : null}
      {index && matches ? (
        searching && matches.modules.length + matches.plugins.length === 0 ? (
          <p className="registry-note">No registry modules or plugins match.</p>
        ) : (
          <>
            {!searching || matches.modules.length > 0 ? (
              <RegistryModules
                groups={groups}
                total={matches.modules.length}
                open={open.modules}
                searching={searching}
                collapsed={collapsed}
                onToggle={() => onToggle("modules")}
                onToggleNamespace={onToggleNamespace}
              />
            ) : null}
            {!searching || matches.plugins.length > 0 ? (
              <RegistryPlugins
                plugins={matches.plugins}
                open={open.plugins}
                searching={searching}
                declared={declared}
                readOnly={readOnly}
                onToggle={() => onToggle("plugins")}
                onAdd={onAddPlugin}
              />
            ) : null}
          </>
        )
      ) : null}
    </section>
  );
}

/** Wires the store, a 60 s clock and session-only open state. */
export function RegistrySection({
  query,
  matches,
}: {
  readonly query: string;
  readonly matches: RegistryMatches | null;
}): JSX.Element {
  const state = useRegistry((s) => s.state);
  const load = useRegistry((s) => s.load);
  const refresh = useRegistry((s) => s.refresh);
  const readOnly = useReadOnly();
  const declaredPlugins = usePlugins((s) => s.declared);
  const declared = useMemo(
    () => new Set(declaredPlugins.map((p) => p.id)),
    [declaredPlugins],
  );
  const [now, setNow] = useState(() => new Date());
  const [open, setOpen] = useState({ modules: true, plugins: false });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
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
      query={query}
      matches={matches}
      open={open}
      collapsed={collapsed}
      onToggle={(list) => setOpen((o) => ({ ...o, [list]: !o[list] }))}
      onToggleNamespace={(ns) =>
        setCollapsed((c) => {
          const next = new Set(c);
          if (!next.delete(ns)) next.add(ns);
          return next;
        })
      }
      onRefresh={refresh}
      declared={declared}
      readOnly={readOnly}
      onAddPlugin={(id) => void addRegistryPlugin(id)}
    />
  );
}
