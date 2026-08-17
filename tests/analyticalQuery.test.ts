import test from "node:test";
import assert from "node:assert/strict";
import { compileAnalyticalQuery } from "../src/analytical/query/compiler";
import { chartAnalyticalQuery, queryFilters } from "../src/analytical/query/builders";
import { validateAndNormalizeCsv, DatasetFormatValidationError } from "../src/analytical/datasets/formatValidator";
import { QueryController } from "../src/analytical/runtime/QueryController";
import { DatasetMetadataService } from "../src/analytical/metadata/DatasetMetadataService";
import { DatasetRegistry } from "../src/analytical/datasets/DatasetRegistry";
import { planPivotQueries } from "../src/analytical/pivot/PivotQueryPlanner";
import { buildWaterfall } from "../src/query/specializedCharts";
import { chartModelFromQueryResult, normalizeWaterfallQueryResult, pivotModelFromQueryResult, pivotModelFromQueryResults } from "../src/analytical/adapters";
import { composeDatasetRows } from "../src/data/composedDataset";
import { resolveActualForecast } from "../src/query/actualForecast";
import { normalizeTransportValue, transportKey } from "../src/analytical/query/transport";

test("normalizes DuckDB BigInt values before Worker transport and JSON serialization", () => {
  const row = normalizeTransportValue({ safe: 42n, large: 9007199254740993n, nested: [1n, null] }) as Record<string, unknown>;
  assert.equal(row.safe, 42);
  assert.equal(row.large, "9007199254740993");
  assert.deepEqual(row.nested, [1, null]);
  assert.doesNotThrow(() => JSON.stringify(row));
  assert.equal(transportKey({ id: 1n }), transportKey({ id: 1 }));
});

test("composes mapped temporal sources from catalog metadata without dataset-specific rules", () => {
  const definition: any = {
    datasetId: "composed",
    fields: { period: { dataType: "date", granularity: "month", outputFormat: "YYYYMM" }, scenario: { dataType: "string" } },
    source: {
      type: "composed",
      sources: [
        {
          datasetId: "actual",
          definition: { datasetId: "actual", fields: { physical_date: { dataType: "date", granularity: "day", outputFormat: "YYYYMMDD" } } },
          mappings: { physical_date: "period" },
          constants: { scenario: "FCT" },
        },
        {
          datasetId: "forecast",
          definition: { datasetId: "forecast", fields: { physical_month: { dataType: "date", granularity: "month", outputFormat: "YYYYMM" } } },
          mappings: { physical_month: "period" },
          constants: { scenario: "BASE" },
        },
      ],
    },
  };
  assert.deepEqual(composeDatasetRows(definition, {
    actual: [{ physical_date: "20260715" }],
    forecast: [{ physical_month: "202607" }],
  }), [
    { period: "202607", scenario: "FCT" },
    { period: "202607", scenario: "BASE" },
  ]);
});

test("resolves series Actual/Forecast roles without split date", () => {
  const dataset: any = { fields: [{ id: "scenario_series", semantic: { role: "scenario", members: { FCT: { timeRole: "actual" }, BASE: { timeRole: "forecast" } } } }] };
  const model: any = {
    data: [{ categoryKey: "20260701", timestamp: 100, s0: 1, s1: 2 }, { categoryKey: "20260801", timestamp: 200, s0: 3, s1: 4 }],
    series: [
      { dataKey: "s0", measureKey: "rate", columnPath: [{ dimensionKey: "scenario_series", value: "FCT" }] },
      { dataKey: "s1", measureKey: "rate", columnPath: [{ dimensionKey: "scenario_series", value: "BASE" }] },
    ],
  };
  const resolved = resolveActualForecast(dataset, { chartType: "line", actualForecast: { enabled: true, splitMode: "series", showDivider: true, showPeriodLabels: true, forecastBackground: true, forecastLineStyle: "dashed" } as any }, model);
  assert.equal(resolved?.contexts["20260701"].s0.timeRole, "actual");
  assert.equal(resolved?.contexts["20260701"].s1.timeRole, "forecast");
  assert.equal(resolved?.splitDate, "");
});

test("normalizes aggregated Waterfall aliases and numeric runtime values", () => {
  const result: any = {
    columns: [{ name: "step_key" }, { name: "amount__SUM" }],
    rows: [
      { step_key: "revenue", "amount__SUM": 29740000000n },
      { step_key: "cost_of_revenue", "amount__SUM": "6140000000" },
    ],
  };
  assert.deepEqual(normalizeWaterfallQueryResult(result, "step_key", ["amount"]), [
    { step_key: "revenue", amount: 29740000000 },
    { step_key: "cost_of_revenue", amount: 6140000000 },
  ]);
});

test("keeps zero and SQL null distinct in Waterfall result normalization", () => {
  const result: any = {
    columns: [{ name: "step_key" }, { name: "amount__SUM" }],
    rows: [{ step_key: "zero", "amount__SUM": 0 }, { step_key: "missing", "amount__SUM": null }],
  };
  assert.deepEqual(normalizeWaterfallQueryResult(result, "step_key", ["amount"]), [
    { step_key: "zero", amount: 0 },
    { step_key: "missing", amount: null },
  ]);
});

test("prefers textual Arrow wrapper value over lossy valueOf", () => {
  const result: any = {
    columns: [{ name: "step_key" }, { name: "amount__SUM" }],
    rows: [{ step_key: "revenue", "amount__SUM": { valueOf: () => 0, toString: () => "29740000000" } }],
  };
  assert.deepEqual(normalizeWaterfallQueryResult(result, "step_key", ["amount"]), [
    { step_key: "revenue", amount: 29740000000 },
  ]);
});

test("prefers textual Arrow wrapper value over a zero internal value", () => {
  const result: any = {
    columns: [{ name: "step_key" }, { name: "amount__SUM" }],
    rows: [{ step_key: "revenue", "amount__SUM": { value: 0, toString: () => "29740000000", valueOf: () => 0 } }],
  };
  assert.deepEqual(normalizeWaterfallQueryResult(result, "step_key", ["amount"]), [
    { step_key: "revenue", amount: 29740000000 },
  ]);
});

test("decodes DuckDB decimal little-endian limb strings", () => {
  const result: any = {
    columns: [{ name: "step_key" }, { name: "amount__SUM" }],
    rows: [{ step_key: "revenue", "amount__SUM": "3970196224,6,0,0" }],
  };
  assert.deepEqual(normalizeWaterfallQueryResult(result, "step_key", ["amount"]), [
    { step_key: "revenue", amount: 29740000000 },
  ]);
});

test("Waterfall receives non-zero normalized P&L values", () => {
  const dataset: any = {
    id: "pnl_waterfall",
    label: "P&L",
    description: "",
    fields: [
      { id: "step_key", label: "Step", kind: "dimension", unit: "text" },
      { id: "amount", label: "Amount", kind: "measure", unit: "currency" },
    ],
    rows: [{ step_key: "revenue", amount: 29740000000 }],
  };
  const settings: any = {
    version: 2,
    dimensionKey: "step_key",
    availableMeasureKeys: ["amount"],
    defaultMeasureKey: "amount",
    items: [{ id: "revenue", memberKey: "revenue", displayLabel: "Revenue", measureKey: "amount", measureLabel: "Amount", action: "opening", order: 0, enabled: true }, { id: "gross", memberKey: "gross_profit", displayLabel: "Gross", measureKey: "amount", measureLabel: "Amount", action: "checkpoint", order: 1, enabled: true }],
    memberReference: { referenceId: null, attributeField: null, attributeValue: null },
    valueInterpretation: "absolute_by_operator",
    validateCheckpoints: false,
    toleranceType: "absolute",
    toleranceValue: 0,
    showConnectors: true,
    showValueLabels: true,
    showRunningBalance: false,
    showReconciliation: false,
    showReconciliationSummary: false,
    showWarnings: true,
    showDebug: false,
  };
  const result: any = { columns: [{ name: "step_key" }, { name: "amount__SUM" }], rows: [{ step_key: "revenue", "amount__SUM": "29740000000" }, { step_key: "gross_profit", "amount__SUM": "23600000000" }] };
  const rows = normalizeWaterfallQueryResult(result, "step_key", ["amount"]);
  const model = buildWaterfall(dataset, rows, settings).model;
  assert.equal(model?.items[0]?.displayValue, 29740000000);
});

test("normalizes low/high integer wrappers", () => {
  const result: any = {
    columns: [{ name: "step_key" }, { name: "amount__SUM" }],
    rows: [{ step_key: "revenue", "amount__SUM": { low: 123, high: 0, unsigned: true } }],
  };
  assert.equal(normalizeWaterfallQueryResult(result, "step_key", ["amount"])[0].amount, 123);
});

test("compiles a parameterized grouped analytical query", () => {
  const compiled = compileAnalyticalQuery({ datasetId: "credit_lifecycle", dimensions: [{ fieldId: "scenario" }], measures: [{ fieldId: "value", aggregation: "SUM" }], filters: [{ fieldId: "version", operator: "IN", values: ["FACT", "PLAN"] }], orderBy: [{ fieldId: "scenario", direction: "asc" }] }, "dataset_credit_lifecycle");
  assert.match(compiled.sql, /GROUP BY/);
  assert.match(compiled.sql, /IN \(\$1, \$2\)/);
  assert.deepEqual(compiled.parameters, ["FACT", "PLAN"]);
});

test("casts analytical measures and dimensions in DuckDB before transport", () => {
  const compiled = compileAnalyticalQuery({
    datasetId: "credit_lifecycle",
    dimensions: [{ fieldId: "fin_doc_num" }],
    measures: [
      { fieldId: "value", aggregation: "SUM" },
      { fieldId: "value", aggregation: "COUNT_DISTINCT" },
    ],
    filters: [],
  }, "dataset_credit_lifecycle");
  assert.match(compiled.sql, /CAST\("fin_doc_num" AS VARCHAR\)/);
  assert.match(compiled.sql, /CAST\(SUM\("value"\) AS DOUBLE\)/);
  assert.match(compiled.sql, /CAST\(COUNT\(DISTINCT "value"\) AS DOUBLE\)/);
});

test("quotes temporal cube fields whose physical names start with a digit", () => {
  const compiled = compileAnalyticalQuery({
    datasetId: "credit_lifecycle",
    dimensions: [{ fieldId: "0date" }],
    measures: [{ fieldId: "balance_at_date", aggregation: "SUM" }],
    filters: [],
  }, "dataset_credit_lifecycle");
  assert.match(compiled.sql, /"0date"/);
});

test("compiles a calendar-month hierarchy bucket", () => {
  const compiled = compileAnalyticalQuery({
    datasetId: "key_rate_scenarios",
    dimensions: [{ fieldId: "period", hierarchy: { hierarchyId: "YQHMD", levelKey: "QUARTER", granularity: "month" } }],
    measures: [{ fieldId: "key_rate", aggregation: "AVG" }],
    filters: [],
  }, "dataset_key_rate_scenarios");
  assert.match(compiled.sql, /CASE WHEN/);
  assert.match(compiled.sql, /GROUP BY 1/);
});

test("uses hierarchy aggregation and keeps the selected DAY bucket", () => {
  const dataset: any = {
    id: "key_rate_scenarios",
    fields: [{ id: "period", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQHMD", levels: [{ levelKey: "DAY" }] }] } }, { id: "loan_rate", semantic: { dataType: "number" } }],
  };
  const config: any = {
    chartType: "line",
    viewBy: ["period"],
    stackBy: [],
    viewByPresentation: { period: { mode: "hierarchy", activeHierarchyId: "YQHMD", selectedLevelKey: "DAY" } },
    metrics: [{ fieldId: "loan_rate", aggregation: "SUM", hierarchyAggregation: "AVG" }],
    filters: {},
  };
  const query = chartAnalyticalQuery(dataset, config, [], {});
  assert.equal(query.measures[0].aggregation, "AVG");
  const compiled = compileAnalyticalQuery(query, "dataset_key_rate_scenarios");
  assert.match(compiled.sql, /CAST\("period" AS VARCHAR\)/);
  assert.match(compiled.sql, /AVG\("loan_rate"\)/);
});

test("compiles a month bucket from a day-granularity date field", () => {
  const compiled = compileAnalyticalQuery({
    datasetId: "credit_lifecycle",
    dimensions: [{ fieldId: "0date", hierarchy: { hierarchyId: "YQMD", levelKey: "MONTH", granularity: "day" } }],
    measures: [{ fieldId: "loan_reserve", aggregation: "SUM" }],
    filters: [],
  }, "dataset_credit_lifecycle");
  assert.match(compiled.sql, /substr\(CAST\("0date" AS VARCHAR\), 1, 6\)/);
  assert.match(compiled.sql, /GROUP BY 1/);
});

test("column and combo queries preserve the selected date hierarchy", () => {
  const dataset: any = {
    id: "credit_lifecycle",
    fields: [{ id: "0date", kind: "dimension", semantic: { dataType: "date", granularity: "day", hierarchies: [{ hierarchyId: "YQMD", defaultLevelKey: "MONTH", levels: [{ key: "MONTH" }] }] } }, { id: "value", kind: "measure" }],
  };
  for (const chartType of ["column", "combo"] as const) {
    const query = chartAnalyticalQuery(dataset, {
      chartType,
      viewBy: ["0date"],
      viewByPresentation: { "0date": { mode: "hierarchy", activeHierarchyId: "YQMD", selectedLevelKey: "MONTH" } },
      stackBy: [],
      metrics: [{ fieldId: "value", aggregation: "SUM" }],
      filters: {},
      seriesSettings: {},
    } as any, [], {});
    assert.equal(query.dimensions[0].hierarchy?.levelKey, "MONTH");
    assert.equal(query.dimensions[0].hierarchy?.hierarchyId, "YQMD");
  }
});

test("maps a month page filter to a day field in another dataset", () => {
  const filters = queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [{ fieldId: "period", kind: "date-range", granularity: "month", source: { datasetId: "key_rate_scenarios", fieldId: "period", semanticRole: "calmonth", dataType: "date", temporalKey: "calendar", granularity: "month" }, defaultValue: { from: "202604", to: "202606" } }], {}, {
    id: "credit_lifecycle",
    fields: [{ id: "0date", semantic: { dataType: "date", role: "date", granularity: "day", temporalKey: "calendar" } }],
  } as any);
  assert.deepEqual(filters, [{ fieldId: "0date", operator: "BETWEEN", from: "20260401", to: "20260630" }]);
});

test("maps a day page filter to a month field by overlapping months", () => {
  const filters = queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [{ fieldId: "0date", kind: "date-range", granularity: "day", source: { datasetId: "credit_lifecycle", fieldId: "0date", semanticRole: "date", dataType: "date", temporalKey: "calendar", granularity: "day" }, defaultValue: { from: "20260715", to: "20260803" } }], { "0date": { from: "20260715", to: "20260803" } }, {
    id: "key_rate_scenarios",
    fields: [{ id: "period", semantic: { dataType: "date", role: "calmonth", granularity: "month", temporalKey: "calendar" } }],
  } as any);
  assert.deepEqual(filters, [{ fieldId: "period", operator: "BETWEEN", from: "202607", to: "202608" }]);
});

test("blocks an incomplete date range before SQL receives an empty parameter", () => {
  const dataset: any = {
    id: "key_rate_scenarios",
    fields: [{ id: "period", label: "Период", semantic: { dataType: "date", inputFormats: ["YYYYMM"], outputFormat: "YYYYMM" } }],
  };
  assert.throws(() => queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [{ fieldId: "period", kind: "date-range", defaultValue: { from: "", to: "" } }], {}, dataset), /Заполните обе границы/);
  assert.throws(() => queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [{ fieldId: "period", kind: "date-range", defaultValue: { from: "202607", to: "" } }], { period: { from: "202607", to: "" } }, dataset), /Заполните обе границы/);
});

test("accepts a complete canonical month date range", () => {
  const dataset: any = {
    id: "key_rate_scenarios",
    fields: [{ id: "period", label: "Период", semantic: { dataType: "date", inputFormats: ["YYYYMM"], outputFormat: "YYYYMM" } }],
  };
  const filters = queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [{ fieldId: "period", kind: "date-range", defaultValue: { from: "", to: "" } }], { period: { from: "202607", to: "202612" } }, dataset);
  assert.deepEqual(filters, [{ fieldId: "period", operator: "BETWEEN", from: "202607", to: "202612" }]);
});

test("dashboard splitDate never becomes a data filter", () => {
  const config: any = { filters: { splitDate: ["2026-07-01"], "split-date": ["2026-07-01"] }, metrics: [], viewBy: [], stackBy: [] };
  const dataset: any = { id: "key_rate_scenarios", fields: [{ id: "scenario" }] };
  const filters = queryFilters(config, [{ fieldId: "splitDate", kind: "categorical", defaultValue: ["2026-07-01"] }, { fieldId: "scenario", kind: "categorical", defaultValue: ["BASE"] }], {}, dataset);
  assert.deepEqual(filters, [{ fieldId: "scenario", operator: "IN", values: ["BASE"] }]);
});

test("a period-role dataset does not inherit a calmonth filter regardless of dataset id", () => {
  const dataset: any = {
    id: "unrelated_dataset",
    fields: [
      { id: "period", semantic: { dataType: "date", role: "period", granularity: "month", temporalKey: "calendar" } },
      { id: "scenario" },
    ],
  };
  const filters = queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [
    { fieldId: "fin_version", kind: "categorical", defaultValue: ["FRC"] },
    { fieldId: "fin_scenario", kind: "categorical", defaultValue: ["BASE"] },
    { fieldId: "0calmonth", kind: "date-range", granularity: "month", source: { datasetId: "writecube_fin_reports", fieldId: "0calmonth", semanticRole: "calmonth", dataType: "date", temporalKey: "calendar", granularity: "month" }, defaultValue: { from: "202607", to: "202607" } },
  ], {}, dataset);
  assert.deepEqual(filters, []);
});

test("a period-role dataset accepts its own period filter", () => {
  const dataset: any = {
    id: "unrelated_dataset",
    fields: [{ id: "period", semantic: { dataType: "date", role: "period", granularity: "month", temporalKey: "calendar" } }],
  };
  const filters = queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [
    { fieldId: "period", kind: "date-range", granularity: "month", defaultValue: { from: "202601", to: "202601" } },
  ], {}, dataset);
  assert.deepEqual(filters, [{ fieldId: "period", operator: "BETWEEN", from: "202601", to: "202601" }]);
});

test("P&L demo cube accepts its own period filter", () => {
  const dataset: any = {
    id: "pnl_waterfall",
    fields: [{ id: "period", semantic: { dataType: "date", granularity: "month", temporalKey: "calendar" } }],
  };
  const filters = queryFilters({ filters: {}, metrics: [], viewBy: [], stackBy: [] } as any, [
    { fieldId: "period", kind: "date-range", granularity: "month", defaultValue: { from: "202601", to: "202601" } },
  ], {}, dataset);
  assert.deepEqual(filters, [{ fieldId: "period", operator: "BETWEEN", from: "202601", to: "202601" }]);
});

test("pivot keeps metrics visible when Stack by is empty", () => {
  const config: any = { rows: ["contract"], columns: [], expansion: { rows: ["root", "*"], columns: ["root", "*"] }, aggregations: [{ id: "value-sum", measureField: "value", operation: "SUM", label: "Значение", visible: true }] };
  const result: any = { rows: [{ contract: "A", "value__SUM": 10 }, { contract: "B", "value__SUM": 20 }], diagnostics: [] };
  const model = pivotModelFromQueryResult(config, result, { rows: [{ "value__SUM": 30 }], diagnostics: [] } as any);
  assert.deepEqual(model.columns.map((column) => column.id), ["__all__"]);
  assert.deepEqual(model.cells.filter((cell) => cell.aggregationId === "value-sum").map((cell) => cell.value), [30, 10, 20]);
});

test("pivot query preserves multiple Stack by dimensions", () => {
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "contract", kind: "dimension" }, { id: "scenario", kind: "dimension" }, { id: "version", kind: "dimension" }, { id: "value", kind: "measure" }] };
  const config: any = { rows: ["contract"], columns: ["scenario", "version"], aggregations: [{ id: "value-sum", measureField: "value", operation: "SUM", visible: true }], filters: {}, expansion: { rows: ["root"], columns: ["root"] } };
  const plan = planPivotQueries(dataset, config, [], {}).scopes[0].query;
  assert.deepEqual(plan.dimensions.map((dimension) => dimension.fieldId), ["contract", "scenario", "version"]);
});

test("pivot total query does not order by row dimensions removed from GROUP BY", () => {
  const detail: any = { datasetId: "credit_lifecycle", dimensions: [{ fieldId: "fin_doc_num" }], measures: [{ fieldId: "value", aggregation: "SUM" }], filters: [], orderBy: [{ fieldId: "fin_doc_num", direction: "asc" as const }] };
  const total = { ...detail, dimensions: [], orderBy: undefined };
  const compiled = compileAnalyticalQuery(total, "dataset_credit_lifecycle");
  assert.doesNotMatch(compiled.sql, /ORDER BY/);
  assert.doesNotMatch(compiled.sql, /fin_doc_num/);
});

test("temporal hierarchy uses canonical date strings without numeric casts", () => {
  const compiled = compileAnalyticalQuery({
    datasetId: "key_rate_scenarios",
    dimensions: [{ fieldId: "period", hierarchy: { hierarchyId: "YQHMD", levelKey: "QUARTER", granularity: "month" } }],
    measures: [{ fieldId: "key_rate", aggregation: "AVG" }],
    filters: [],
  }, "dataset_key_rate_scenarios");
  assert.match(compiled.sql, /substr/);
  assert.doesNotMatch(compiled.sql, /TRY_CAST|INT64/);
});

test("validates and normalizes temporal input formats once at dataset load", () => {
  const dataset: any = { id: "key_rate_actual", fields: [{ id: "0date", semantic: { dataType: "date", inputFormats: ["YYYY-MM-DD"], outputFormat: "YYYYMMDD" } }] };
  const definition: any = { datasetId: "key_rate_actual", source: { type: "csv", url: "/data/test.csv", header: true } };
  const normalized = validateAndNormalizeCsv("0date\n2026-07-15\n", dataset, definition);
  assert.match(normalized, /20260715/);
  assert.throws(() => validateAndNormalizeCsv("0date\n2026-99-15\n", dataset, definition), DatasetFormatValidationError);
});

test("normalizes a month-start YYYYMMDD source to canonical YYYYMM", () => {
  const dataset: any = {
    id: "writecube_fin_reports",
    fields: [{ id: "0calmonth", semantic: { dataType: "date", granularity: "month", inputFormats: ["YYYYMMDD"], outputFormat: "YYYYMM" } }],
  };
  const definition: any = { datasetId: "writecube_fin_reports", source: { type: "csv", url: "/data/WriteCube-95_fin_reports.csv", header: true } };
  const normalized = validateAndNormalizeCsv("0calmonth\n20260701\n20260801\n", dataset, definition);
  assert.match(normalized, /202607/);
  assert.match(normalized, /202608/);
  assert.doesNotMatch(normalized, /20260701|20260801/);
  assert.throws(() => validateAndNormalizeCsv("0calmonth\n20260230\n", dataset, definition), DatasetFormatValidationError);
});

test("decodes a month bucket produced from a day-granularity 0date field", () => {
  const dataset: any = {
    id: "credit_lifecycle",
    label: "Credit lifecycle",
    description: "",
    fields: [{
      id: "0date",
      label: "Date",
      kind: "dimension",
      unit: "date",
      semantic: {
        businessObject: "credit_lifecycle",
        role: "date",
        dataType: "date",
        granularity: "day",
        hierarchies: [{
          hierarchyId: "YQMD",
          hierarchyName: "YQMD",
          displayLabel: "Year → Quarter → Month → Day",
          defaultLevelKey: "MONTH",
          leafLevelKey: "DAY",
          supportsDrill: true,
          levels: [],
        }],
      },
    }, {
      id: "loan_reserve",
      label: "Reserve",
      kind: "measure",
      unit: "currency",
    }],
  };
  const config: any = {
    viewBy: ["0date"],
    stackBy: [],
    metrics: [{ fieldId: "loan_reserve", aggregation: "SUM" }],
    seriesSettings: {},
    viewByPresentation: {
      "0date": { mode: "hierarchy", activeHierarchyId: "YQMD", selectedLevelKey: "MONTH" },
    },
  };
  const model = chartModelFromQueryResult(dataset, config, {
    columns: [],
    rows: [
      { "0date": "202601", loan_reserve__SUM: 10 },
      { "0date": "202602", loan_reserve__SUM: 20 },
    ],
    rowCount: 2,
    diagnostics: [],
    execution: { queryId: "q", durationMs: 1, datasetId: "credit_lifecycle" },
  });
  assert.deepEqual(model.categories, ["202601", "202602"]);
  assert.equal(model.data[0].timestamp, Date.UTC(2026, 0, 1));
  assert.equal(model.data[1].timestamp, Date.UTC(2026, 1, 1));
  assert.ok(model.data.every((point) => Number.isFinite(point.timestamp)));
});

test("empty IN and BETWEEN filters have explicit neutral semantics", () => {
  const inQuery = compileAnalyticalQuery({ datasetId: "credit_lifecycle", dimensions: [], measures: [{ fieldId: "value", aggregation: "COUNT" }], filters: [{ fieldId: "scenario", operator: "IN", values: [] }] }, "dataset_credit_lifecycle");
  assert.doesNotMatch(inQuery.sql, /WHERE/);
  const rangeQuery = compileAnalyticalQuery({ datasetId: "credit_lifecycle", dimensions: [], measures: [{ fieldId: "value", aggregation: "COUNT" }], filters: [{ fieldId: "date", operator: "BETWEEN" }] }, "dataset_credit_lifecycle");
  assert.doesNotMatch(rangeQuery.sql, /WHERE/);
});

test("query controller caches completed results and ignores stale requests", async () => {
  const calls: string[] = [];
  const runtime = {
    initialize: async () => {},
    dispose: async () => {},
    distinct: async () => [],
    execute: async (query: any, signal?: AbortSignal) => {
      calls.push(query.datasetId);
      await new Promise((resolve) => setTimeout(resolve, query.datasetId === "slow" ? 15 : 1));
      if (signal?.aborted) throw new DOMException("Query cancelled", "AbortError");
      return { columns: [], rows: [{ value: query.datasetId }], rowCount: 1, diagnostics: [], execution: { queryId: query.datasetId, durationMs: 1, datasetId: query.datasetId } };
    },
  };
  const controller = new QueryController(runtime);
  const slow = controller.execute({ datasetId: "slow" as any, dimensions: [], measures: [{ fieldId: "value", aggregation: "COUNT" }], filters: [] });
  const fast = controller.execute({ datasetId: "fast" as any, dimensions: [], measures: [{ fieldId: "value", aggregation: "COUNT" }], filters: [] });
  const result = await fast;
  await slow;
  assert.equal(result.result?.rows[0]?.value, "fast");
  const cached = await controller.execute({ datasetId: "fast" as any, dimensions: [], measures: [{ fieldId: "value", aggregation: "COUNT" }], filters: [] });
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(calls, ["slow", "fast"]);
});

test("dataset metadata service delegates distinct and member statistics to analytical runtime", async () => {
  const calls: string[] = [];
  const registry = new DatasetRegistry();
  registry.setState("credit_lifecycle" as any, { definition: { datasetId: "credit_lifecycle" as any, source: { type: "csv", url: "/data/test.csv", header: true } }, tableName: "dataset_credit_lifecycle", state: "ready" });
  const runtime = {
    initialize: async () => {},
    dispose: async () => {},
    registerDataset: async () => {},
    distinct: async (query: any) => { calls.push(`distinct:${query.fieldId}`); return ["A", "B"]; },
    execute: async () => ({ columns: [], rows: [{ category: "A", amount__SUM: 12 }], rowCount: 1, diagnostics: [], execution: { queryId: "q", durationMs: 1, datasetId: "credit_lifecycle" as any } }),
  };
  const service = new DatasetMetadataService(runtime, registry, {});
  assert.deepEqual(await service.distinct("credit_lifecycle" as any, "category"), ["A", "B"]);
  const stats = await service.memberStats("credit_lifecycle" as any, "category", ["amount"]);
  assert.deepEqual(stats, [{ member: "A", values: { amount: 12 } }]);
  assert.deepEqual(calls, ["distinct:category"]);
});

test("pivot planner creates isolated parameterized root and branch scopes", () => {
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "region", kind: "dimension" }, { id: "product", kind: "dimension" }, { id: "scenario", kind: "dimension" }, { id: "value", kind: "measure" }] };
  const config: any = { datasetId: dataset.id, rows: ["region", "product"], columns: ["scenario"], aggregations: [{ id: "value-sum", measureField: "value", operation: "SUM", visible: true }], filters: {} };
  const root = planPivotQueries(dataset, config, [], {}, {});
  const branch = planPivotQueries(dataset, config, [], {}, { rows: ["North"] });
  assert.equal(root.scopes[0].key, "pivot:credit_lifecycle:root:root");
  assert.equal(branch.scopes[0].key, "pivot:credit_lifecycle:rows:North");
  assert.deepEqual(branch.scopes[0].query.filters.at(-1), { fieldId: "region", operator: "EQ", value: "North" });
  assert.notDeepEqual(root.scopes[0].query.filters, branch.scopes[0].query.filters);
});

test("pivot planner creates row subtotal scopes with matching GROUP BY dimensions", () => {
  const dataset: any = { id: "credit_lifecycle", fields: [{ id: "department", kind: "dimension" }, { id: "contract", kind: "dimension" }, { id: "scenario", kind: "dimension" }, { id: "value", kind: "measure" }] };
  const config: any = { datasetId: dataset.id, rows: ["department", "contract"], columns: ["scenario"], aggregations: [{ id: "value-avg", measureField: "value", operation: "AVG", visible: true }], filters: {} };
  const plan = planPivotQueries(dataset, config, [], {});
  assert.equal(plan.subtotalScopes.length, 1);
  assert.deepEqual(plan.subtotalScopes[0].query.dimensions.map((dimension) => dimension.fieldId), ["department", "scenario"]);
  assert.deepEqual(plan.subtotalScopes[0].query.orderBy?.map((order) => order.fieldId), ["department"]);
  assert.deepEqual(plan.totalScope.query.dimensions.map((dimension) => dimension.fieldId), ["scenario"]);
  assert.deepEqual(plan.totalScope.query.orderBy?.map((order) => order.fieldId), ["scenario"]);
});

test("pivot uses DuckDB subtotal result for AVG instead of averaging visible detail cells", () => {
  const config: any = { rows: ["department", "contract"], columns: [], expansion: { rows: ["root", "*"], columns: ["root", "*"] }, aggregations: [{ id: "value-avg", measureField: "value", operation: "AVG", label: "Среднее", visible: true }] };
  const detail: any = { rows: [
    { department: "A", contract: "A1", "value__AVG": 10 },
    { department: "A", contract: "A2", "value__AVG": 30 },
    { department: "B", contract: "B1", "value__AVG": 50 },
  ], diagnostics: [] };
  const subtotal: any = { rows: [
    // Weighted result calculated from raw rows by DuckDB, not from the two displayed averages.
    { department: "A", "value__AVG": 18 },
    { department: "B", "value__AVG": 50 },
  ], diagnostics: [] };
  const model = pivotModelFromQueryResults(config, { detail, total: { rows: [{ "value__AVG": 28.6666666667 }], diagnostics: [] } as any, subtotals: [{ rowDepth: 1, result: subtotal }] });
  const aSubtotal = model.cells.find((cell) => cell.rowId === "A" && cell.aggregationId === "value-avg");
  assert.equal(aSubtotal?.value, 18);
});
