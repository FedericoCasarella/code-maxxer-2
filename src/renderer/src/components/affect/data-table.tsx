"use client";

import { t } from "@/lib/i18n";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pagination } from "./pagination";
import { Marquee } from "../app/Marquee";

/**
 * Data Table (affectUI, classic look), recreated for code-maxxer as a read-only list: an icon on every column,
 * sorting from the header, a filter on every column and pages underneath.
 */

export type DataTableColumn<T> = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** CSS width of the column, e.g. "40%" or 120 */
  width?: number | string;
  /** The cell; without it the column shows `value` as text */
  render?: (row: T) => ReactNode;
  /** What sorting and filtering read; a string or a number */
  value?: (row: T) => string | number | null | undefined;
  /** What the filter reads when it differs from the sort (e.g. "Today" for a date) */
  filterValue?: (row: T) => string | number | null | undefined;
  /** "text": a search field · "options": pick among the values the column has · false: none */
  filter?: "text" | "options" | false;
  /** Label of an option in the "options" filter (defaults to the value) */
  optionLabel?: (value: string) => ReactNode;
  sortable?: boolean;
  /** Text may wrap onto more lines instead of staying on one */
  wrap?: boolean;
  /** Clicks on this cell don't open the row (a menu in it) */
  stopRowClick?: boolean;
  className?: string;
};

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  /** Rows split under headed groups (e.g. Active / Paused), in this order */
  group?: { of: (row: T) => string; order: string[]; label: (key: string, count: number) => ReactNode };
  title?: ReactNode;
  titleIcon?: ReactNode;
  /** Right side of the header */
  tools?: ReactNode;
  pageSize?: number;
  /** Shown when no row is left */
  empty?: ReactNode;
  /** Classes on each row (e.g. a hover target for marquees) */
  rowClassName?: string;
  className?: string;
}

type Sort = { id: string; dir: "asc" | "desc" } | null;
type Filters = Record<string, string | string[]>;

/** Which stretch of time a date falls in: the options of a date column's filter */
export function period(at: number) {
  const days = (Date.now() - at) / 86_400_000;
  return days < 1 ? t("Today") : days < 7 ? t("Last 7 days") : days < 30 ? t("Last 30 days") : t("Older");
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function DataTable<T>({ columns, rows, rowKey, onRowClick, onRowDoubleClick, group, title, titleIcon, tools, pageSize = 10, empty, rowClassName, className }: DataTableProps<T>) {
  const [sort, setSort] = useState<Sort>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [picker, setPicker] = useState<{ id: string; x: number; y: number } | null>(null);

  const shown = useMemo(() => {
    let list = rows.filter((r) =>
      columns.every((c) => {
        const f = filters[c.id];
        const read = c.filterValue ?? c.value;
        if (!f || (Array.isArray(f) && !f.length) || !read) return true;
        const v = str(read(r));
        return Array.isArray(f) ? f.includes(v) : v.toLowerCase().includes(f.toLowerCase());
      })
    );
    const col = sort && columns.find((c) => c.id === sort.id);
    if (col?.value) {
      const k = sort!.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = col.value!(a), y = col.value!(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : str(x).localeCompare(str(y), undefined, { numeric: true, sensitivity: "base" })) * k;
      });
    }
    if (group) {
      const rank = (r: T) => {
        const i = group.order.indexOf(group.of(r));
        return i < 0 ? group.order.length : i;
      };
      list = list.map((r, i) => [r, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
    }
    return list;
  }, [rows, columns, filters, sort, group]);
  const groupCount = (key: string) => (group ? shown.filter((r) => group.of(r) === key).length : 0);

  const pages = Math.max(1, Math.ceil(shown.length / size));
  const current = Math.min(page, pages);
  const slice = shown.slice((current - 1) * size, current * size);
  // A filter or a sort starts again from the first page
  useEffect(() => setPage(1), [filters, sort]);

  const cycle = (id: string) =>
    setSort((s) => (s?.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));
  const active = (id: string) => {
    const f = filters[id];
    return Array.isArray(f) ? f.length > 0 : !!f;
  };
  const pickCol = picker && columns.find((c) => c.id === picker.id);

  return (
    <section className={["ui-dt", className].filter(Boolean).join(" ")}>
      <style href="ui-data-table" precedence="default">
        {css}
      </style>
      {(title || tools) && (
        <header className="ui-dt__head">
          {titleIcon && <span className="ui-dt__title-icon">{titleIcon}</span>}
          {title && <h3 className="ui-dt__title">{title}</h3>}
          {tools && <div className="ui-dt__tools">{tools}</div>}
        </header>
      )}
      <div className="ui-dt__card">
        <div className="ui-dt__scroll">
          <table className="ui-dt__table">
            <colgroup>
              {columns.map((c) => (
                <col key={c.id} style={c.width !== undefined ? { width: c.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr role="row">
                {columns.map((c) => {
                  const sortable = c.sortable !== false && !!c.value;
                  const dir = sort?.id === c.id ? sort.dir : undefined;
                  return (
                    <th
                      key={c.id}
                      role="columnheader"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                      data-col-active={dir || active(c.id) || undefined}
                    >
                      {c.label !== undefined && c.label !== null && c.label !== "" && (
                        <div className="ui-dt__th-row">
                          <button type="button" className="ui-dt__th" disabled={!sortable} onClick={() => sortable && cycle(c.id)}>
                            {c.icon && <span className="ui-dt__col-icon">{c.icon}</span>}
                            <Marquee className="ui-dt__th-label" delay={300} hoverTarget="th">{c.label}</Marquee>
                            {sortable && (
                              <span className="ui-dt__sort" data-dir={dir} aria-hidden="true">
                                <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M6 2.5v7M3.5 7l2.5 2.5L8.5 7" />
                                </svg>
                              </span>
                            )}
                          </button>
                          {c.filter && (c.filterValue || c.value) && (
                            <button
                              type="button"
                              className="ui-dt__filter"
                              data-active={active(c.id) || undefined}
                              aria-label={t("Filter")}
                              aria-expanded={picker?.id === c.id}
                              onClick={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setPicker(picker?.id === c.id ? null : { id: c.id, x: r.right, y: r.bottom + 6 });
                              }}
                            >
                              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M2.5 3.5h11l-4.25 5v4l-2.5 1v-5z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => {
                const g = group?.of(r);
                const head = group && (i === 0 || group.of(slice[i - 1]) !== g);
                return (
                  <Fragment key={rowKey(r)}>
                    {head && (
                      <tr className="ui-dt__group">
                        <td colSpan={columns.length}>{group!.label(g!, groupCount(g!))}</td>
                      </tr>
                    )}
                    <tr
                      role="row"
                      className={rowClassName}
                      data-clickable={onRowClick || onRowDoubleClick ? "" : undefined}
                      onClick={() => onRowClick?.(r)}
                      onDoubleClick={() => onRowDoubleClick?.(r)}
                    >
                      {columns.map((c) => (
                        <td
                          key={c.id}
                          role="gridcell"
                          className={c.className}
                          data-wrap={c.wrap || undefined}
                          onClick={c.stopRowClick ? (e) => e.stopPropagation() : undefined}
                          onDoubleClick={c.stopRowClick ? (e) => e.stopPropagation() : undefined}
                        >
                          {c.render ? c.render(r) : <span className="ui-dt__text">{str(c.value?.(r)) || "—"}</span>}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!slice.length && (empty ?? <p className="ui-dt__empty">{t("No results")}</p>)}
        </div>
      </div>
      <footer className="ui-dt__foot">
        <Pagination
          className="ui-dt__pages"
          page={current}
          onPageChange={setPage}
          total={shown.length}
          pageSize={size}
          pageSizes={[10, 20, 50, 100]}
          onPageSizeChange={setSize}
        />
      </footer>
      {picker && pickCol && (
        <FilterPicker
          key={picker.id}
          x={picker.x}
          y={picker.y}
          kind={pickCol.filter === "options" ? "options" : "text"}
          options={
            pickCol.filter === "options"
              ? optionsOf(rows, pickCol)
              : []
          }
          optionLabel={pickCol.optionLabel}
          value={filters[picker.id]}
          onChange={(v) => setFilters((f) => ({ ...f, [picker.id]: v }))}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}

/** The values a column has, in the order sorting would put them */
function optionsOf<T>(rows: T[], c: DataTableColumn<T>): string[] {
  const read = (c.filterValue ?? c.value)!;
  const seen = new Map<string, string | number>();
  for (const r of rows) {
    const v = read(r);
    if (v === null || v === undefined || v === "") continue;
    const k = str(v);
    // Ordered by the sort value of the first row that has it (dates: newest bucket first)
    if (!seen.has(k)) seen.set(k, c.filterValue && c.value ? (c.value(r) ?? k) : v);
  }
  return [...seen.entries()]
    .sort(([, a], [, b]) => (typeof a === "number" && typeof b === "number" ? (c.filterValue ? b - a : a - b) : str(a).localeCompare(str(b), undefined, { numeric: true })))
    .map(([k]) => k);
}

function FilterPicker({
  x,
  y,
  kind,
  options,
  optionLabel,
  value,
  onChange,
  onClose,
}: {
  x: number;
  y: number;
  kind: "text" | "options";
  options: string[];
  optionLabel?: (v: string) => ReactNode;
  value: string | string[] | undefined;
  onChange: (v: string | string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Its right edge on the filter button, kept inside the window
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x - w, innerWidth - w - 8)), top: y + h > innerHeight - 8 ? Math.max(8, y - h - 40) : y });
  }, [x, y]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      if (!ref.current?.contains(el) && !el.closest(".ui-dt__filter")) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const picked = Array.isArray(value) ? value : [];
  return (
    <div ref={ref} className="ui-dt__picker" role="dialog" aria-label={t("Filter")} style={{ left: pos.left, top: pos.top }}>
      {kind === "text" ? (
        <input
          autoFocus
          className="ui-dt__field"
          placeholder={t("Filter…")}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onClose()}
        />
      ) : (
        <div className="ui-dt__options" role="listbox" aria-multiselectable="true">
          {options.map((o) => {
            const on = picked.includes(o);
            return (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={on}
                className="ui-dt__option"
                onClick={() => onChange(on ? picked.filter((p) => p !== o) : [...picked, o])}
              >
                <span className="ui-dt__check" role="presentation" aria-checked={on}>
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4.25 8.25 2.5 2.5 5-5.5" />
                  </svg>
                </span>
                <span className="ui-dt__option-label">{optionLabel ? optionLabel(o) : o}</span>
              </button>
            );
          })}
        </div>
      )}
      {(Array.isArray(value) ? value.length > 0 : !!value) && (
        <button type="button" className="ui-dt__option ui-dt__clear" onClick={() => onChange(kind === "text" ? "" : [])}>
          {t("Clear filter")}
        </button>
      )}
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-dt {
  --ui-dt-card: var(--aui-surface, #ffffff);
  --ui-dt-line: #ececec;
  --ui-dt-grid: #f0f0f0;
  --ui-dt-ink: var(--aui-ink, #171717);
  --ui-dt-text: var(--aui-ink, #404040);
  --ui-dt-muted: var(--aui-muted, #8f8f8f);
  --ui-dt-faint: var(--aui-placeholder, #b5b5b5);
  --ui-dt-hover: var(--aui-subtle, #fafafa);
  --ui-dt-accent: var(--aui-blue, #4fb0fe);
  --ui-dt-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-dt-tray: var(--aui-subtle, #f0f0f0);
  --ui-dt-accent-ink: var(--aui-blue, #4fb0fe);
  --ui-dt-border: var(--aui-border, #e5e5e5);
  --ui-dt-col-active: #fafbff;
  --ui-dt-th-hover: var(--aui-subtle, #f6f6f6);
  --ui-dt-pop: var(--aui-overlay, #fff);
  --ui-dt-pop-ring: var(--aui-border, #e5e5e5);
  --ui-dt-option-hover: var(--aui-subtle, #f5f5f5);
  --ui-dt-check-bg: var(--aui-surface, #fff);
  --ui-dt-check-border: var(--aui-border-strong, #d4d4d4);
  --ui-dt-check-border-hover: #a3a3a3;
  --ui-dt-check-mark: var(--aui-on-primary, #fff);
  --ui-dt-wash: var(--aui-subtle, rgba(0, 0, 0, 0.05));
  --ui-dt-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  --ui-dt-pop-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.18);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  background: var(--ui-dt-tray);
  padding: 6px;
  border-radius: calc(var(--aui-radius-lg, 16px) + 6px);
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  color: var(--ui-dt-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-dt *, .ui-dt ::before, .ui-dt ::after { box-sizing: border-box; }
.ui-dt button { margin: 0; font: inherit; color: inherit; cursor: pointer; }
.ui-dt__head { display: flex; align-items: center; gap: 10px; padding: 9px 10px 8px 18px; min-height: 46px; }
.ui-dt__title { margin: 0; font-size: 15px; font-weight: 500; line-height: 22px; letter-spacing: -0.01em; }
.ui-dt__title-icon { display: grid; }
.ui-dt__title-icon svg { width: 18px; height: 18px; }
.ui-dt__tools { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.ui-dt__card { overflow: hidden; background: var(--ui-dt-card); border: 1px solid var(--ui-dt-border); border-radius: var(--aui-radius-lg, 16px); box-shadow: var(--ui-dt-card-shadow); }
.ui-dt__scroll { overflow-x: auto; scrollbar-width: thin; outline: none; }
.ui-dt__table { width: 100%; min-width: 640px; border-collapse: collapse; table-layout: fixed; font-size: 14px; line-height: 20px; }
.ui-dt__table th, .ui-dt__table td { position: relative; height: 44px; padding: 0 14px; border-top: 1px solid var(--aui-border, var(--ui-dt-grid)); border-left: 1px solid var(--aui-border, var(--ui-dt-grid)); text-align: left; vertical-align: middle; white-space: nowrap; overflow: hidden; }
.ui-dt__table td { padding-top: 8px; padding-bottom: 8px; }
.ui-dt__table th:first-child, .ui-dt__table td:first-child { border-left: 0; }
.ui-dt__table td[data-wrap] { white-space: normal; vertical-align: top; }
.ui-dt__group td { height: 34px; padding-top: 0; padding-bottom: 0; font-size: 12.5px; font-weight: 500; color: var(--ui-dt-muted); background: var(--ui-dt-hover); }
.ui-dt__table th { padding: 0 6px; font-weight: 450; color: var(--ui-dt-muted); border-top: 0; transition: background-color 140ms; }
.ui-dt__table th[data-col-active] { background: var(--ui-dt-col-active); }
.ui-dt__th-row { display: flex; align-items: center; gap: 2px; }
.ui-dt__th { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: 0; height: 32px; padding: 0 8px; border: 0; border-radius: calc(var(--aui-radius-sm, 7px) + 1px); background: transparent; text-align: left; transition: background-color 140ms, color 140ms; color: inherit !important; }
.ui-dt__th:hover:not(:disabled) { background: var(--ui-dt-th-hover); color: var(--ui-dt-text) !important; }
.ui-dt__th:disabled { cursor: default; }
.ui-dt__th:focus-visible { outline: 2px solid var(--ui-dt-focus); outline-offset: -2px; }
.ui-dt__th-label { min-width: 0; overflow: hidden; }
.ui-dt__th:hover .ui-dt__sort, .ui-dt__sort[data-dir] { margin-left: auto; padding-left: 0; }
.ui-dt__th-label + .ui-dt__sort { margin-left: auto; }
.ui-dt__col-icon { display: grid; flex: 0 0 auto; margin-right: 8px; color: var(--ui-dt-faint); }
.ui-dt__col-icon svg { width: 15px; height: 15px; }
.ui-dt__sort { display: grid; flex: 0 0 auto; width: 0; margin-left: auto; overflow: hidden; color: var(--ui-dt-faint); opacity: 0; transition: opacity 140ms ease, width 160ms var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1)), transform 220ms var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1)); }
.ui-dt__th:hover .ui-dt__sort { width: 11px; opacity: 1; }
.ui-dt__sort[data-dir] { width: 11px; opacity: 1; color: var(--ui-dt-accent-ink); }
.ui-dt__sort[data-dir="asc"] { transform: rotate(180deg); }
.ui-dt__filter { display: grid; place-items: center; flex: 0 0 auto; width: 0; height: 26px; padding: 0; overflow: hidden; border: 0; border-radius: calc(var(--aui-radius-sm, 7px) + 1px); background: transparent; opacity: 0; transition: opacity 140ms, width 160ms var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1)), background-color 140ms, color 140ms; color: var(--ui-dt-faint) !important; }
.ui-dt__table th:hover .ui-dt__filter, .ui-dt__filter:focus-visible, .ui-dt__filter[aria-expanded="true"], .ui-dt__filter[data-active] { width: 26px; opacity: 1; }
.ui-dt__filter:hover { background: var(--ui-dt-th-hover); color: var(--ui-dt-text) !important; }
.ui-dt__filter[data-active] { color: var(--ui-dt-accent-ink) !important; }
.ui-dt__filter:focus-visible { outline: 2px solid var(--ui-dt-focus); outline-offset: -2px; }
.ui-dt__table tbody tr { transition: background-color 140ms; }
.ui-dt__table tbody tr:hover { background: var(--ui-dt-hover); }
.ui-dt__table tbody tr[data-clickable] { cursor: default; }
.ui-dt__picker { position: fixed; z-index: 50; display: grid; gap: 2px; width: 220px; max-height: 320px; overflow-y: auto; padding: 4px; border-radius: calc(var(--aui-radius-lg, 16px) - 4px); background: var(--ui-dt-pop); box-shadow: var(--aui-shadow-popover, 0 0 0 1px var(--ui-dt-pop-ring), var(--ui-dt-pop-shadow)); animation: ui-dt-drop 180ms var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1)); }
.ui-dt__options { display: grid; gap: 2px; }
.ui-dt__option { display: flex; align-items: center; gap: 10px; min-height: 30px; padding: 0 10px; border: 0; border-radius: calc(var(--aui-radius-sm, 7px) + 1px); background: transparent; text-align: left; font-size: 13px !important; color: var(--ui-dt-text) !important; }
.ui-dt__option:hover, .ui-dt__option:focus-visible { background: var(--ui-dt-option-hover); outline: none; }
.ui-dt__option[aria-selected="true"] { color: var(--ui-dt-ink) !important; }
.ui-dt__option-label { min-width: 0; overflow: hidden; white-space: nowrap; }
.ui-dt__clear { color: var(--ui-dt-muted) !important; }
.ui-dt__field { width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: calc(var(--aui-radius-sm, 7px) + 1px); outline: none; background: var(--ui-dt-option-hover); font: inherit; font-size: 13px; color: var(--ui-dt-ink); }
.ui-dt__field::placeholder { color: var(--ui-dt-faint); }
.ui-dt__check { display: grid; place-items: center; flex: 0 0 auto; width: 16px; height: 16px; padding: 0; border: 1px solid var(--ui-dt-check-border); border-radius: 5px; background: var(--ui-dt-check-bg); transition: background-color 140ms, border-color 140ms; }
.ui-dt__option:hover .ui-dt__check { border-color: var(--ui-dt-check-border-hover); }
.ui-dt__check svg { width: 12px; height: 12px; fill: none; stroke: var(--ui-dt-check-mark); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transform: scale(0.6); transition: opacity 140ms, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.ui-dt__check[aria-checked="true"] { background: var(--aui-primary, var(--ui-dt-ink)); border-color: var(--aui-primary, var(--ui-dt-ink)); }
.ui-dt__check[aria-checked="true"] svg { opacity: 1; transform: none; }
.ui-dt__text { color: var(--ui-dt-text); font-variant-numeric: tabular-nums; }
.ui-dt__empty { margin: 0; padding: 24px; font-size: 14px; text-align: center; color: var(--ui-dt-muted); }
.ui-dt__pages { flex: 1 1 auto; min-width: 0; }
.ui-dt__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 6px 8px 2px 8px; }
@keyframes ui-dt-drop { 0% { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@media (prefers-reduced-motion: reduce) {
  .ui-dt__table tbody tr, .ui-dt__check, .ui-dt__check svg, .ui-dt__sort { transition: none; }
  .ui-dt__picker { animation: none; }
}
:where(.dark, [data-theme="dark"]) .ui-dt {
  --ui-dt-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-dt-card: var(--aui-surface, #232326);
  --ui-dt-line: rgba(255, 255, 255, 0.08);
  --ui-dt-grid: rgba(255, 255, 255, 0.07);
  --ui-dt-ink: var(--aui-ink, #ededed);
  --ui-dt-text: var(--aui-ink, #c4c4c4);
  --ui-dt-muted: var(--aui-muted, #8f8f8f);
  --ui-dt-faint: var(--aui-placeholder, #6b6b70);
  --ui-dt-hover: var(--aui-subtle, rgba(255, 255, 255, 0.03));
  --ui-dt-tray: var(--aui-subtle, #161618);
  --ui-dt-accent-ink: var(--aui-info, #4fb0fe);
  --ui-dt-border: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-dt-col-active: color-mix(in srgb, var(--aui-blue, #4fb0fe) 8%, transparent);
  --ui-dt-th-hover: var(--aui-subtle, rgba(255, 255, 255, 0.06));
  --ui-dt-pop: var(--aui-overlay, #2a2a2d);
  --ui-dt-pop-ring: var(--aui-border, rgba(255, 255, 255, 0.1));
  --ui-dt-option-hover: var(--aui-subtle, #313135);
  --ui-dt-check-bg: var(--aui-surface, #2a2a2d);
  --ui-dt-check-border: var(--aui-border-strong, rgba(255, 255, 255, 0.2));
  --ui-dt-check-border-hover: rgba(255, 255, 255, 0.36);
  --ui-dt-check-mark: var(--aui-on-primary, #121213);
  --ui-dt-wash: var(--aui-subtle, rgba(255, 255, 255, 0.06));
  --ui-dt-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-dt-pop-shadow: 0 12px 30px -8px rgba(0, 0, 0, 0.55);
}
`;
