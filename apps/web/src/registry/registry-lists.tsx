import { type ModuleGroup, moduleMarks, shortName } from "@nf-builder/sources";
import type { JSX } from "react";
import { GlyphIcon, PALETTE_GLYPHS } from "../glyphs";
import { ChevronIcon } from "../shell/icons";
import { REGISTRY_PAGE, useLazyWindow, windowOf } from "./lazy-window";

const count = (n: number) => n.toLocaleString("en-GB");

type Plugin = { readonly id: string; readonly summary: string };

function RegistryRow({
  name,
  label,
  title,
  icon,
  typed,
  announceKind,
}: {
  readonly name: string;
  readonly label: string;
  readonly title: string;
  readonly icon: "process" | "workflow" | "plugin";
  readonly typed?: boolean;
  readonly announceKind?: boolean;
}): JSX.Element {
  return (
    <li className="registry-item" data-name={name} title={title}>
      <GlyphIcon glyph={PALETTE_GLYPHS[icon]} className="palette-glyph" />
      {announceKind ? <span className="visually-hidden">{icon}</span> : null}
      <span className="registry-item-label">{label}</span>
      {typed ? <span className="registry-badge-typed">typed</span> : null}
    </li>
  );
}

function ShowMore({
  next,
  total,
  more,
  sentinelRef,
}: {
  readonly next: number;
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
      Show {count(next)} more (of {count(total)})
    </button>
  );
}

function LazyRows<T>({
  items,
  label,
  row,
}: {
  readonly items: readonly T[];
  readonly label: string;
  readonly row: (item: T) => JSX.Element;
}): JSX.Element {
  const total = items.length;
  const { limit, more, sentinelRef } = useLazyWindow(total, items);
  const { shown, remaining } = windowOf(items, limit);
  return (
    <>
      <ul className="registry-items" aria-label={label}>
        {shown.map(row)}
      </ul>
      {remaining > 0 ? (
        <ShowMore
          next={Math.min(REGISTRY_PAGE, remaining)}
          total={total}
          more={more}
          sentinelRef={sentinelRef}
        />
      ) : null}
    </>
  );
}

function ListHeading({
  title,
  total,
  controls,
  listOpen,
  searching,
  onToggle,
}: {
  readonly title: string;
  readonly total: number;
  readonly controls: string;
  readonly listOpen: boolean;
  readonly searching: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  return (
    <h3 className="palette-category-heading">
      <button
        type="button"
        className="palette-category-button"
        aria-expanded={listOpen}
        aria-controls={controls}
        aria-disabled={searching ? "true" : undefined}
        onClick={() => {
          if (!searching) onToggle();
        }}
      >
        <ChevronIcon direction={listOpen ? "down" : "right"} />
        {title}
        <span className="registry-count">{count(total)}</span>
      </button>
    </h3>
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
      <ListHeading
        title="Modules"
        total={total}
        controls="registry-modules"
        listOpen={listOpen}
        searching={searching}
        onToggle={onToggle}
      />
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
                    {groupOpen ? (
                      <LazyRows
                        items={group.modules}
                        label={group.namespace}
                        row={(m) => {
                          const marks = moduleMarks(m);
                          return (
                            <RegistryRow
                              key={m.name}
                              name={m.name}
                              label={shortName(m.name)}
                              title={`${m.name} · ${m.description}`}
                              icon={marks.kind}
                              typed={marks.typed}
                              announceKind
                            />
                          );
                        }}
                      />
                    ) : null}
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
      <ListHeading
        title="Plugins"
        total={plugins.length}
        controls="registry-plugins"
        listOpen={listOpen}
        searching={searching}
        onToggle={onToggle}
      />
      <div id="registry-plugins" hidden={!listOpen}>
        {listOpen ? (
          <LazyRows
            items={plugins}
            label="Plugins"
            row={(p) => (
              <RegistryRow
                key={p.id}
                name={p.id}
                label={p.id}
                title={p.summary}
                icon="plugin"
              />
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
