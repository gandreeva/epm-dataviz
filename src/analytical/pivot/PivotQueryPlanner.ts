import type { Dataset, PageFilterDefinition, PageFilterState, PivotTableConfig } from "../../types";
import type { AnalyticalQuery, QueryFilter } from "../query/types";
import { pivotAnalyticalQuery } from "../query/builders";

export interface PivotBranchScope {
  key: string;
  axis: "root" | "rows" | "columns";
  path: string[];
  query: AnalyticalQuery;
}

export interface PivotSubtotalScope {
  key: string;
  rowDepth: number;
  query: AnalyticalQuery;
}

export interface PivotQueryPlan {
  scopes: PivotBranchScope[];
  subtotalScopes: PivotSubtotalScope[];
  totalScope: PivotBranchScope;
  signature: string;
}

const pathKey = (path: string[]) => path.length ? path.join("\u001f") : "root";

/**
 * Produces deterministic, parameterized scopes for Pivot expansion. A scope
 * only adds equality filters for its ancestors; SQL construction remains in
 * QueryCompiler and values are never interpolated into SQL.
 */
export function planPivotQueries(
  dataset: Dataset,
  config: PivotTableConfig,
  pageFilters: PageFilterDefinition[],
  runtime: PageFilterState,
  paths: { rows?: string[]; columns?: string[] } = {},
): PivotQueryPlan {
  const base = pivotAnalyticalQuery(dataset, config, pageFilters, runtime);
  const scopes: PivotBranchScope[] = [];
  const subtotalScopes: PivotSubtotalScope[] = [];
  const queryFor = (fields: string[], filters: QueryFilter[] = []) : AnalyticalQuery => ({
    ...base,
    filters: [...base.filters, ...filters],
    dimensions: [...fields, ...config.columns].filter((field, index, all) => all.indexOf(field) === index).map((fieldId) => ({ fieldId })),
    orderBy: fields.length ? fields.map((fieldId) => ({ fieldId, direction: "asc" as const })) : (config.columns.length ? config.columns.map((fieldId) => ({ fieldId, direction: "asc" as const })) : undefined),
  });
  const add = (axis: PivotBranchScope["axis"], path: string[], fields: string[]) => {
    const filters: QueryFilter[] = path.map((value, index) => ({ fieldId: fields[index], operator: "EQ" as const, value }));
    const query = queryFor(fields, filters);
    scopes.push({ key: `pivot:${dataset.id}:${axis}:${pathKey(path)}`, axis, path, query });
  };
  const rowPath = paths.rows || [], columnPath = paths.columns || [];
  if (!rowPath.length && !columnPath.length) {
    add("root", [], config.rows);
    // Expansion state is persisted as stable path ids (dimension values joined
    // by the unit-separator).  Materialize one parameterized branch scope for
    // every explicitly expanded row path so the application can progressively
    // switch from the root aggregate to query-by-expansion without changing
    // the Pivot result contract.
    const expandedRows = (config.expansion?.rows || [])
      .filter((value) => value !== "root" && value !== "*")
      .map((value) => value.split("\u001f"))
      .filter((path) => path.length > 0 && path.length <= config.rows.length);
    expandedRows.forEach((path) => add("rows", path, config.rows));
  } else if (rowPath.length) {
    add("rows", rowPath, config.rows);
  } else {
    add("columns", columnPath, config.columns);
  }
  if (!rowPath.length && !columnPath.length) {
    for (let rowDepth = 1; rowDepth < config.rows.length; rowDepth += 1) {
      const fields = config.rows.slice(0, rowDepth);
      subtotalScopes.push({
        key: `pivot:${dataset.id}:subtotal:${rowDepth}`,
        rowDepth,
        query: queryFor(fields),
      });
    }
  }
  const totalScope: PivotBranchScope = {
    key: `pivot:${dataset.id}:total:root`,
    axis: "root",
    path: [],
    query: queryFor([]),
  };
  return { scopes, subtotalScopes, totalScope, signature: JSON.stringify([...scopes.map((scope) => [scope.key, scope.query]), ...subtotalScopes.map((scope) => [scope.key, scope.query]), [totalScope.key, totalScope.query]]) };
}
