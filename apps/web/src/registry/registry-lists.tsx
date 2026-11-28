import { type ModuleGroup, moduleMarks, shortName } from "@nf-builder/sources";
import type { JSX } from "react";
import { GlyphIcon, PALETTE_GLYPHS } from "../glyphs";
import { ChevronIcon } from "../shell/icons";
import { REGISTRY_PAGE, useLazyWindow, windowOf } from "./lazy-window";

const count = (n: number) => n.toLocaleString("en-GB");

type Plugin = { readonly id: string; readonly summary: string };

export function RegistryRow({
  name,
  label,
  title,
  icon,
  typed,
  kindWord,
}: {
  readonly name: string;
  readonly label: string;
  readonly title: string;
  readonly icon: "process" | "workflow" | "plugin";
  readonly typed?: boolean;
  readonly kindWord?: string;
}): JSX.Element {
  return (
    <li className="registry-item" data-name={name} title={title}>
      <GlyphIcon glyph={PALETTE_GLYPHS[icon]} className="palette-glyph" />
      {kindWord ? <span className="visually-hidden">{kindWord}</span> : null}
      <span className="registry-item-label">{label}</span>
      {typed ? <span className="registry-badge-typed">typed</span> : null}
    </li>
  );
}

function ShowMore({
  batch,
  total,
  more,
  sentinelRef,
}: {
  readonly batch: number;
  readonly total: number;
  readonly more: () => void;
  readonly sentinelRef: (el: HTMLElement | null) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="registry-more"
      ref={sentinelRef}
      onClick={more}
    >
      Show more ({count(batch)} of {count(total)})
    </button>
  );
}

function ModuleRows({ group }: { readonly group: ModuleGroup }): JSX.Element {
  const total = group.modules.length;
  const { limit, more, sentinelRef } = useLazyWindow(total, group.modules);
  const { shown, remaining } = windowOf(group.modules, limit);
  return (
    <>
      <ul className="registry-items" aria-label={group.namespace}>
        {shown.map((m) => {
          const marks = moduleMarks(m);
          return (
            <RegistryRow
              key={m.name}
              name={m.name}
              label={shortName(m.name)}
              title={`${m.name} · ${m.description}`}
              icon={marks.kind}
              typed={marks.typed}
              kindWord={marks.kind}
            />
          );
        })}
      </ul>
      {remaining > 0 ? (
        <ShowMore
          batch={Math.min(REGISTRY_PAGE, remaining)}
          total={total}
          more={more}
          sentinelRef={sentinelRef}
        />
      ) : null}
    </>
  );
}

function PluginRows({
  plugins,
}: {
  readonly plugins: readonly Plugin[];
}): JSX.Element {
  const total = plugins.length;
  const { limit, more, sentinelRef } = useLazyWindow(total, plugins);
  const { shown, remaining } = windowOf(plugins, limit);
  return (
    <>
      <ul className="registry-items" aria-label="Plugins">
        {shown.map((p) => (
          <RegistryRow
            key={p.id}
            name={p.id}
            label={p.id}
            title={p.summary}
            icon="plugin"
          />
        ))}
      </ul>
      {remaining > 0 ? (
        <ShowMore
          batch={Math.min(REGISTRY_PAGE, remaining)}
          total={total}
          more={more}
          sentinelRef={sentinelRef}
        />
      ) : null}
    </>
  );
}

export function RegistryModules({
  groups,
  total,
  open,
  searching,
  collapsed,
  onToggle,
  onToggleNamespace,
}: {
  readonly groups: readonly ModuleGroup[];
  readonly total: number;
  readonly open: boolean;
  readonly searching: boolean;
  readonly collapsed: ReadonlySet<string>;
  readonly onToggle: () => void;
  readonly onToggleNamespace: (namespace: string) => void;
}): JSX.Element {
  const listOpen = searching || open;
  return (
    <div className="registry-list">
      <h3 className="palette-category-heading">
        <button
          type="button"
          className="palette-category-button"
          aria-expanded={listOpen}
          aria-controls="registry-modules"
          aria-disabled={searching ? "true" : undefined}
          onClick={() => {
            if (!searching) onToggle();
          }}
        >
          <ChevronIcon direction={listOpen ? "down" : "right"} />
          Modules
          <span className="registry-count">{count(total)}</span>
        </button>
      </h3>
      <div id="registry-modules" hidden={!listOpen}>
        {listOpen
          ? groups.map((group) => {
              const groupId = `registry-ns-${group.namespace}`;
              const groupOpen = searching || !collapsed.has(group.namespace);
              return (
                <div key={group.namespace} className="registry-group">
                  <h4 className="registry-group-heading">
                    <button
                      type="button"
                      className="palette-category-button registry-group-button"
                      aria-expanded={groupOpen}
                      aria-controls={groupId}
                      aria-disabled={searching ? "true" : undefined}
                      onClick={() => {
                        if (!searching) onToggleNamespace(group.namespace);
                      }}
                    >
                      <ChevronIcon direction={groupOpen ? "down" : "right"} />
                      <span>{group.namespace}</span>
                      <span className="registry-count">
                        {count(group.modules.length)}
                      </span>
                    </button>
                  </h4>
                  <div id={groupId} hidden={!groupOpen}>
                    {groupOpen ? <ModuleRows group={group} /> : null}
                  </div>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}

export function RegistryPlugins({
  plugins,
  open,
  searching,
  onToggle,
}: {
  readonly plugins: readonly Plugin[];
  readonly open: boolean;
  readonly searching: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const listOpen = searching || open;
  return (
    <div className="registry-list">
      <h3 className="palette-category-heading">
        <button
          type="button"
          className="palette-category-button"
          aria-expanded={listOpen}
          aria-controls="registry-plugins"
          aria-disabled={searching ? "true" : undefined}
          onClick={() => {
            if (!searching) onToggle();
          }}
        >
          <ChevronIcon direction={listOpen ? "down" : "right"} />
          Plugins
          <span className="registry-count">{count(plugins.length)}</span>
        </button>
      </h3>
      <div id="registry-plugins" hidden={!listOpen}>
        {listOpen ? <PluginRows plugins={plugins} /> : null}
      </div>
    </div>
  );
}
