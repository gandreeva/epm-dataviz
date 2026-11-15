import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndContext, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { ArrowLeft, ArrowRight, ArrowLeftRight, ChevronDown, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { Dataset, FieldMeta, PivotTableConfig } from "../types";
import { pivotHeatmapRange, reorderPivotAxis, togglePivotExpansion, type PivotTableModel } from "../query/pivotQuery";
import { ui } from "../uiIds";
import { setTemporalPivotMaxLevel, temporalPivotHierarchy } from "../analytical/pivot/temporalPivot";

type Props = {
  dataset: Dataset;
  config: PivotTableConfig;
  model: PivotTableModel;
  onChange: (config: PivotTableConfig) => void;
};

const display = (value: number | null, field?: FieldMeta, format?: { decimals?: number; scale?: string }) => {
  if (value == null) return "—";
  const scale = format?.scale === "million" ? 1_000_000 : format?.scale === "thousand" ? 1_000 : 1;
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: format?.decimals ?? (field?.unit === "currency" ? 0 : 2), minimumFractionDigits: format?.decimals ?? 0 }).format(value / scale);
};
const hexRgb = (hex: string) => { const value = hex.replace("#", ""); const normalized = value.length === 3 ? value.split("").map((x) => x + x).join("") : value; const number = Number.parseInt(normalized, 16); return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 }; };
const rgbHex = (r: number, g: number, b: number) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const contrast = (color: string) => { const { r, g, b } = hexRgb(color); return (r * 299 + g * 587 + b * 114) / 1000 > 145 ? "#163042" : "#ffffff"; };

function PivotFieldMenu({ anchor, field, axis, levels, selected, canLeft, canRight, onReorder, onMove, onRemove, onLevel, onClose }: { anchor: HTMLButtonElement; field: string; axis: "rows" | "columns"; levels: { levelKey: string; levelLabel: string }[]; selected?: string; canLeft: boolean; canRight: boolean; onReorder: (offset: number) => void; onMove: () => void; onRemove: () => void; onLevel: (level: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useEffect(() => {
    const place = () => {
      if (!anchor.isConnected) { closeRef.current(); return; }
      const rect = anchor.getBoundingClientRect(), menu = ref.current?.getBoundingClientRect();
      const width = menu?.width || 220, height = menu?.height || 180;
      const top = rect.bottom + 5 + height <= window.innerHeight - 8 ? rect.bottom + 5 : Math.max(8, rect.top - height - 5);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top });
    };
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) closeRef.current(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeRef.current(); anchor.focus(); } };
    place(); ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);
  return createPortal(<div ref={ref} className="pivot-field-menu" role="menu" aria-label={`Настройки поля ${field}`} style={position} onKeyDown={(event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")), index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus();
  }}>
    <button {...ui(`mapping.pivot.field.${field}.left`)} type="button" role="menuitem" disabled={!canLeft} onClick={() => { onReorder(-1); onClose(); requestAnimationFrame(() => anchor.focus()); }}><ArrowLeft /> Переместить влево</button>
    <button {...ui(`mapping.pivot.field.${field}.right`)} type="button" role="menuitem" disabled={!canRight} onClick={() => { onReorder(1); onClose(); requestAnimationFrame(() => anchor.focus()); }}><ArrowRight /> Переместить вправо</button>
    <button {...ui(`mapping.pivot.field.${field}.move`)} type="button" role="menuitem" onClick={() => { onMove(); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-ui-id="${CSS.escape(`mapping.pivot.field.${field}.menu`)}"]`)?.focus()); }}><ArrowLeftRight /> {axis === "rows" ? "Сделать столбцом" : "Сделать строкой"}</button>
    <button {...ui(`mapping.pivot.field.${field}.remove`)} type="button" role="menuitem" onClick={() => { const fallback = anchor.closest(".pivot-axis-group")?.querySelector<HTMLButtonElement>(".pivot-axis-toggle"); onRemove(); requestAnimationFrame(() => fallback?.focus()); }}><Trash2 /> Убрать из отчёта</button>
    {levels.length > 0 && <><div className="pivot-field-menu-label">Максимальный уровень</div>{levels.map((level) => <button key={level.levelKey} {...ui(`mapping.pivot.field.${field}.level.${level.levelKey}`)} type="button" role="menuitemradio" aria-checked={selected === level.levelKey} onClick={() => { onLevel(level.levelKey); onClose(); anchor.focus(); }}><span className="pivot-field-menu-check" aria-hidden="true">{selected === level.levelKey ? "✓" : ""}</span>{level.levelLabel}</button>)}</>}
  </div>, document.body);
}

function PivotAxisField({ field, axis, menuOpen, onMenu, onMove }: { field: FieldMeta; axis: "rows" | "columns"; menuOpen: boolean; onMenu: (anchor: HTMLButtonElement) => void; onMove: () => void }) {
  const id = `pivot-axis:${axis}:${field.id}`, data = { axis, fieldId: field.id };
  const drag = useDraggable({ id, data }), drop = useDroppable({ id, data });
  return <div ref={drop.setNodeRef} className={`pivot-field-pill${drop.isOver && !drag.isDragging ? " is-drop-target" : ""}${drag.isDragging ? " is-dragging" : ""}`} title={field.id}>
    <button ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} {...ui(`mapping.pivot.field.${field.id}.drag`)} type="button" className="pivot-field-drag" aria-describedby={undefined} aria-label={`Перетащить ${field.label}; для клавиатуры используйте меню поля`} title="Изменить порядок"><GripVertical aria-hidden="true" /></button>
    <button {...ui(`mapping.pivot.field.${field.id}.menu`)} type="button" aria-label={`Настройки поля ${field.label}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => onMenu(event.currentTarget)}><span>{field.label}</span><MoreHorizontal aria-hidden="true" /></button>
    <button {...ui(`mapping.pivot.field.${field.id}.toggle`)} type="button" className="pivot-field-toggle" title="Перенести на другую ось" aria-label={`Перенести ${field.label}`} onClick={onMove}><ArrowLeftRight aria-hidden="true" /></button>
  </div>;
}

export function PivotTableWidget({ dataset, config, model, onChange }: Props) {
  const [menu, setMenu] = useState<{ field: string; axis: "rows" | "columns"; anchor: HTMLButtonElement } | null>(null);
  const [collapsedAxes, setCollapsedAxes] = useState<{ rows: boolean; columns: boolean }>({ rows: false, columns: false });
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const fields = dataset.fields;
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const heatmapRanges = useMemo(() => new Map(config.heatmapModes.filter((item) => item.enabled).map((item) => [item.aggregationId, pivotHeatmapRange(model, item.aggregationId)])), [config.heatmapModes, model]);
  const cellIndex = useMemo(() => new Map(model.cells.map((item) => [JSON.stringify([item.rowId, item.columnId, item.aggregationId]), item.value])), [model.cells]);
  const barMaximums = useMemo(() => {
    const maximums = new Map<string, number>();
    model.cells.forEach((item) => {
      if (item.value != null && Number.isFinite(item.value)) maximums.set(item.aggregationId, Math.max(maximums.get(item.aggregationId) || 1, Math.abs(item.value)));
    });
    return maximums;
  }, [model.cells]);
  const barAggregations = useMemo(() => new Set(config.dataBars.map((item) => item.target.aggregationId)), [config.dataBars]);
  const used = new Set([...config.rows, ...config.columns]);
  const reorder = (axis: "rows" | "columns", field: string, target: number) => {
    const next = reorderPivotAxis(config, axis, field, target);
    if (next !== config) onChange(next);
  };
  const moveField = (field: string, from: "rows" | "columns") => {
    const to = from === "rows" ? "columns" : "rows";
    onChange({ ...config, rows: config.rows.filter((item) => item !== field).concat(to === "rows" ? [field] : []), columns: config.columns.filter((item) => item !== field).concat(to === "columns" ? [field] : []) });
    setMenu(null);
  };
  const removeField = (field: string, axis: "rows" | "columns") => {
    onChange({ ...config, [axis]: config[axis].filter((item) => item !== field) });
    setMenu(null);
  };
  const addField = (axis: "rows" | "columns") => {
    const candidate = fields.find((field) => field.kind === "dimension" && !used.has(field.id));
    if (!candidate) return;
    onChange({ ...config, [axis]: [...config[axis], candidate.id] });
  };
  const cell = (rowId: string, columnId: string, aggregationId: string) => cellIndex.get(JSON.stringify([rowId, columnId, aggregationId])) ?? null;
  const scaleFor = (aggregationId: string) => {
    if (!barAggregations.has(aggregationId)) return null;
    const max = barMaximums.get(aggregationId) || 1;
    return (value: number | null) => value == null ? 0 : Math.min(100, Math.abs(value) / max * 100);
  };
  const axis = (name: "rows" | "columns", label: string) => {
    const collapsed = collapsedAxes[name];
    const contentId = `mapping-pivot-${name}-content`;
    return <div className={`pivot-axis-group${collapsed ? " is-collapsed" : ""}`} {...ui(`mapping.pivot.${name}`)}>
      <div className="pivot-axis-label">
        <button
          {...ui(`mapping.pivot.${name}.toggle`)}
          type="button"
          className="pivot-axis-toggle"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          aria-label={`${collapsed ? "Раскрыть" : "Свернуть"} ${label.toLowerCase()}`}
          title={`${collapsed ? "Раскрыть" : "Свернуть"} ${label.toLowerCase()}`}
          onClick={() => setCollapsedAxes((current) => ({ ...current, [name]: !current[name] }))}
        ><span className="material-symbols-outlined" aria-hidden="true">{collapsed ? "chevron_right" : "expand_more"}</span></button>
        <b>{label}</b><small>{config[name].length}</small>
      </div>
      <div className={`pivot-axis-content${collapsed ? " is-collapsed" : ""}`} id={contentId} aria-hidden={collapsed}>
        <div className="pivot-axis-list">
        {config[name].map((fieldId) => {
          const field = fieldById.get(fieldId);
          if (!field) return null;
          return <PivotAxisField key={fieldId} field={field} axis={name} menuOpen={menu?.field === fieldId && menu.axis === name} onMenu={(anchor) => setMenu((current) => current?.field === fieldId && current.axis === name ? null : { field: fieldId, axis: name, anchor })} onMove={() => moveField(fieldId, name)} />;
        })}
        <button {...ui(`mapping.pivot.${name}.add`)} type="button" className="pivot-add-field" onClick={() => addField(name)}><Plus aria-hidden="true" /> Добавить</button>
        </div>
      </div>
    </div>;
  };
  const visibleAggregations = config.aggregations.filter((aggregation) => aggregation.visible);
  const activeHierarchy = temporalPivotHierarchy(dataset, config);
  const rowFields = config.rows.flatMap((fieldId) => fieldId === activeHierarchy?.field.id ? activeHierarchy.visibleLevels.map(() => fieldId) : [fieldId]);
  const rowFieldLabels = config.rows.flatMap((fieldId) => fieldId === activeHierarchy?.field.id ? activeHierarchy.visibleLevels.map((level) => `${activeHierarchy.field.label} · ${level.levelLabel}`) : [fieldById.get(fieldId)?.label || fieldId]);
  const tabularLayout = config.rowLayout === "tabular" && rowFields.length > 0;
  const rowHeader = rowFieldLabels.length ? rowFieldLabels.join(" / ") : "Rows";
  const toggleRow = (row: (typeof model.rows)[number]) => {
    onChange({ ...config, expansion: { ...config.expansion, rows: togglePivotExpansion(config.expansion.rows, model.rows, row) } });
  };
  const toggleColumn = (column: (typeof model.columns)[number]) => {
    onChange({ ...config, expansion: { ...config.expansion, columns: togglePivotExpansion(config.expansion.columns, model.columns, column) } });
  };
  const rowHeaderCells = tabularLayout
    ? rowFields.map((fieldId, depth) => <th className="pivot-row-dimension" style={{ left: `${depth * 150}px` }} rowSpan={2} scope="col" key={`${fieldId}-${depth}`}>{rowFieldLabels[depth]}</th>)
    : <th className="pivot-row-header" rowSpan={2}>{rowHeader}</th>;
  return <section {...ui("chart.pivot-table")} className="pivot-table-widget" aria-label="Pivot Table">
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={() => setMenu(null)} onDragEnd={({ active, over }) => { const source = active.data.current, target = over?.data.current; if (!source || !target || source.axis !== target.axis || (source.axis !== "rows" && source.axis !== "columns")) return; const axis: "rows" | "columns" = source.axis; reorder(axis, String(source.fieldId), config[axis].indexOf(String(target.fieldId))); }}><div className="pivot-axis-rail">{axis("columns", "СТОЛБЦЫ")}{axis("rows", "СТРОКИ")}</div></DndContext>
    {menu && config[menu.axis].includes(menu.field) && <PivotFieldMenu anchor={menu.anchor} field={menu.field} axis={menu.axis} levels={activeHierarchy?.field.id === menu.field ? activeHierarchy.levels : []} selected={activeHierarchy?.field.id === menu.field ? activeHierarchy.maxLevel.levelKey : undefined} canLeft={config[menu.axis].indexOf(menu.field) > 0} canRight={config[menu.axis].indexOf(menu.field) < config[menu.axis].length - 1} onReorder={(offset) => reorder(menu.axis, menu.field, config[menu.axis].indexOf(menu.field) + offset)} onMove={() => moveField(menu.field, menu.axis)} onRemove={() => removeField(menu.field, menu.axis)} onLevel={(level) => onChange(setTemporalPivotMaxLevel(dataset, config, level))} onClose={() => setMenu(null)} />}
    {activeHierarchy && config.columns.includes(activeHierarchy.field.id) && <div className="pivot-column-hierarchy" aria-label="Раскрытие временной иерархии столбцов">{model.columns.filter((column) => column.hasChildren).map((column) => <button type="button" key={column.id} aria-expanded={column.expanded} onClick={() => toggleColumn(column)}>{column.expanded ? "−" : "+"} {column.labels.join(" / ")}</button>)}</div>}
    <div className="pivot-table-toolbar"><span className="pivot-status-line"><b>LIVE</b> · {model.rows.length} узлов · {model.columns.length * visibleAggregations.length} числовых столбцов</span><div className="pivot-toolbar-actions"><button {...ui("mapping.pivot.row-layout.compact")} className={config.rowLayout !== "tabular" ? "active" : ""} type="button" title="Иерархия в одной колонке" aria-label="Иерархия строк в одной колонке" aria-pressed={config.rowLayout !== "tabular"} onClick={() => onChange({ ...config, rowLayout: "compact" })}><span className="material-symbols-outlined">account_tree</span></button><button {...ui("mapping.pivot.row-layout.tabular")} className={config.rowLayout === "tabular" ? "active" : ""} type="button" title="Каждая аналитика в своей колонке" aria-label="Каждая аналитика строк в своей колонке" aria-pressed={config.rowLayout === "tabular"} onClick={() => onChange({ ...config, rowLayout: "tabular" })}><span className="material-symbols-outlined">view_column</span></button><button {...ui("mapping.pivot.expansion.collapse.toolbar")} type="button" title="Свернуть всё" aria-label="Свернуть всё" onClick={() => onChange({ ...config, expansion: { rows: ["root"], columns: ["root"] } })}><span className="material-symbols-outlined">unfold_less</span></button><button {...ui("mapping.pivot.expansion.expand.toolbar")} type="button" title="Развернуть всё" aria-label="Развернуть всё" onClick={() => onChange({ ...config, expansion: { rows: ["root", "*"], columns: ["root", "*"] } })}><span className="material-symbols-outlined">unfold_more</span></button><button {...ui("mapping.pivot.reset")} type="button" title="Сбросить ракурс" aria-label="Сбросить ракурс" onClick={() => onChange({ ...config, rows: [], columns: [], expansion: { rows: ["root"], columns: ["root"] } })}><span className="material-symbols-outlined">restart_alt</span></button></div></div>
    {model.diagnostics.length ? <div className="pivot-table-stage"><div className="pivot-empty pivot-error-state"><span className="material-symbols-outlined">error</span><b>Невозможно построить Pivot</b>{model.diagnostics.map((item) => <span key={item}>{item}</span>)}</div></div> : <div className={`pivot-table-stage pivot-table-scroll pivot-row-layout-${config.rowLayout || "compact"}`}><table><caption className="sr-only">Иерархическая сводная таблица. {rowHeader}</caption><thead><tr>{rowHeaderCells}{model.columns.map((column) => <th className="pivot-column-band" colSpan={visibleAggregations.length} key={column.id}><span>{column.labels.join(" / ") || "Итого"}</span><button type="button" className="pivot-column-menu" aria-label={`Контекст колонки ${column.labels.join(" / ") || "Итого"}`} title="Действия колонки"><span className="material-symbols-outlined">more_horiz</span></button></th>)}</tr><tr>{model.columns.flatMap((column) => visibleAggregations.map((aggregation) => <th className="pivot-value-head" key={`${column.id}-${aggregation.id}`}>{aggregation.label}</th>))}</tr></thead><tbody>{model.rows.map((row) => <tr key={row.id} className={`pivot-row pivot-row-${row.nodeType} ${hoveredRow === row.id ? "is-hovered" : ""}`} data-node-row={row.id} onMouseEnter={() => setHoveredRow(row.id)} onMouseLeave={() => setHoveredRow(null)}>{tabularLayout ? rowFields.map((fieldId, depth) => { const label = row.labels[depth]; const current = depth === row.depth; return current ? <th className="pivot-row-dimension pivot-row-dimension-current" style={{ left: `${depth * 150}px` }} scope="row" key={`${fieldId}-${depth}`}><div className="pivot-tree-node" role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasChildren ? row.expanded : undefined}>{row.hasChildren && <button type="button" className="pivot-node-toggle" aria-label={`${row.expanded ? "Свернуть" : "Раскрыть"} ${label || "узел"}`} onClick={() => toggleRow(row)}><span className="material-symbols-outlined">{row.expanded ? "expand_more" : "chevron_right"}</span></button>}<span>{label || "Grand total"}</span></div></th> : <td className="pivot-row-dimension pivot-row-dimension-empty" style={{ left: `${depth * 150}px` }} aria-hidden="true" key={`${fieldId}-${depth}`} />; }) : <th className="pivot-tree-cell" scope="row"><div className="pivot-tree-node" role="treeitem" aria-level={row.nodeType === "grandTotal" ? 1 : row.depth + 2} aria-expanded={row.hasChildren ? row.expanded : undefined}><span className="pivot-tree-indent" style={{ width: `${(row.nodeType === "grandTotal" ? 0 : row.depth + 1) * 18}px` }} aria-hidden="true" />{row.hasChildren ? <button type="button" className="pivot-node-toggle" aria-label={`${row.expanded ? "Свернуть" : "Раскрыть"} ${row.labels.at(-1) || "узел"}`} onClick={() => toggleRow(row)}><span className="material-symbols-outlined">{row.expanded ? "expand_more" : "chevron_right"}</span></button> : <span className="pivot-node-spacer" aria-hidden="true" /> }<span>{row.labels.at(-1) || "Grand total"}</span><small>{row.nodeType === "grandTotal" ? "ROOT" : fieldById.get(rowFields[row.depth])?.id || rowFields[row.depth] || ""}</small></div></th>}{model.columns.flatMap((column) => visibleAggregations.map((aggregation) => { const value = cell(row.id, column.id, aggregation.id); const format = config.formatting[aggregation.id] || aggregation.format; const heatmapConfig = config.heatmapModes.find((item) => item.aggregationId === aggregation.id && item.enabled); const heatmapRange = heatmapConfig ? heatmapRanges.get(aggregation.id) : null; const heatmapScope = heatmapConfig && ((row.nodeType === "detail" && heatmapConfig.applyTo.detail) || (row.nodeType === "subtotal" && heatmapConfig.applyTo.subtotal) || (row.nodeType === "grandTotal" && heatmapConfig.applyTo.grandTotal)); const heatmapStyle = heatmapScope && value != null && heatmapRange ? (() => { const ratio = Math.max(0, Math.min(1, (value - heatmapRange.min) / (heatmapRange.max - heatmapRange.min || 1))); const from = hexRgb(heatmapConfig.palette.min), to = hexRgb(heatmapConfig.palette.max); const color = rgbHex(from.r + (to.r - from.r) * ratio, from.g + (to.g - from.g) * ratio, from.b + (to.b - from.b) * ratio); return { background: color, color: contrast(color) }; })() : undefined; const barScale = heatmapStyle ? null : scaleFor(aggregation.id); const formatting = config.conditionalFormatting.find((item) => item.target.aggregationId === aggregation.id); const conditional = heatmapStyle ? undefined : formatting?.rules.find((rule) => rule.enabled && value != null && ((rule.operator === ">=" && value >= Number(rule.value)) || (rule.operator === ">" && value > Number(rule.value)) || (rule.operator === "<=" && value <= Number(rule.value)) || (rule.operator === "<" && value < Number(rule.value)) || (rule.operator === "=" && value === Number(rule.value)) || (rule.operator === "between" && value >= Number(rule.value) && value <= Number(rule.valueTo)))); const activeBar = config.dataBars.find((item) => item.target.aggregationId === aggregation.id); const cellId = `${row.id}-${column.id}-${aggregation.id}`; return <td className={`pivot-numeric-cell ${heatmapStyle ? "pivot-heatmap-cell" : ""} ${activeCell === cellId ? "is-active" : ""}`} tabIndex={0} onFocus={() => setActiveCell(cellId)} onClick={() => setActiveCell(cellId)} data-cell-value={value ?? ""} aria-label={`${aggregation.label}: ${display(value, fieldById.get(aggregation.measureField), format)}`} style={heatmapStyle || (conditional ? { background: conditional.backgroundColor, color: conditional.textColor } : undefined)} key={cellId}>{barScale && value != null && <i className="pivot-data-bar" style={{ width: `${barScale(value)}%`, background: value >= 0 ? activeBar?.colors.positive : activeBar?.colors.negative, height: activeBar?.style === "slim" ? "3px" : "100%", top: activeBar?.style === "slim" ? "auto" : 0 }} aria-hidden="true" />}<span className="pivot-cell-value">{display(value, fieldById.get(aggregation.measureField), format)}</span></td>; }))}</tr>)}</tbody></table>{!model.rows.length && <div className="pivot-empty"><span className="material-symbols-outlined">filter_alt_off</span><b>Нет данных по выбранному ракурсу</b><span>Измените page filter или добавьте поле в Rows/Columns.</span></div>}</div>}
  </section>;
}
