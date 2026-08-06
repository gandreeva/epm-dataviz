import React, { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronDown, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { Dataset, FieldMeta, PivotTableConfig } from "../types";
import { pivotHeatmapRange, type PivotTableModel } from "../query/pivotQuery";
import { ui } from "../uiIds";

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

export function PivotTableWidget({ dataset, config, model, onChange }: Props) {
  const [menu, setMenu] = useState<{ field: string; axis: "rows" | "columns" } | null>(null);
  const [collapsedAxes, setCollapsedAxes] = useState<{ rows: boolean; columns: boolean }>({ rows: false, columns: false });
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const fields = dataset.fields;
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const heatmapRanges = useMemo(() => new Map(config.heatmapModes.filter((item) => item.enabled).map((item) => [item.aggregationId, pivotHeatmapRange(model, item.aggregationId)])), [config.heatmapModes, model]);
  const used = new Set([...config.rows, ...config.columns]);
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
  const cell = (rowId: string, columnId: string, aggregationId: string) => model.cells.find((item) => item.rowId === rowId && item.columnId === columnId && item.aggregationId === aggregationId)?.value ?? null;
  const scaleFor = (aggregationId: string) => {
    const bar = config.dataBars.find((item) => item.target.aggregationId === aggregationId);
    if (!bar) return null;
    const values = model.cells.filter((item) => item.aggregationId === aggregationId).map((item) => item.value).filter((value): value is number => value != null && Number.isFinite(value));
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
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
          return <div className="pivot-field-pill" key={fieldId} title={field.id}>
            <button {...ui(`mapping.pivot.field.${fieldId}.menu`)} type="button" onClick={() => setMenu({ field: fieldId, axis: name })}><span>{field.label}</span><MoreHorizontal aria-hidden="true" /></button>
            <button {...ui(`mapping.pivot.field.${fieldId}.toggle`)} type="button" className="pivot-field-toggle" title="Перенести на другую ось" aria-label={`Перенести ${field.label}`} onClick={() => moveField(fieldId, name)}><ArrowLeftRight aria-hidden="true" /></button>
            {menu?.field === fieldId && menu.axis === name && <div className="pivot-field-menu" role="menu">
              <button {...ui(`mapping.pivot.field.${fieldId}.move`)} type="button" role="menuitem" onClick={() => moveField(fieldId, name)}><ArrowLeftRight /> {name === "rows" ? "Сделать столбцом" : "Сделать строкой"}</button>
              <button {...ui(`mapping.pivot.field.${fieldId}.remove`)} type="button" role="menuitem" onClick={() => removeField(fieldId, name)}><Trash2 /> Убрать из отчёта</button>
            </div>}
          </div>;
        })}
        <button {...ui(`mapping.pivot.${name}.add`)} type="button" className="pivot-add-field" onClick={() => addField(name)}><Plus aria-hidden="true" /> Добавить</button>
        </div>
      </div>
    </div>;
  };
  const visibleAggregations = config.aggregations.filter((aggregation) => aggregation.visible);
  const rowFields = config.rows;
  const tabularLayout = config.rowLayout === "tabular" && rowFields.length > 0;
  const rowHeader = rowFields.length ? rowFields.map((field) => fieldById.get(field)?.label || field).join(" / ") : "Rows";
  const pathSeparator = "\u001f";
  const pathId = (path: string[]) => path.length ? path.join(pathSeparator) : "__all__";
  const isDescendant = (parent: string, candidate: string) => candidate === parent || candidate.startsWith(`${parent}${pathSeparator}`);
  const toggleRow = (row: (typeof model.rows)[number]) => {
    if (row.id === "__all__") {
      onChange({ ...config, expansion: { ...config.expansion, rows: ["root"] } });
      return;
    }
    const current = config.expansion.rows;
    if (row.expanded) {
      const next = current.includes("*")
        ? ["root", ...model.rows.filter((candidate) => candidate.id !== "__all__" && candidate.id !== row.id && !candidate.id.startsWith(`${row.id}${pathSeparator}`)).map((candidate) => candidate.id)]
        : current.filter((item) => !isDescendant(row.id, item));
      onChange({ ...config, expansion: { ...config.expansion, rows: [...new Set(next)] } });
      return;
    }
    const ancestors = row.path.map((_, index) => pathId(row.path.slice(0, index + 1)));
    onChange({ ...config, expansion: { ...config.expansion, rows: [...new Set(["root", ...current.filter((item) => item !== "*"), ...ancestors])] } });
  };
  const rowHeaderCells = tabularLayout
    ? rowFields.map((fieldId, depth) => <th className="pivot-row-dimension" style={{ left: `${depth * 150}px` }} rowSpan={2} scope="col" key={fieldId}>{fieldById.get(fieldId)?.label || fieldId}</th>)
    : <th className="pivot-row-header" rowSpan={2}>{rowHeader}</th>;
  return <section {...ui("chart.pivot-table")} className="pivot-table-widget" aria-label="Pivot Table">
    <div className="pivot-axis-rail">{axis("columns", "СТОЛБЦЫ")}{axis("rows", "СТРОКИ")}</div>
    <div className="pivot-table-toolbar"><span className="pivot-status-line"><b>LIVE</b> · {model.rows.length} узлов · {model.columns.length * visibleAggregations.length} числовых столбцов</span><div className="pivot-toolbar-actions"><button {...ui("mapping.pivot.row-layout.compact")} className={config.rowLayout !== "tabular" ? "active" : ""} type="button" title="Иерархия в одной колонке" aria-label="Иерархия строк в одной колонке" aria-pressed={config.rowLayout !== "tabular"} onClick={() => onChange({ ...config, rowLayout: "compact" })}><span className="material-symbols-outlined">account_tree</span></button><button {...ui("mapping.pivot.row-layout.tabular")} className={config.rowLayout === "tabular" ? "active" : ""} type="button" title="Каждая аналитика в своей колонке" aria-label="Каждая аналитика строк в своей колонке" aria-pressed={config.rowLayout === "tabular"} onClick={() => onChange({ ...config, rowLayout: "tabular" })}><span className="material-symbols-outlined">view_column</span></button><button {...ui("mapping.pivot.expansion.collapse.toolbar")} type="button" title="Свернуть всё" aria-label="Свернуть всё" onClick={() => onChange({ ...config, expansion: { rows: ["root"], columns: ["root"] } })}><span className="material-symbols-outlined">unfold_less</span></button><button {...ui("mapping.pivot.expansion.expand.toolbar")} type="button" title="Развернуть всё" aria-label="Развернуть всё" onClick={() => onChange({ ...config, expansion: { rows: ["root", "*"], columns: ["root", "*"] } })}><span className="material-symbols-outlined">unfold_more</span></button><button {...ui("mapping.pivot.reset")} type="button" title="Сбросить ракурс" aria-label="Сбросить ракурс" onClick={() => onChange({ ...config, rows: [], columns: [], expansion: { rows: ["root"], columns: ["root"] } })}><span className="material-symbols-outlined">restart_alt</span></button></div></div>
    {model.diagnostics.length ? <div className="pivot-table-stage"><div className="pivot-empty pivot-error-state"><span className="material-symbols-outlined">error</span><b>Невозможно построить Pivot</b>{model.diagnostics.map((item) => <span key={item}>{item}</span>)}</div></div> : <div className={`pivot-table-stage pivot-table-scroll pivot-row-layout-${config.rowLayout || "compact"}`}><table><caption className="sr-only">Иерархическая сводная таблица. {rowHeader}</caption><thead><tr>{rowHeaderCells}{model.columns.map((column) => <th className="pivot-column-band" colSpan={visibleAggregations.length} key={column.id}><span>{column.labels.join(" / ") || "Итого"}</span><button type="button" className="pivot-column-menu" aria-label={`Контекст колонки ${column.labels.join(" / ") || "Итого"}`} title="Действия колонки"><span className="material-symbols-outlined">more_horiz</span></button></th>)}</tr><tr>{model.columns.flatMap((column) => visibleAggregations.map((aggregation) => <th className="pivot-value-head" key={`${column.id}-${aggregation.id}`}>{aggregation.label}</th>))}</tr></thead><tbody>{model.rows.map((row) => <tr key={row.id} className={`pivot-row pivot-row-${row.nodeType} ${hoveredRow === row.id ? "is-hovered" : ""}`} data-node-row={row.id} onMouseEnter={() => setHoveredRow(row.id)} onMouseLeave={() => setHoveredRow(null)}>{tabularLayout ? rowFields.map((fieldId, depth) => { const label = row.labels[depth]; const current = depth === row.depth; return current ? <th className="pivot-row-dimension pivot-row-dimension-current" style={{ left: `${depth * 150}px` }} scope="row" key={fieldId}><div className="pivot-tree-node" role="treeitem" aria-level={row.depth + 1} aria-expanded={row.hasChildren ? row.expanded : undefined}>{row.hasChildren && <button type="button" className="pivot-node-toggle" aria-label={`${row.expanded ? "Свернуть" : "Раскрыть"} ${label || "узел"}`} onClick={() => toggleRow(row)}><span className="material-symbols-outlined">{row.expanded ? "expand_more" : "chevron_right"}</span></button>}<span>{label || "Grand total"}</span></div></th> : <td className="pivot-row-dimension pivot-row-dimension-empty" style={{ left: `${depth * 150}px` }} aria-hidden="true" key={fieldId} />; }) : <th className="pivot-tree-cell" scope="row"><div className="pivot-tree-node" role="treeitem" aria-level={row.nodeType === "grandTotal" ? 1 : row.depth + 2} aria-expanded={row.hasChildren ? row.expanded : undefined}><span className="pivot-tree-indent" style={{ width: `${(row.nodeType === "grandTotal" ? 0 : row.depth + 1) * 18}px` }} aria-hidden="true" />{row.hasChildren ? <button type="button" className="pivot-node-toggle" aria-label={`${row.expanded ? "Свернуть" : "Раскрыть"} ${row.labels.at(-1) || "узел"}`} onClick={() => toggleRow(row)}><span className="material-symbols-outlined">{row.expanded ? "expand_more" : "chevron_right"}</span></button> : <span className="pivot-node-spacer" aria-hidden="true" /> }<span>{row.labels.at(-1) || "Grand total"}</span><small>{row.nodeType === "grandTotal" ? "ROOT" : fieldById.get(rowFields[row.depth])?.id || rowFields[row.depth] || ""}</small></div></th>}{model.columns.flatMap((column) => visibleAggregations.map((aggregation) => { const value = cell(row.id, column.id, aggregation.id); const format = config.formatting[aggregation.id] || aggregation.format; const heatmapConfig = config.heatmapModes.find((item) => item.aggregationId === aggregation.id && item.enabled); const heatmapRange = heatmapConfig ? heatmapRanges.get(aggregation.id) : null; const heatmapScope = heatmapConfig && ((row.nodeType === "detail" && heatmapConfig.applyTo.detail) || (row.nodeType === "subtotal" && heatmapConfig.applyTo.subtotal) || (row.nodeType === "grandTotal" && heatmapConfig.applyTo.grandTotal)); const heatmapStyle = heatmapScope && value != null && heatmapRange ? (() => { const ratio = Math.max(0, Math.min(1, (value - heatmapRange.min) / (heatmapRange.max - heatmapRange.min || 1))); const from = hexRgb(heatmapConfig.palette.min), to = hexRgb(heatmapConfig.palette.max); const color = rgbHex(from.r + (to.r - from.r) * ratio, from.g + (to.g - from.g) * ratio, from.b + (to.b - from.b) * ratio); return { background: color, color: contrast(color) }; })() : undefined; const barScale = heatmapStyle ? null : scaleFor(aggregation.id); const formatting = config.conditionalFormatting.find((item) => item.target.aggregationId === aggregation.id); const conditional = heatmapStyle ? undefined : formatting?.rules.find((rule) => rule.enabled && value != null && ((rule.operator === ">=" && value >= Number(rule.value)) || (rule.operator === ">" && value > Number(rule.value)) || (rule.operator === "<=" && value <= Number(rule.value)) || (rule.operator === "<" && value < Number(rule.value)) || (rule.operator === "=" && value === Number(rule.value)) || (rule.operator === "between" && value >= Number(rule.value) && value <= Number(rule.valueTo)))); const activeBar = config.dataBars.find((item) => item.target.aggregationId === aggregation.id); const cellId = `${row.id}-${column.id}-${aggregation.id}`; return <td className={`pivot-numeric-cell ${heatmapStyle ? "pivot-heatmap-cell" : ""} ${activeCell === cellId ? "is-active" : ""}`} tabIndex={0} onFocus={() => setActiveCell(cellId)} onClick={() => setActiveCell(cellId)} data-cell-value={value ?? ""} aria-label={`${aggregation.label}: ${display(value, fieldById.get(aggregation.measureField), format)}`} style={heatmapStyle || (conditional ? { background: conditional.backgroundColor, color: conditional.textColor } : undefined)} key={cellId}>{barScale && value != null && <i className="pivot-data-bar" style={{ width: `${barScale(value)}%`, background: value >= 0 ? activeBar?.colors.positive : activeBar?.colors.negative, height: activeBar?.style === "slim" ? "3px" : "100%", top: activeBar?.style === "slim" ? "auto" : 0 }} aria-hidden="true" />}<span className="pivot-cell-value">{display(value, fieldById.get(aggregation.measureField), format)}</span></td>; }))}</tr>)}</tbody></table>{!model.rows.length && <div className="pivot-empty"><span className="material-symbols-outlined">filter_alt_off</span><b>Нет данных по выбранному ракурсу</b><span>Измените page filter или добавьте поле в Rows/Columns.</span></div>}</div>}
  </section>;
}
