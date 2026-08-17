import type { ChartConfig, ChartModel, ChartPoint, ChartSeries, Dataset, FieldMeta, PivotTableConfig, KpiModel, KpiCardModel, KpiSettings, TimeGranularity } from "../types";
import type { QueryResult } from "./query/types";
import type { PivotAxisNode, PivotCell, PivotTableModel } from "../query/pivotQuery";
import type { DataRow } from "../types";
import { effectiveMetricAggregation } from "./query/metricSemantics";

const valueText = (value: unknown) => value == null || value === "" ? "∅" : String(value);
const colors = ["#0a6ed1", "#0f8278", "#e39b19", "#b84c4c", "#6b5fb5", "#3f8f8f"];
const metricAlias = (field: string, aggregation: string) => `${field}__${aggregation}`;

const decodeLimbString = (text: string): number | null => {
  const parts = text.trim().split(",");
  if (parts.length < 2 || parts.length > 4 || !parts.every((part) => /^-?\d+$/.test(part.trim()))) return null;
  try {
    const words = parts.map((part) => BigInt(part.trim()) & 0xffffffffn);
    let value = 0n;
    words.forEach((word, index) => { value += word << (32n * BigInt(index)); });
    if (parts.length === 4 && (words[3] & 0x80000000n) !== 0n) value -= 1n << 128n;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
};

/** Convert values returned by DuckDB/Arrow into the numeric shape expected by adapters. */
export const queryNumericValue = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return decodeLimbString(text);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (typeof value === "object") {
    const objectValue = value as { value?: unknown; low?: unknown; high?: unknown; unsigned?: boolean };
    // Arrow decimal/long wrappers may expose a useful textual value while
    // value/valueOf() returns a lossy low-word number (often zero). Prefer text.
    const text = typeof (value as { toString?: () => string }).toString === "function"
      ? String((value as { toString: () => string }).toString())
      : String(value);
    if (text !== "[object Object]") {
      const numeric = queryNumericValue(text);
      if (numeric !== null) return numeric;
    }
    if (objectValue.low !== undefined) {
      const low = queryNumericValue(objectValue.low);
      const high = queryNumericValue(objectValue.high);
      if (low !== null && high !== null && Number.isSafeInteger(low) && Number.isSafeInteger(high)) {
        const unsigned = objectValue.unsigned ? 0 : high < 0 ? -1 : 0;
        const numeric = high * 2 ** 32 + (low >>> 0) + unsigned * 2 ** 32;
        if (Number.isFinite(numeric)) return numeric;
      }
    }
    if (objectValue.value !== undefined && objectValue.value !== value) {
      const numeric = queryNumericValue(objectValue.value);
      if (numeric !== null) return numeric;
    }
    const numericMethod = (value as { toNumber?: () => unknown }).toNumber;
    if (typeof numericMethod === "function") {
      const numeric = queryNumericValue(numericMethod.call(value));
      if (numeric !== null) return numeric;
    }
    const primitive = (value as { valueOf?: () => unknown }).valueOf?.();
    if (primitive !== value) return queryNumericValue(primitive);
  }
  return null;
};

export const serializeQueryValue = (value: unknown): unknown => {
  if (typeof value === "bigint") return `${value}n`;
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  const text = String(value);
  if (text !== "[object Object]") return text;
  const object = value as { toString?: () => string; toNumber?: () => unknown; valueOf?: () => unknown };
  return {
    type: value.constructor?.name || "object",
    value: queryNumericValue(value),
    textValue: typeof object.toString === "function" ? object.toString() : undefined,
    numberValue: typeof object.toNumber === "function" ? object.toNumber() : undefined,
    keys: Object.keys(value as object),
  };
};

/**
 * Normalize an aggregated Waterfall result without assuming a particular
 * DuckDB/Arrow runtime representation of aliases or numeric values.
 */
export function normalizeWaterfallQueryResult(
  result: QueryResult,
  dimensionKey: string,
  measureFields: string[],
): DataRow[] {
  const columns = result.columns.map((column) => column.name);
  const lowerColumns = new Map(columns.map((column) => [column.toLowerCase(), column]));
  const resolveKey = (row: Record<string, unknown>, candidates: string[]) => {
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(row, candidate)) return candidate;
      const actual = lowerColumns.get(candidate.toLowerCase());
      if (actual && Object.prototype.hasOwnProperty.call(row, actual)) return actual;
    }
    return undefined;
  };
  return result.rows.map((row) => {
    const next: DataRow = { [dimensionKey]: row[dimensionKey] == null ? null : String(row[dimensionKey]) };
    for (const field of measureFields) {
      const key = resolveKey(row, [metricAlias(field, "SUM"), field]);
      next[field] = key === undefined ? null : queryNumericValue(row[key]);
    }
    return next;
  });
}
const fieldMeta = (dataset: Dataset, id: string): FieldMeta | undefined => dataset.fields.find((field) => field.id === id);
const kpiLabel = (raw: string, granularity: TimeGranularity) => {
  const value = raw.replace(/[^0-9]/g, "");
  if (granularity === "month" && value.length === 6) return `${value.slice(4, 6)}.${value.slice(0, 4)}`;
  if (granularity === "day" && value.length === 8) return `${value.slice(6, 8)}.${value.slice(4, 6)}.${value.slice(0, 4)}`;
  return raw;
};
const kpiTimestamp = (raw: string, granularity: TimeGranularity) => {
  const value = raw.replace(/[^0-9]/g, "");
  if (granularity === "month" && value.length === 6) return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, 1);
  if (granularity === "day" && value.length === 8) return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Number.NaN;
};

export function kpiModelFromQueryResult(dataset: Dataset, config: ChartConfig, result: QueryResult): KpiModel {
  const settings: KpiSettings = { comparisonSource: "none", comparisonOffset: 1, comparisonType: "absolute", showPeriodLabel: true, showComparisonLabel: true, showTrendIndicator: true, showSparkline: true, layout: "auto", alignment: "left", labelFontSize: "medium", valueFontSize: "large", positiveColor: "#0f8278", negativeColor: "#b84c4c", neutralColor: "#6f8294", reverseComparisonColor: false, ...(config.kpi || {}) };
  const timeField = settings.timeFieldId || dataset.fields.find((field) => field.semantic?.dataType === "date")?.id;
  const granularity = (timeField && fieldMeta(dataset, timeField)?.semantic?.granularity) || "day";
  const periods = [...new Map(result.rows.map((row) => { const raw = String(row[timeField || ""] ?? ""); return [raw, { raw, timestamp: kpiTimestamp(raw, granularity) }]; })).values()].sort((a, b) => a.timestamp - b.timestamp);
  const current = periods.at(-1), comparisonIndex = current ? periods.length - 1 - Math.max(1, settings.comparisonOffset || 1) : -1, comparison = settings.comparisonSource === "previous-period" && comparisonIndex >= 0 ? periods[comparisonIndex] : undefined;
  const cards: KpiCardModel[] = config.metrics.map((metric) => {
    const alias = metricAlias(metric.fieldId, metric.aggregation);
    const rowValue = (period: { raw: string } | undefined) => period ? Number(result.rows.find((row) => String(row[timeField || ""] ?? "") === period.raw)?.[alias]) : null;
    const currentValue = current ? rowValue(current) : Number(result.rows[0]?.[alias] ?? NaN), comparisonValue = comparison ? rowValue(comparison) : null;
    const safeCurrent = Number.isFinite(currentValue) ? currentValue : null, safeComparison = comparisonValue != null && Number.isFinite(comparisonValue) ? comparisonValue : null;
    const absoluteDelta = safeCurrent != null && safeComparison != null ? safeCurrent - safeComparison : null;
    const percentDelta = absoluteDelta != null && safeComparison != null && safeComparison !== 0 ? absoluteDelta / Math.abs(safeComparison) * 100 : null;
    return { id: metric.fieldId, label: fieldMeta(dataset, metric.fieldId)?.label || metric.fieldId, unit: fieldMeta(dataset, metric.fieldId)?.unit || "count", currentValue: safeCurrent, currentPeriodLabel: current ? kpiLabel(current.raw, granularity) : undefined, comparisonValue: safeComparison, comparisonPeriodLabel: comparison ? kpiLabel(comparison.raw, granularity) : undefined, absoluteDelta, percentDelta, trend: absoluteDelta == null ? "unknown" : absoluteDelta > 0 ? "up" : absoluteDelta < 0 ? "down" : "flat", sparkline: periods.slice(-120).map((period) => ({ timestamp: period.timestamp, label: kpiLabel(period.raw, granularity), value: rowValue(period) })) };
  });
  return { cards, settings, title: settings.title, note: settings.note };
}
const temporalBucketLabel = (value: string, level?: string | null) => {
  if (!level || level === "DAY" || level === "MONTH") return value;
  return value;
};
const temporalTimestamp = (value: unknown, field?: FieldMeta, level?: string | null) => {
  if (!field?.semantic || field.semantic.dataType !== "date") return undefined;
  const raw = String(value ?? "").replace(/[^0-9]/g, "");
  const bucket = String(value ?? "");
  if (level === "YEAR" && /^\d{4}$/.test(bucket)) return Date.UTC(Number(bucket), 0, 1);
  if (level === "HALF_YEAR" && /^(\d{4})H([12])$/.test(String(value))) { const match = String(value).match(/^(\d{4})H([12])$/)!; return Date.UTC(Number(match[1]), Number(match[2]) === 1 ? 0 : 6, 1); }
  if (level === "QUARTER" && /^(\d{4})Q([1-4])$/.test(String(value))) { const match = String(value).match(/^(\d{4})Q([1-4])$/)!; return Date.UTC(Number(match[1]), (Number(match[2]) - 1) * 3, 1); }
  // The query result is encoded at the selected hierarchy level, which may
  // differ from the physical field granularity (for example 0date is a day
  // field but MONTH grouping returns YYYYMM). Always prefer the selected
  // level when decoding the bucket, then fall back to the source metadata.
  if ((level === "MONTH" || field.semantic.granularity === "month") && /^\d{6}$/.test(raw)) return Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, 1);
  if ((level === "DAY" || field.semantic.granularity === "day") && /^\d{8}$/.test(raw)) return Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)));
  return undefined;
};

export function chartModelFromQueryResult(dataset: Dataset, config: ChartConfig, result: QueryResult): ChartModel {
  const view = config.viewBy.length ? config.viewBy : ["_all"];
  const stackFields = config.stackBy;
  const stackPaths = stackFields.length
    ? [...new Map(result.rows.map((row) => {
        const values = stackFields.map((field) => valueText(row[field]));
        return [JSON.stringify(values), values];
      })).values()]
    : [[]];
  const stackPathKey = (values: string[]) => JSON.stringify(values);
  const series: ChartSeries[] = [];
  config.metrics.forEach((metric, metricIndex) => stackPaths.forEach((stackPath, stackIndex) => {
    const field = fieldMeta(dataset, metric.fieldId);
    const columnPath = stackFields.map((stackFieldId, index) => {
      const stackField = fieldMeta(dataset, stackFieldId);
      const value = stackPath[index] || "";
      return { dimensionKey: stackFieldId, value, label: value ? stackField?.semantic?.members?.[value]?.label || value : "" };
    });
    const stackLabel = columnPath.map((item) => item.label).filter(Boolean).join(" · ");
    const seriesSuffix = stackPath.length === 0 ? "" : stackPath.length === 1 ? stackPath[0] : stackPathKey(stackPath);
    const setting = config.seriesSettings[`${metric.fieldId}::${seriesSuffix}`];
    const label = [field?.label || metric.fieldId, stackLabel].filter(Boolean).join(" · ");
    const timeRole = columnPath.map((item) => fieldMeta(dataset, item.dimensionKey)?.semantic?.members?.[item.value]?.timeRole).find(Boolean);
    series.push({
      id: `${metric.fieldId}::${seriesSuffix}`,
      dataKey: `s_${metricIndex}_${stackIndex}`,
      label,
      fullLabel: label,
      measureId: metric.fieldId,
      measureKey: metric.fieldId,
      measureLabel: field?.label || metric.fieldId,
      columnPath,
      order: series.length,
      color: setting?.color || colors[series.length % colors.length],
      visible: setting?.visible !== false,
      unit: field?.unit || "count",
      seriesType: metric.seriesType || "column",
      yAxisId: setting?.yAxisId || metric.yAxisId,
      timeRole: setting?.timeRole || timeRole,
      valueFormat: { unit: field?.unit },
    });
  }));
  const categoryEntries = [...new Map(result.rows.map((row) => {
    const values = view.map((field) => field === "_all" ? "Итого" : valueText(row[field]));
    const timeFieldId = view.find((field) => field !== "_all") || "";
    const timeField = fieldMeta(dataset, timeFieldId);
    const presentation = config.viewByPresentation?.[timeFieldId];
    const level = presentation?.mode === "hierarchy" ? presentation.selectedLevelKey : null;
    const timeIndex = view.indexOf(timeFieldId);
    const displayValues = values.map((value, index) => {
      if (index === timeIndex) return temporalBucketLabel(value, level);
      return fieldMeta(dataset, view[index])?.semantic?.members?.[value]?.label || value;
    });
    return [JSON.stringify(values), { rawValues: values, values: displayValues, label: displayValues.join(" · "), timestamp: temporalTimestamp(row[timeFieldId], timeField, level) }];
  })).values()];
  categoryEntries.sort((a, b) => a.timestamp != null && b.timestamp != null ? a.timestamp - b.timestamp : 0);
  const categories = categoryEntries.map((item) => item.label);
  const data: ChartPoint[] = categoryEntries.map((category) => {
    const parts = category.values;
    const rawParts = category.rawValues;
    const point: ChartPoint = { categoryKey: JSON.stringify(category.values), categoryLabel: category.label };
    series.forEach((seriesItem) => {
      const metric = config.metrics[seriesItem.order >= 0 ? Math.floor(seriesItem.order / stackPaths.length) : 0];
      const aggregation = effectiveMetricAggregation(metric, config);
      const alias = metricAlias(metric.fieldId, aggregation);
      const row = result.rows.find((candidate) => view.every((field, index) => field === "_all" || valueText(candidate[field]) === rawParts[index]) && stackFields.every((field, index) => valueText(candidate[field]) === (seriesItem.columnPath[index]?.value || "")));
      point[seriesItem.dataKey] = row?.[alias] == null ? null : queryNumericValue(row[alias]);
    });
    point.timestamp = category.timestamp;
    point.categoryKey = JSON.stringify(category.values);
    point.categoryLabel = category.label;
    return point;
  });
  // Keep the DuckDB result contract aligned with the legacy query engine.
  // Actual / Forecast decorations and temporal overlays need this domain to
  // translate timestamps into chart coordinates. Without it, valid points
  // render but split decorations are silently skipped by the renderer.
  const timestamps = data
    .map((point) => point.timestamp)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const timeDomain: [number, number] | undefined = timestamps.length
    ? [Math.min(...timestamps), Math.max(...timestamps)]
    : undefined;
  return { data, series, categories, events: [], eventCategories: [], timeDomain, diagnostics: result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message), warnings: result.diagnostics.filter((item) => item.severity === "warning").map((item) => item.message) };
}

const pathId = (path: string[]) => path.length ? path.join("\u001f") : "__all__";
const axisNodes = (paths: string[][], axis: "rows" | "columns", expansion: string[]): PivotAxisNode[] => {
  if (axis === "columns" && paths.every((path) => path.length === 0)) {
    return [{ id: "__all__", path: [], labels: ["Grand total"], depth: 0, isLeaf: true, nodeType: "grandTotal", hasChildren: false, expanded: true }];
  }
  const keys = new Map<string, string[]>();
  paths.forEach((path) => { for (let depth = 1; depth <= path.length; depth += 1) keys.set(pathId(path.slice(0, depth)), path.slice(0, depth)); });
  const all = [...keys.entries()].map(([id, path]) => {
    const hasChildren = [...keys.values()].some((candidate) => candidate.length > path.length && path.every((value, index) => candidate[index] === value));
    return { id, path, labels: path, depth: path.length - 1, isLeaf: !hasChildren, nodeType: hasChildren ? "subtotal" as const : "detail" as const, hasChildren, expanded: expansion.includes("*") || expansion.includes(id) };
  });
  const visible: PivotAxisNode[] = [];
  const walk = (parent: string[]) => all.filter((node) => node.path.length === parent.length + 1 && parent.every((value, index) => node.path[index] === value)).sort((a, b) => a.path.join("\u001f").localeCompare(b.path.join("\u001f"), "ru")).forEach((node) => { visible.push(node); if (node.hasChildren && node.expanded) walk(node.path); });
  if (expansion.includes("root") || expansion.includes("*")) walk([]);
  return axis === "rows" ? [{ id: "__all__", path: [], labels: ["Grand total"], depth: 0, isLeaf: false, nodeType: "grandTotal", hasChildren: paths.length > 0, expanded: expansion.includes("root") }, ...visible] : visible;
};

export interface PivotQueryResults {
  detail: QueryResult;
  total: QueryResult;
  subtotals?: Array<{ rowDepth: number; result: QueryResult }>;
}

export function pivotModelFromQueryResults(config: PivotTableConfig, results: PivotQueryResults): PivotTableModel {
  const { detail, total } = results;
  const rowPaths = detail.rows.map((row) => config.rows.map((field) => valueText(row[field])));
  const columnPaths = detail.rows.map((row) => config.columns.map((field) => valueText(row[field])));
  const rows = axisNodes(rowPaths, "rows", config.expansion.rows);
  const columns = axisNodes(columnPaths, "columns", config.expansion.columns);
  const cells: PivotCell[] = [];
  const aggregations = config.aggregations.filter((item) => item.visible);
  const subtotalByDepth = new Map((results.subtotals || []).map((scope) => [scope.rowDepth, scope.result]));
  const findMatch = (source: QueryResult, rowNode: PivotAxisNode, columnNode: PivotAxisNode, rowFields: string[]) => source.rows.find((candidate) => {
    const rowMatch = rowNode.id === "__all__" || rowFields.every((field, index) => valueText(candidate[field]) === rowNode.path[index]);
    const columnMatch = config.columns.every((field, index) => valueText(candidate[field]) === columnNode.path[index]);
    return rowMatch && columnMatch;
  });
  rows.forEach((rowNode) => columns.forEach((columnNode) => aggregations.forEach((aggregation) => {
    const subtotal = rowNode.nodeType === "subtotal" ? subtotalByDepth.get(rowNode.path.length) : undefined;
    const source = rowNode.id === "__all__" ? total : subtotal || detail;
    const rowFields = rowNode.id === "__all__" ? [] : subtotal ? config.rows.slice(0, rowNode.path.length) : config.rows;
    const match = findMatch(source, rowNode, columnNode, rowFields);
    const alias = metricAlias(aggregation.measureField, aggregation.operation);
    cells.push({ rowId: rowNode.id, columnId: columnNode.id, aggregationId: aggregation.id, value: match?.[alias] == null ? null : Number(match[alias]) });
  })));
  // Compatibility fallback for callers that only provide detail + total.
  // Production Pivot execution supplies subtotal query results above, so
  // non-additive aggregations are never reconstructed from child cells.
  rows.filter((rowNode) => rowNode.nodeType !== "detail" && rowNode.id !== "__all__" && !subtotalByDepth.has(rowNode.path.length)).forEach((rowNode) => columns.forEach((columnNode) => aggregations.forEach((aggregation) => {
    const cell = cells.find((item) => item.rowId === rowNode.id && item.columnId === columnNode.id && item.aggregationId === aggregation.id);
    if (!cell || cell.value != null) return;
    const descendants = rows.filter((candidate) => candidate.nodeType === "detail" && rowNode.path.every((value, index) => candidate.path[index] === value));
    const values = descendants.map((candidate) => cells.find((item) => item.rowId === candidate.id && item.columnId === columnNode.id && item.aggregationId === aggregation.id)?.value).filter((value): value is number => value != null && Number.isFinite(value));
    if (values.length && aggregation.operation === "SUM") cell.value = values.reduce((sum, value) => sum + value, 0);
  })));
  return { rows, columns, cells, diagnostics: [detail, total, ...(results.subtotals || []).map((scope) => scope.result)].flatMap((result) => result.diagnostics).filter((item) => item.severity === "error").map((item) => item.message), warnings: [] };
}

export function pivotModelFromQueryResult(config: PivotTableConfig, detail: QueryResult, total: QueryResult): PivotTableModel {
  return pivotModelFromQueryResults(config, { detail, total });
}
