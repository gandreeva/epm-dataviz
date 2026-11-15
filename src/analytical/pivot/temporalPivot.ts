import type { Dataset, HierarchyAggregation, PivotAggregation, PivotSortRule, PivotTableConfig } from "../../types";
import type { AnalyticalQuery, DimensionSelection, QueryResult } from "../query/types";
import type { PivotAxisNode, PivotCell, PivotTableModel } from "../../query/pivotQuery";
import { aggregatePivotPeriods } from "./temporalAggregation";

type PivotDimension = DimensionSelection & { alias: string; levelKey?: string };
export interface TemporalPivotScope {
  key: string;
  rowDepth: number;
  columnDepth: number;
  metric: PivotAggregation;
  query: AnalyticalQuery;
  rollup: boolean;
  operation: HierarchyAggregation;
}
export interface TemporalPivotPlan {
  rows: PivotDimension[];
  columns: PivotDimension[];
  scopes: TemporalPivotScope[];
}
const baseAlias = "__pivot_base_period";
const text = (value: unknown) => value == null || value === "" ? "∅" : String(value);
const id = (path: string[]) => path.length ? path.join("\u001f") : "__all__";
const supportedLevels = new Set(["YEAR", "HALF_YEAR", "QUARTER", "MONTH", "DAY"]);

/** A stale or unavailable hierarchy never changes an existing pivot's semantics. */
export function temporalPivotHierarchy(dataset: Dataset, config: PivotTableConfig) {
  const selection = config.timeHierarchy;
  if (!selection || ![...config.rows, ...config.columns].includes(selection.fieldId)) return undefined;
  const field = dataset.fields.find((item) => item.id === selection.fieldId);
  if (field?.semantic?.dataType !== "date") return undefined;
  const hierarchy = field.semantic.hierarchies?.find((item) => String(item.hierarchyId) === String(selection.hierarchyId));
  if (!hierarchy) return undefined;
  const levels = hierarchy.levels.filter((level) => supportedLevels.has(level.levelKey) && !(field.semantic?.granularity === "month" && level.levelKey === "DAY"));
  if (!levels.length) return undefined;
  const selectedIndex = levels.findIndex((level) => level.levelKey === selection.maxLevelKey);
  const maxLevel = levels[selectedIndex < 0 ? levels.length - 1 : selectedIndex];
  return { field, hierarchy, levels, maxLevel, visibleLevels: levels.slice(0, selectedIndex < 0 ? levels.length : selectedIndex + 1) };
}

/** Retain unambiguous expansion paths shared by the old and new hierarchy. */
export function setTemporalPivotMaxLevel(dataset: Dataset, config: PivotTableConfig, levelKey: string): PivotTableConfig {
  const active = temporalPivotHierarchy(dataset, config);
  if (!active || !active.levels.some((level) => level.levelKey === levelKey) || !config.timeHierarchy) return config;
  if (active.maxLevel.levelKey === levelKey) return config;
  const axis = config.rows.includes(active.field.id) ? "rows" : "columns";
  const fieldIndex = config[axis].indexOf(active.field.id);
  const newDepth = active.levels.findIndex((level) => level.levelKey === levelKey) + 1;
  const stableDepth = fieldIndex + Math.min(active.visibleLevels.length, newDepth);
  const paths = config.expansion[axis].filter((path) => path === "root" || path === "*" || path.split("\u001f").length <= stableDepth);
  return { ...config, timeHierarchy: { ...config.timeHierarchy, maxLevelKey: levelKey }, expansion: { ...config.expansion, [axis]: paths } };
}

/** Build parameterized grouped queries for each visible axis depth and metric. */
export function planTemporalPivot(dataset: Dataset, config: PivotTableConfig, base: AnalyticalQuery): TemporalPivotPlan | null {
  const active = temporalPivotHierarchy(dataset, config);
  if (!active) return null;
  const makeAxis = (fields: string[], axis: "r" | "c"): PivotDimension[] => fields.flatMap((fieldId, index) => fieldId === active.field.id
    ? active.visibleLevels.map((level) => ({ fieldId, alias: `__pivot_${axis}${index}_${level.levelKey}`, levelKey: level.levelKey, hierarchy: { hierarchyId: active.hierarchy.hierarchyId, levelKey: level.levelKey, granularity: active.field.semantic?.granularity } }))
    : [{ fieldId, alias: `__pivot_${axis}${index}` }]);
  const rows = makeAxis(config.rows, "r"), columns = makeAxis(config.columns, "c");
  const scopes: TemporalPivotScope[] = [];
  for (let rowDepth = 0; rowDepth <= rows.length; rowDepth++) for (let columnDepth = 0; columnDepth <= columns.length; columnDepth++) {
    const dimensions = [...rows.slice(0, rowDepth), ...columns.slice(0, columnDepth)];
    const selectedTime = dimensions.filter((dimension) => dimension.fieldId === active.field.id).at(-1);
    for (const metric of config.aggregations.filter((item) => item.visible)) {
      const requestedBase = active.levels.findIndex((level) => level.levelKey === metric.hierarchyBaseLevel);
      const baseIndex = requestedBase < 0 ? active.levels.length - 1 : requestedBase;
      const selectedIndex = selectedTime ? active.levels.findIndex((level) => level.levelKey === selectedTime.levelKey) : -1;
      const rollup = selectedIndex < baseIndex;
      const baseDimension: DimensionSelection = { fieldId: active.field.id, alias: baseAlias, hierarchy: { hierarchyId: active.hierarchy.hierarchyId, levelKey: active.levels[baseIndex].levelKey, granularity: active.field.semantic?.granularity } };
      scopes.push({
        key: `${rowDepth}:${columnDepth}:${metric.id}`,
        rowDepth, columnDepth, metric, rollup, operation: metric.hierarchyAggregation || metric.operation,
        query: { ...base, dimensions: rollup ? [...dimensions, baseDimension] : dimensions, measures: [{ fieldId: metric.measureField, aggregation: metric.operation }], orderBy: undefined, limit: 50000 },
      });
    }
  }
  return { rows, columns, scopes };
}

const axisNodes = (paths: string[][], axis: "rows" | "columns", expanded: string[], dimensions: PivotDimension[], sorts: PivotSortRule[]): PivotAxisNode[] => {
  if (!paths.some((path) => path.length)) return [{ id: "__all__", path: [], labels: ["Grand total"], depth: 0, isLeaf: true, nodeType: "grandTotal", hasChildren: false, expanded: true }];
  const children = new Map<string, Map<string, string[]>>();
  paths.forEach((path) => path.forEach((_, index) => {
    const prefix = path.slice(0, index + 1), parent = id(prefix.slice(0, -1)), key = id(prefix);
    const siblings = children.get(parent) || new Map<string, string[]>();
    siblings.set(key, prefix); children.set(parent, siblings);
  }));
  const nodes: PivotAxisNode[] = [];
  const walk = (parent: string[]) => [...(children.get(id(parent))?.values() || [])].sort((a, b) => {
    const result = a.at(-1)!.localeCompare(b.at(-1)!, "ru");
    const rule = sorts.find((item) => item.field === dimensions[parent.length]?.fieldId && item.target === "key");
    return rule?.direction === "desc" ? -result : result;
  }).forEach((path) => {
    const key = id(path), hasChildren = children.has(key);
    const isExpanded = expanded.includes("*") || expanded.includes(key);
    nodes.push({ id: key, path, labels: path, depth: path.length - 1, isLeaf: !hasChildren, nodeType: hasChildren ? "subtotal" : "detail", hasChildren, expanded: isExpanded });
    if (hasChildren && isExpanded) walk(path);
  });
  if (expanded.includes("root") || expanded.includes("*")) walk([]);
  if (axis === "rows") nodes.unshift({ id: "__all__", path: [], labels: ["Grand total"], depth: 0, isLeaf: false, nodeType: "grandTotal", hasChildren: true, expanded: expanded.includes("root") || expanded.includes("*") });
  if (axis === "columns" && (!nodes.length || dimensions.some((dimension) => dimension.levelKey))) nodes.unshift({ id: "__all__", path: [], labels: ["Grand total"], depth: 0, isLeaf: false, nodeType: "grandTotal", hasChildren: true, expanded: expanded.includes("root") || expanded.includes("*") });
  return nodes;
};

export function temporalPivotModel(plan: TemporalPivotPlan, config: PivotTableConfig, results: Map<string, QueryResult>): PivotTableModel {
  const deepest = plan.scopes.find((scope) => scope.rowDepth === plan.rows.length && scope.columnDepth === plan.columns.length);
  const details = deepest ? results.get(deepest.key)?.rows || [] : [];
  const diagnostics = [...results.values()].flatMap((result) => result.diagnostics.filter((item) => item.severity === "error").map((item) => item.message));
  if (!details.length) return { rows: [], columns: [], cells: [], diagnostics, warnings: [] };
  const rows = axisNodes(details.map((row) => plan.rows.map((dimension) => text(row[dimension.alias]))), "rows", config.expansion.rows, plan.rows, config.rowSorts || []);
  const columns = axisNodes(details.map((row) => plan.columns.map((dimension) => text(row[dimension.alias]))), "columns", config.expansion.columns, plan.columns, config.columnSorts || []);
  const cells: PivotCell[] = [];
  const indexed = new Map<string, Map<string, Array<Record<string, unknown>>>>();
  for (const scope of plan.scopes) {
    const dimensions = [...plan.rows.slice(0, scope.rowDepth), ...plan.columns.slice(0, scope.columnDepth)];
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const item of results.get(scope.key)?.rows || []) {
      const key = JSON.stringify(dimensions.map((dimension) => text(item[dimension.alias])));
      const group = groups.get(key) || []; group.push(item); groups.set(key, group);
    }
    indexed.set(scope.key, groups);
  }
  const scopes = new Map(plan.scopes.map((scope) => [scope.key, scope]));
  for (const row of rows) for (const column of columns) for (const metric of config.aggregations.filter((item) => item.visible)) {
    const scope = scopes.get(`${row.path.length}:${column.path.length}:${metric.id}`);
    const path = [...row.path, ...column.path];
    const matching = scope && indexed.get(scope.key)?.get(JSON.stringify(path)) || [];
    const alias = `${metric.measureField}__${metric.operation}`;
    const numeric = (value: unknown) => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    const value = !matching.length ? null : scope?.rollup ? aggregatePivotPeriods(matching.map((item) => ({ period: text(item[baseAlias]), value: numeric(item[alias]) })), scope.operation) : numeric(matching[0]?.[alias]);
    cells.push({ rowId: row.id, columnId: column.id, aggregationId: metric.id, value });
  }
  return { rows, columns, cells, diagnostics, warnings: [] };
}
