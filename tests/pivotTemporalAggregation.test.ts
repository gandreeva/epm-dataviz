import { strict as assert } from "node:assert";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PivotTableWidget } from "../src/components/PivotTableWidget";
import { pivotHeatmapRange, reorderPivotAxis, togglePivotExpansion } from "../src/query/pivotQuery";
import { aggregatePivotBaseRows, aggregatePivotPeriods, aggregatePivotTemporalCell, pivotPeriodKey, type PivotTimeLevel } from "../src/analytical/pivot/temporalAggregation";
import { planTemporalPivot, setTemporalPivotMaxLevel, temporalPivotHierarchy, temporalPivotModel } from "../src/analytical/pivot/temporalPivot";
import { executeTemporalPivot } from "../src/analytical/pivot/executeTemporalPivot";
import { compileAnalyticalQuery } from "../src/analytical/query/compiler";

test("rolls up base periods rather than weighting by source row counts", () => {
  const values = [{ period: "202602", value: 30 }, { period: "202601", value: 10 }, { period: "202603", value: 10 }];
  assert.equal(aggregatePivotPeriods(values, "SUM"), 50);
  assert.equal(aggregatePivotPeriods(values, "AVG"), 50 / 3);
  assert.equal(aggregatePivotPeriods(values, "COUNT_DISTINCT"), 2);
  assert.equal(aggregatePivotPeriods(values, "FIRST_NON_NULL"), 10);
  assert.equal(aggregatePivotPeriods(values, "LAST_NON_NULL"), 10);
  assert.equal(aggregatePivotPeriods([{ period: "202603", value: null }, { period: "202602", value: 30 }, { period: "202601", value: 10 }], "LAST_NON_NULL"), 30);
});

test("aggregates raw rows by month before applying the hierarchy operation", () => {
  const rows = [
    { date: "20260101", value: 10 }, { date: "20260102", value: 20 },
    { date: "20260201", value: 90 }, { date: "20260202", value: null },
  ];
  assert.equal(aggregatePivotTemporalCell(rows, "value", "date", "MONTH", "SUM", "AVG"), 60);
  assert.equal(aggregatePivotTemporalCell(rows, "value", "date", "MONTH", "AVG", "LAST_NON_NULL"), 90);
  assert.equal(aggregatePivotTemporalCell(rows, "value", "date", "MONTH", "COUNT", "SUM"), 3);
  assert.equal(pivotPeriodKey("20261205", "QUARTER"), "2026Q4");
  assert.equal(pivotPeriodKey("20261305", "MONTH"), null);
});

test("ignores missing and non-finite period values", () => {
  const values = [{ period: "202601", value: null }, { period: "202602", value: 5 }, { period: "202603", value: Number.NaN }];
  assert.equal(aggregatePivotPeriods(values, "COUNT"), 1);
  assert.equal(aggregatePivotPeriods(values, "FIRST_NON_NULL"), 5);
  assert.equal(aggregatePivotPeriods([], "SUM"), null);
  assert.equal(aggregatePivotPeriods([], "COUNT"), 0);
});

test("plans two-stage aggregations for rows and columns including grand totals", () => {
  const levels = ["YEAR", "QUARTER", "MONTH", "DAY"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", levels }] } }] };
  const config: any = { rows: ["0date"], columns: ["contract"], timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD" }, aggregations: [{ id: "metric", measureField: "amount", operation: "SUM", hierarchyBaseLevel: "MONTH", hierarchyAggregation: "AVG", visible: true }], expansion: { rows: ["root", "*"], columns: ["root", "*"] } };
  const raw: any[] = [{ "0date": "20260101", contract: "A", amount: 10 }, { "0date": "20260102", contract: "A", amount: 20 }, { "0date": "20260201", contract: "A", amount: 90 }];
  const plan = planTemporalPivot(dataset, config, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [] })!;
  const empty = temporalPivotModel(plan, config, new Map(plan.scopes.map((scope) => [scope.key, { rows: [], diagnostics: [] } as any])));
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.columns, []);
  assert.deepEqual(empty.cells, []);
  const results = new Map(plan.scopes.map((scope) => {
    const groups = new Map<string, { dimensions: Record<string, string>; rows: any[] }>();
    for (const row of raw) {
      const dimensions = Object.fromEntries(scope.query.dimensions.map((dimension) => [dimension.alias!, dimension.hierarchy ? pivotPeriodKey(row[dimension.fieldId], dimension.hierarchy.levelKey as PivotTimeLevel) : row[dimension.fieldId]]));
      const key = JSON.stringify(dimensions), group = groups.get(key) || { dimensions, rows: [] };
      group.rows.push(row); groups.set(key, group);
    }
    const result: any = { rows: [...groups.values()].map((group) => ({ ...group.dimensions, amount__SUM: aggregatePivotBaseRows(group.rows, "amount", "SUM") })), diagnostics: [] };
    const compiled = compileAnalyticalQuery(scope.query, "dataset_credit_lifecycle");
    assert.match(compiled.sql, /"0date"/);
    return [scope.key, result] as const;
  }));
  const model = temporalPivotModel(plan, config, results);
  const cell = (row: string, column: string) => model.cells.find((item) => item.rowId === row && item.columnId === column)?.value;
  assert.equal(cell("__all__", "A"), 60);
  assert.equal(cell("2026", "A"), 60);
  assert.equal(cell("2026\u001f2026Q1\u001f202601", "A"), 30);
  assert.equal(cell("2026\u001f2026Q1\u001f202601\u001f20260101", "A"), 10);
  const columnConfig = { ...config, rows: ["contract"], columns: ["0date"] };
  const columnPlan = planTemporalPivot(dataset, columnConfig, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [] })!;
  assert.equal(columnPlan.columns.length, 4);
  assert.ok(columnPlan.scopes.some((scope) => scope.rowDepth === 1 && scope.columnDepth === 1 && scope.rollup));
  const columnResults = new Map(columnPlan.scopes.map((scope) => {
    const groups = new Map<string, { dimensions: Record<string, unknown>; rows: any[] }>();
    for (const row of raw) {
      const dimensions = Object.fromEntries(scope.query.dimensions.map((dimension) => [dimension.alias!, dimension.hierarchy ? pivotPeriodKey(row[dimension.fieldId], dimension.hierarchy.levelKey as PivotTimeLevel) : row[dimension.fieldId]]));
      const key = JSON.stringify(dimensions), group = groups.get(key) || { dimensions, rows: [] };
      group.rows.push(row); groups.set(key, group);
    }
    return [scope.key, { rows: [...groups.values()].map((group) => ({ ...group.dimensions, amount__SUM: aggregatePivotBaseRows(group.rows, "amount", "SUM") })), diagnostics: [] } as any] as const;
  }));
  const expandedColumns = temporalPivotModel(columnPlan, columnConfig, columnResults);
  assert.equal(expandedColumns.cells.find((item) => item.rowId === "A" && item.columnId === "__all__")?.value, 60);
  const collapsedColumns = temporalPivotModel(columnPlan, { ...columnConfig, expansion: { rows: ["root", "*"], columns: [] } }, columnResults);
  assert.deepEqual(collapsedColumns.columns.map((item) => item.id), ["__all__"]);
  assert.equal(collapsedColumns.cells.find((item) => item.rowId === "A" && item.columnId === "__all__")?.value, 60);
  assert.equal(planTemporalPivot(dataset, { ...config, rows: [], columns: [] }, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [] }), null);
  const filter: any = { fieldId: "contract", operator: "IN", values: ["A"] };
  const filtered = planTemporalPivot(dataset, config, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [filter] })!;
  assert.ok(filtered.scopes.every((scope) => scope.query.filters[0] === filter));
});

test("DuckDB groups base periods before hierarchy rollup", (context) => {
  const available = spawnSync("duckdb", ["--version"], { timeout: 5000 });
  if (available.status !== 0) return context.skip("DuckDB CLI unavailable");
  const levels = ["YEAR", "QUARTER", "MONTH", "DAY"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", levels }] } }] };
  const config: any = { rows: ["0date"], columns: [], timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD" }, aggregations: [{ id: "metric", measureField: "amount", operation: "SUM", hierarchyBaseLevel: "MONTH", hierarchyAggregation: "AVG", visible: true }], expansion: { rows: ["root", "*"], columns: ["root", "*"] } };
  const plan = planTemporalPivot(dataset, config, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [] })!;
  const results = new Map<string, any>();
  for (const scope of plan.scopes) {
    const { sql } = compileAnalyticalQuery(scope.query, "sample");
    const input = `CREATE TABLE sample ("0date" VARCHAR, amount DOUBLE); INSERT INTO sample VALUES ('20260101', 10), ('20260102', 20), ('20260201', 90); ${sql};`;
    const response = spawnSync("duckdb", ["-json", ":memory:", "-c", input], { encoding: "utf8", timeout: 10000 });
    if (response.status === null && response.error) return context.skip(`DuckDB process unavailable: ${response.error.message}`);
    assert.equal(response.status, 0, response.stderr);
    results.set(scope.key, { rows: JSON.parse(response.stdout || "[]"), diagnostics: [] });
  }
  const model = temporalPivotModel(plan, config, results);
  assert.equal(model.cells.find((cell) => cell.rowId === "2026" && cell.columnId === "__all__")?.value, 60);
  assert.equal(model.cells.find((cell) => cell.rowId === "__all__" && cell.columnId === "__all__")?.value, 60);
});

test("DuckDB temporal pivot honors filters, axis placement and metric rollups", (context) => {
  const available = spawnSync("duckdb", ["--version"], { timeout: 5000 });
  if (available.status !== 0) return context.skip("DuckDB CLI unavailable");
  const levels = ["YEAR", "QUARTER", "MONTH", "DAY"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", levels }] } }] };
  const metric = (id: string, hierarchyAggregation: string) => ({ id, measureField: "amount", operation: "SUM", hierarchyBaseLevel: "MONTH", hierarchyAggregation, visible: true });
  const config: any = { rows: ["contract"], columns: ["0date"], timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD" }, aggregations: [metric("average", "AVG"), metric("last", "LAST_NON_NULL"), metric("distinct", "COUNT_DISTINCT"), { ...metric("firstDay", "FIRST_NON_NULL"), hierarchyBaseLevel: "DAY" }], expansion: { rows: ["root", "*"], columns: ["root", "*"] } };
  const base: any = { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [{ fieldId: "contract", operator: "IN", values: ["A"] }] };
  const plan = planTemporalPivot(dataset, config, base)!;
  const results = new Map<string, any>();
  for (const scope of plan.scopes) {
    const compiled = compileAnalyticalQuery(scope.query, "sample");
    assert.deepEqual(compiled.parameters, ["A"]);
    const sql = compiled.sql.replaceAll("$1", "'A'");
    const input = `CREATE TABLE sample ("0date" VARCHAR, contract VARCHAR, amount DOUBLE); INSERT INTO sample VALUES ('20260101','A',10), ('20260102','A',20), ('20260201','A',90), ('20260301','A',NULL), ('20260101','B',999); ${sql};`;
    const response = spawnSync("duckdb", ["-json", ":memory:", "-c", input], { encoding: "utf8", timeout: 10000 });
    if (response.status === null && response.error) return context.skip(`DuckDB process unavailable: ${response.error.message}`);
    assert.equal(response.status, 0, response.stderr);
    results.set(scope.key, { rows: JSON.parse(response.stdout || "[]"), diagnostics: [] });
  }
  const model = temporalPivotModel(plan, config, results);
  const value = (column: string, aggregationId: string) => model.cells.find((cell) => cell.rowId === "A" && cell.columnId === column && cell.aggregationId === aggregationId)?.value;
  assert.ok(!model.rows.some((row) => row.id === "B"));
  assert.equal(value("__all__", "average"), 60);
  assert.equal(value("2026", "last"), 90);
  assert.equal(value("2026", "distinct"), 2);
  assert.equal(value("2026", "firstDay"), 10);
  assert.equal(value("2026\u001f2026Q1\u001f202601\u001f20260101", "average"), 10);
  const capped = { ...config, timeHierarchy: { ...config.timeHierarchy, maxLevelKey: "MONTH" }, aggregations: [{ ...metric("lastDay", "LAST_NON_NULL"), hierarchyBaseLevel: "DAY" }] };
  const cappedPlan = planTemporalPivot(dataset, capped, base)!;
  const cappedResults = new Map<string, any>();
  for (const scope of cappedPlan.scopes) {
    const compiled = compileAnalyticalQuery(scope.query, "sample");
    const input = `CREATE TABLE sample ("0date" VARCHAR, contract VARCHAR, amount DOUBLE); INSERT INTO sample VALUES ('20260101','A',10), ('20260102','A',20), ('20260201','A',90), ('20260101','B',999); ${compiled.sql.replaceAll("$1", "'A'")};`;
    const response = spawnSync("duckdb", ["-json", ":memory:", "-c", input], { encoding: "utf8", timeout: 10000 });
    if (response.status === null && response.error) return context.skip(`DuckDB process unavailable: ${response.error.message}`);
    assert.equal(response.status, 0, response.stderr);
    cappedResults.set(scope.key, { rows: JSON.parse(response.stdout || "[]"), diagnostics: [] });
  }
  const cappedModel = temporalPivotModel(cappedPlan, capped, cappedResults);
  assert.equal(cappedModel.cells.find((cell) => cell.rowId === "A" && cell.columnId === "2026\u001f2026Q1\u001f202601" && cell.aggregationId === "lastDay")?.value, 20);
  assert.ok(cappedModel.columns.every((column) => column.path.length <= 3));
});

test("renders hierarchy controls for time columns and labels for tabular rows", () => {
  const levels = ["YEAR", "MONTH"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", label: "Дата", kind: "dimension", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", levels }] } }, { id: "value", label: "Значение", kind: "measure" }] };
  const config: any = { rows: [], columns: ["0date"], timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD" }, aggregations: [{ id: "m", measureField: "value", operation: "SUM", label: "Значение", visible: true }], rowSorts: [], columnSorts: [], expansion: { rows: ["root"], columns: ["root"] }, heatmapModes: [], conditionalFormatting: [], formatting: {}, dataBars: [] };
  const model: any = { rows: [{ id: "__all__", path: [], labels: ["Grand total"], depth: 0, nodeType: "grandTotal", hasChildren: false }], columns: [{ id: "2026", path: ["2026"], labels: ["2026"], depth: 0, nodeType: "subtotal", hasChildren: true, expanded: false }], cells: [{ rowId: "__all__", columnId: "2026", aggregationId: "m", value: 0 }], diagnostics: [], warnings: [] };
  const html = renderToStaticMarkup(React.createElement(PivotTableWidget, { dataset, config, model, onChange() {} }));
  assert.match(html, /Раскрытие временной иерархии столбцов/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-cell-value="0"/);
  const rowHtml = renderToStaticMarkup(React.createElement(PivotTableWidget, { dataset, config: { ...config, rows: ["0date"], columns: [], rowLayout: "tabular" }, model: { ...model, rows: model.columns, columns: model.rows }, onChange() {} }));
  assert.match(rowHtml, /Дата · YEAR/);
  assert.match(rowHtml, /Дата · MONTH/);
});

test("folding one time branch preserves expanded siblings and can reopen root", () => {
  const node = (path: string[], expanded: boolean, hasChildren = true): any => ({ id: path.length ? path.join("\u001f") : "__all__", path, labels: path, expanded, hasChildren });
  const root = node([], true), year2025 = node(["2025"], true), quarter = node(["2025", "2025Q1"], true), year2026 = node(["2026"], true);
  assert.deepEqual(togglePivotExpansion(["root", "*"], [root, year2025, quarter, year2026], year2025), ["root", "2026"]);
  assert.deepEqual(togglePivotExpansion(["root", "2026"], [root, year2025, year2026], { ...year2025, expanded: false }), ["root", "2026", "2025"]);
  assert.deepEqual(togglePivotExpansion(["root", "*"], [root], root), []);
  assert.deepEqual(togglePivotExpansion([], [{ ...root, expanded: false }], { ...root, expanded: false }), ["root"]);
});

test("reorders axes by insertion, resets only affected expansion and preserves temporal settings", () => {
  const config: any = { rows: ["version", "0date", "contract"], columns: ["scenario", "region", "product"], expansion: { rows: ["root", "V", "V\u001f2026"], columns: ["root", "*"] }, timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD", maxLevelKey: "MONTH" }, aggregations: [{ id: "m", hierarchyBaseLevel: "DAY" }], rowSorts: [{ field: "version" }], columnSorts: [{ field: "region" }] };
  const first = reorderPivotAxis(config, "rows", "contract", 0);
  assert.deepEqual(first.rows, ["contract", "version", "0date"]);
  assert.deepEqual(first.expansion, { rows: ["root"], columns: ["root", "*"] });
  assert.deepEqual(first.timeHierarchy, config.timeHierarchy);
  assert.deepEqual(first.aggregations, config.aggregations);
  assert.deepEqual(first.rowSorts, config.rowSorts);
  const levels = ["YEAR", "QUARTER", "MONTH", "DAY"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", levels }] } }] };
  const configured = { ...first, aggregations: [{ id: "m", measureField: "amount", operation: "SUM" as const, visible: true }] };
  const plan = planTemporalPivot(dataset, configured, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [] })!;
  assert.deepEqual(plan.rows.map((dimension) => dimension.levelKey || dimension.fieldId), ["contract", "version", "YEAR", "QUARTER", "MONTH"]);
  const last = reorderPivotAxis(first, "columns", "scenario", 2);
  assert.deepEqual(last.columns, ["region", "product", "scenario"]);
  assert.deepEqual(last.expansion, { rows: ["root"], columns: ["root"] });
  assert.equal(reorderPivotAxis(config, "rows", "0date", 1), config);
  assert.equal(reorderPivotAxis(config, "rows", "missing", 0), config);
  assert.equal(reorderPivotAxis(config, "rows", "0date", -1), config);
  assert.deepEqual(config.rows, ["version", "0date", "contract"]);
});

test("monthly sources do not offer an unsupported day level", () => {
  const levels = ["YEAR", "QUARTER", "MONTH", "DAY"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "key_rate_scenarios", fields: [{ id: "period", semantic: { dataType: "date", granularity: "month", hierarchies: [{ hierarchyId: "calendar", levels }] } }] };
  const config: any = { rows: ["period"], columns: [], timeHierarchy: { fieldId: "period", hierarchyId: "calendar" }, aggregations: [{ id: "m", measureField: "rate", operation: "AVG", visible: true }] };
  const plan = planTemporalPivot(dataset, config, { datasetId: "key_rate_scenarios", dimensions: [], measures: [], filters: [] })!;
  assert.deepEqual(plan.rows.map((dimension) => dimension.levelKey), ["YEAR", "QUARTER", "MONTH"]);
  const year = plan.scopes.find((scope) => scope.rowDepth === 1)!;
  assert.equal(year.query.dimensions.at(-1)?.hierarchy?.levelKey, "MONTH");
});

test("maximum visible level limits the axis while base-period aggregation stays independent", () => {
  const levels = ["YEAR", "QUARTER", "MONTH", "DAY"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", levels }] } }] };
  const config: any = { rows: ["version", "0date", "contract"], columns: [], timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD", maxLevelKey: "MONTH" }, aggregations: [{ id: "m", measureField: "value", operation: "SUM", hierarchyBaseLevel: "DAY", hierarchyAggregation: "LAST_NON_NULL", visible: true }], expansion: { rows: ["root", "*"], columns: ["root"] } };
  const plan = planTemporalPivot(dataset, config, { datasetId: dataset.id, dimensions: [], measures: [], filters: [] })!;
  assert.deepEqual(plan.rows.map((dimension) => dimension.levelKey || dimension.fieldId), ["version", "YEAR", "QUARTER", "MONTH", "contract"]);
  const monthScope = plan.scopes.find((scope) => scope.rowDepth === 4)!;
  assert.equal(monthScope.rollup, true);
  assert.equal(monthScope.query.dimensions.at(-1)?.hierarchy?.levelKey, "DAY");
  assert.equal(monthScope.operation, "LAST_NON_NULL");
  assert.equal(temporalPivotHierarchy(dataset, { ...config, timeHierarchy: { ...config.timeHierarchy, maxLevelKey: "invalid" } })?.maxLevel.levelKey, "DAY");
  assert.equal(temporalPivotHierarchy(dataset, { ...config, timeHierarchy: { fieldId: "0date", hierarchyId: "YQMD" } })?.maxLevel.levelKey, "DAY");
  const expanded = { ...config, expansion: { rows: ["root", "V", "V\u001f2026", "V\u001f2026\u001f2026Q1", "V\u001f2026\u001f2026Q1\u001f202601", "V\u001f2026\u001f2026Q1\u001f202601\u001fC"], columns: ["root", "other"] } };
  const changed = setTemporalPivotMaxLevel(dataset, expanded, "QUARTER");
  assert.deepEqual(changed.expansion.rows, ["root", "V", "V\u001f2026", "V\u001f2026\u001f2026Q1"]);
  assert.deepEqual(changed.expansion.columns, ["root", "other"]);
  assert.equal(changed.timeHierarchy?.maxLevelKey, "QUARTER");
  assert.equal(setTemporalPivotMaxLevel(dataset, changed, "invalid"), changed);
  const columns = { ...config, rows: [], columns: ["0date", "contract"], expansion: { rows: ["root", "R"], columns: ["root", "*", "2026\u001f2026Q1\u001f202601\u001fC"] } };
  const columnChanged = setTemporalPivotMaxLevel(dataset, columns, "YEAR");
  assert.deepEqual(columnChanged.expansion, { rows: ["root", "R"], columns: ["root", "*"] });
});

test("date hierarchy sorting respects descending year order", () => {
  const levels = ["YEAR", "MONTH"].map((levelKey, depth) => ({ levelKey, levelLabel: levelKey, depth }));
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "0date", semantic: { dataType: "date", granularity: "month", hierarchies: [{ hierarchyId: "calendar", levels }] } }] };
  const config: any = { rows: ["0date"], columns: [], timeHierarchy: { fieldId: "0date", hierarchyId: "calendar" }, aggregations: [{ id: "m", measureField: "value", operation: "SUM", visible: true }], rowSorts: [{ field: "0date", target: "key", direction: "desc" }], columnSorts: [], expansion: { rows: ["root"], columns: ["root"] } };
  const plan = planTemporalPivot(dataset, config, { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [] })!;
  const deepest = plan.scopes.find((scope) => scope.rowDepth === 2)!;
  const results = new Map([[deepest.key, { rows: [{ __pivot_r0_YEAR: "2025", __pivot_r0_MONTH: "202512" }, { __pivot_r0_YEAR: "2026", __pivot_r0_MONTH: "202601" }], diagnostics: [] } as any]]);
  assert.deepEqual(temporalPivotModel(plan, config, results).rows.map((row) => row.id), ["__all__", "2026", "2025"]);
});

test("heatmap bounds handle a large expanded pivot without argument overflow", () => {
  const model: any = { rows: [{ id: "r", nodeType: "detail" }], cells: Array.from({ length: 140000 }, (_, index) => ({ rowId: "r", aggregationId: "m", value: index - 500 })) };
  assert.deepEqual(pivotHeatmapRange(model, "m"), { min: -500, max: 139499 });
});

test("executes temporal scopes in bounded batches and discards a cancelled view", async () => {
  const query: any = { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [], limit: 50000 };
  const plan: any = { scopes: Array.from({ length: 9 }, (_, index) => ({ key: String(index), query })) };
  let active = 0, maximum = 0, started = 0, cancelled = false;
  const controller: any = { execute: async () => { started++; active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return { state: "empty", queryKey: JSON.stringify(query), result: { rows: [], rowCount: 0 } }; } };
  const results = await executeTemporalPivot(plan, () => controller, () => false);
  assert.equal(results?.size, 9);
  assert.equal(maximum, 4);
  started = 0;
  const cancelling: any = { execute: async () => { started++; cancelled = true; return { state: "empty", queryKey: JSON.stringify(query), result: { rows: [], rowCount: 0 } }; } };
  assert.equal(await executeTemporalPivot(plan, () => cancelling, () => cancelled), null);
  assert.equal(started, 4);
});

test("rejects stale snapshots, query failures and truncated temporal results", async () => {
  const query: any = { datasetId: "credit_lifecycle", dimensions: [], measures: [], filters: [], limit: 1 };
  const plan: any = { scopes: [{ key: "scope", query }] };
  const run = (snapshot: any) => executeTemporalPivot(plan, () => ({ execute: async () => snapshot }), () => false);
  await assert.rejects(run({ state: "loading", queryKey: JSON.stringify(query), result: { rowCount: 0 } }), /актуального/);
  await assert.rejects(run({ state: "success", queryKey: "old", result: { rowCount: 0 } }), /актуального/);
  await assert.rejects(run({ state: "error", error: new Error("duckdb failure") }), /duckdb failure/);
  await assert.rejects(run({ state: "success", queryKey: JSON.stringify(query), result: { rowCount: 1 } }), /лимит строк/);
});
