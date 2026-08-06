import type {
  DataRow,
  Dataset,
  PageFilterDefinition,
  PageFilterState,
  PivotAggregation,
  PivotTableConfig,
  PivotSortRule,
} from "../types";

export interface PivotAxisNode {
  id: string;
  path: string[];
  labels: string[];
  depth: number;
  isLeaf: boolean;
  nodeType: "grandTotal" | "subtotal" | "detail";
  hasChildren: boolean;
  expanded: boolean;
}
export interface PivotCell {
  rowId: string;
  columnId: string;
  aggregationId: string;
  value: number | null;
}
export interface PivotTableModel {
  rows: PivotAxisNode[];
  columns: PivotAxisNode[];
  cells: PivotCell[];
  diagnostics: string[];
  warnings: string[];
}
export function pivotHeatmapRange(model: PivotTableModel, aggregationId: string) {
  const detailRows = model.rows.filter((row) => row.nodeType === "detail");
  const rows = detailRows.length ? detailRows : model.rows;
  const rowIds = new Set(rows.map((row) => row.id));
  const values = model.cells.filter((cell) => cell.aggregationId === aggregationId && rowIds.has(cell.rowId)).map((cell) => cell.value).filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values), max = Math.max(...values);
  return { min, max: min === max ? min + 1 : max };
}
export const createDefaultPivotConfig = (dataset: Dataset): PivotTableConfig => {
  const dimensions = dataset.fields.filter((field) => field.kind === "dimension");
  const measures = dataset.fields.filter((field) => field.kind === "measure");
  return {
    datasetId: dataset.id,
    rows: dimensions.slice(0, 1).map((field) => field.id),
    columns: dimensions.slice(1, 2).map((field) => field.id),
    aggregations: measures.slice(0, 2).map((field, index) => ({ id: `pivot-${field.id}-${index}`, measureField: field.id, operation: "SUM" as const, label: field.label, format: { unit: field.unit }, visible: true })),
    rowSorts: [],
    columnSorts: [],
    expansion: { rows: ["root", "*"], columns: ["root", "*"] },
    formatting: {},
    conditionalFormatting: [],
    dataBars: [],
    heatmapModes: [],
    sourceRevision: 1,
    rowLayout: "compact",
  };
};

const valueText = (value: unknown) => value == null || value === "" ? "∅" : String(value);
const pathId = (path: string[]) => path.length ? path.join("\u001f") : "__all__";
const matches = (row: DataRow, field: string, selected: string[]) => !selected.length || selected.includes(valueText(row[field]));
const matchesFilter = (row: DataRow, definition: PageFilterDefinition, value: PageFilterState[string] | undefined) => {
  if (!value) return true;
  if (definition.kind === "categorical" && Array.isArray(value)) return matches(row, definition.fieldId, value);
  if (Array.isArray(value)) return true;
  const raw = valueText(row[definition.fieldId]);
  return (!value.from || raw >= value.from) && (!value.to || raw <= value.to);
};
const aggregate = (rows: DataRow[], aggregation: PivotAggregation) => {
  if (aggregation.operation === "COUNT") return rows.length;
  if (aggregation.operation === "COUNT_DISTINCT") return new Set(rows.map((row) => valueText(row[aggregation.measureField]))).size;
  const values = rows.map((row) => Number(row[aggregation.measureField])).filter(Number.isFinite);
  if (!values.length) return null;
  if (aggregation.operation === "SUM") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation.operation === "AVG") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation.operation === "MIN") return Math.min(...values);
  return Math.max(...values);
};
const compareNodes = (rules: PivotSortRule[], fields: string[], dataset: Dataset, a: PivotAxisNode, b: PivotAxisNode, rows: DataRow[], aggregations: PivotAggregation[]) => {
  for (const rule of rules) {
    const index = fields.indexOf(rule.field), av = index >= 0 ? a.path[index] : a.id, bv = index >= 0 ? b.path[index] : b.id;
    let result = String(av ?? "").localeCompare(String(bv ?? ""), "ru");
    if (rule.target !== "key") {
      const aggregation = aggregations.find((item) => item.id === rule.target);
      if (aggregation) {
        const aRows = rows.filter((row) => pathId(fields.map((field) => valueText(row[field]))) === a.id);
        const bRows = rows.filter((row) => pathId(fields.map((field) => valueText(row[field]))) === b.id);
        result = Number(aggregate(aRows, aggregation) || 0) - Number(aggregate(bRows, aggregation) || 0);
      }
    }
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return 0;
};
const isPathPrefix = (parent: string[], candidate: string[]) => parent.length < candidate.length && parent.every((value, index) => value === candidate[index]);
const compareHierarchyNodes = (rules: PivotSortRule[], fields: string[], dataset: Dataset, a: PivotAxisNode, b: PivotAxisNode, rows: DataRow[], aggregations: PivotAggregation[]) => {
  if (isPathPrefix(a.path, b.path)) return -1;
  if (isPathPrefix(b.path, a.path)) return 1;
  const custom = compareNodes(rules, fields, dataset, a, b, rows, aggregations);
  if (custom !== 0) return custom;
  const length = Math.min(a.path.length, b.path.length);
  for (let index = 0; index < length; index += 1) {
    const result = String(a.path[index]).localeCompare(String(b.path[index]), "ru");
    if (result !== 0) return result;
  }
  return a.path.length - b.path.length;
};

export function runPivotQuery(
  dataset: Dataset,
  config: PivotTableConfig,
  pageRuntime: PageFilterState = {},
  pageFilters: PageFilterDefinition[] = [],
): PivotTableModel {
  const diagnostics: string[] = [];
  const allFields = new Set(dataset.fields.map((field) => field.id));
  const rowsFields = config.rows.filter((field) => allFields.has(field));
  const columnsFields = config.columns.filter((field) => allFields.has(field));
  const aggregations = config.aggregations.filter((aggregation) => allFields.has(aggregation.measureField) || aggregation.operation === "COUNT");
  if (!aggregations.length) diagnostics.push("Добавьте минимум один показатель в Measures");
  const duplicate = rowsFields.filter((field) => columnsFields.includes(field));
  if (duplicate.length) diagnostics.push(`Поле ${duplicate.join(", ")} находится одновременно в Rows и Columns`);
  let rows = dataset.rows.filter((row) => pageFilters.every((definition) => matchesFilter(row, definition, pageRuntime[definition.fieldId])));
  const makeNodes = (fields: string[], axis: "rows" | "columns"): PivotAxisNode[] => {
    const keys = new Map<string, string[]>();
    const grandTotal: PivotAxisNode = { id: "__all__", path: [], labels: ["Grand total"], depth: 0, isLeaf: !fields.length, nodeType: "grandTotal", hasChildren: Boolean(fields.length), expanded: config.expansion[axis].includes("root") };
    if (!fields.length) return [grandTotal];
    if (axis === "columns" && config.expansion[axis].length === 1 && config.expansion[axis][0] === "root") return [{ ...grandTotal, expanded: false }];
    rows.forEach((row) => {
      const path = fields.map((field) => valueText(row[field]));
      for (let depth = 1; depth <= path.length; depth += 1) keys.set(pathId(path.slice(0, depth)), path.slice(0, depth));
    });
    const expanded = config.expansion[axis];
    const expandAll = expanded.includes("*");
    const isExpanded = (path: string[]) => expandAll || expanded.includes(pathId(path));
    const allNodes = [...keys.entries()].map(([id, path]) => {
      const hasChildren = [...keys.values()].some((candidate) => candidate.length > path.length && candidate.slice(0, path.length).every((value, index) => value === path[index]));
      return { id, path, labels: path, depth: path.length - 1, isLeaf: !hasChildren, nodeType: hasChildren ? "subtotal" as const : "detail" as const, hasChildren, expanded: isExpanded(path) };
    });
    const visibleNodes: PivotAxisNode[] = [];
    const walk = (parentPath: string[]) => {
      const children = allNodes
        .filter((node) => node.path.length === parentPath.length + 1 && parentPath.every((value, index) => node.path[index] === value))
        .sort((a, b) => compareHierarchyNodes(axis === "rows" ? config.rowSorts : config.columnSorts, fields, dataset, a, b, rows, aggregations));
      children.forEach((node) => {
        visibleNodes.push(node);
        if (node.hasChildren && node.expanded) walk(node.path);
      });
    };
    if (expanded.includes("root") || expandAll) walk([]);
    return axis === "rows" ? [grandTotal, ...visibleNodes] : visibleNodes;
  };
  const rowNodes = makeNodes(rowsFields, "rows");
  const columnNodes = makeNodes(columnsFields, "columns");
  const cells: PivotCell[] = [];
  rowNodes.forEach((rowNode) => columnNodes.forEach((columnNode) => {
    const matching = rows.filter((row) => rowsFields.every((field, index) => rowNode.path[index] === undefined || valueText(row[field]) === rowNode.path[index]) && columnsFields.every((field, index) => columnNode.path[index] === undefined || valueText(row[field]) === columnNode.path[index]));
    aggregations.forEach((aggregation) => cells.push({ rowId: rowNode.id, columnId: columnNode.id, aggregationId: aggregation.id, value: aggregate(matching, aggregation) }));
  }));
  const sortedRows = rowNodes;
  const sortedColumns = columnNodes;
  return { rows: sortedRows, columns: sortedColumns, cells, diagnostics, warnings: [] };
}
