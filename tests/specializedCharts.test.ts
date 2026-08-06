import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../src/config/presets";
import type { Dataset, DatasetId } from "../src/types";
import {
  buildThresholdComparison,
  validateThresholdZones,
} from "../src/query/specializedCharts";
import { runQuery, validateConfig } from "../src/query/queryEngine";

const thresholdDataset: Dataset = {
  id: "threshold_finance",
  label: "Threshold",
  description: "",
  fields: [
    { id: "period", label: "Период", kind: "dimension", unit: "date" },
    { id: "actual_value", label: "Расходы", kind: "measure", unit: "currency" },
    { id: "reference_value", label: "План", kind: "measure", unit: "currency" },
  ],
  rows: [
    {
      period: "202604",
      actual_value: 138_000_000,
      reference_value: 115_000_000,
    },
  ],
};
const rollingDataset: Dataset = {
  id: "rolling_key_rate",
  label: "Rolling",
  description: "",
  fields: [
    {
      id: "0date",
      label: "Observation",
      kind: "dimension",
      unit: "date",
    },
    {
      id: "0calmonth",
      label: "Target",
      kind: "dimension",
      unit: "date",
    },
    { id: "key_rate", label: "Ключевая ставка", kind: "measure", unit: "percent" },
    { id: "low_rate", label: "Lower", kind: "measure", unit: "percent" },
    { id: "upper_bound", label: "Upper", kind: "measure", unit: "percent" },
    {
      id: "fin_version",
      label: "Version",
      kind: "dimension",
      unit: "text",
    },
  ],
  rows: [
    {
      "0date": "20250501",
      key_rate: 0.21,
      "0calmonth": "202605",
      low_rate: 0.135,
      upper_bound: 0.17,
      fin_version: "FRC",
    },
    {
      "0date": "20250901",
      key_rate: 0.18,
      "0calmonth": "202609",
      low_rate: 0.12,
      upper_bound: 0.16,
      fin_version: "FRC",
    },
  ],
};
const waterfallDataset: Dataset = {
  id: "pnl_waterfall",
  label: "P&L",
  description: "",
  fields: [
    { id: "period", label: "Период", kind: "dimension", unit: "date" },
    { id: "scenario", label: "Сценарий", kind: "dimension", unit: "text" },
    { id: "step_key", label: "Шаг", kind: "dimension", unit: "text" },
    { id: "amount", label: "Сумма", kind: "measure", unit: "currency" },
  ],
  rows: [
    {
      period: "202601",
      scenario: "FCT",
      step_key: "revenue",
      amount: 29_740_000_000,
    },
    {
      period: "202601",
      scenario: "FCT",
      step_key: "cost_of_revenue",
      amount: 6_140_000_000,
    },
    {
      period: "202601",
      scenario: "FCT",
      step_key: "gross_profit",
      amount: 23_600_000_000,
    },
    {
      period: "202601",
      scenario: "FCT",
      step_key: "operating_expenses",
      amount: 7_000_000_000,
    },
    {
      period: "202601",
      scenario: "FCT",
      step_key: "ebitda",
      amount: 16_600_000_000,
    },
    { period: "202601", scenario: "FCT", step_key: "depreciation", amount: 2_200_000_000 },
    { period: "202601", scenario: "FCT", step_key: "ebit", amount: 14_400_000_000 },
    { period: "202601", scenario: "FCT", step_key: "interest", amount: 1_200_000_000 },
    { period: "202601", scenario: "FCT", step_key: "tax", amount: 2_600_000_000 },
    {
      period: "202601",
      scenario: "FCT",
      step_key: "net_income",
      amount: 10_600_000_000,
    },
  ],
};
const datasets: Record<DatasetId, Dataset> = {
  threshold_finance: thresholdDataset,
  rolling_key_rate: rollingDataset,
  pnl_waterfall: waterfallDataset,
} as Record<DatasetId, Dataset>;

const preset = (id: string) => {
  const found = PRESETS.find((item) => item.id === id);
  assert.ok(found, `Preset ${id} must exist`);
  return found;
};

test("threshold comparison applies lower-is-better adverse deviation and half-open zones", () => {
  const page = preset("threshold");
  const model = runQuery(
    thresholdDataset,
    page.config,
    Object.fromEntries(
      (page.pageFilters || []).map((filter) => [
        filter.fieldId,
        filter.defaultValue,
      ]),
    ),
  );
  assert.equal(model.diagnostics?.length, 0);
  assert.equal(model.thresholdComparison?.actualValue, 138_000_000);
  assert.equal(model.thresholdComparison?.referenceValue, 115_000_000);
  assert.equal(model.thresholdComparison?.currentZoneKey, "warning");
  assert.ok((model.thresholdComparison?.percentageDeviation ?? 0) > 16);
});

test("threshold comparison supports manual values and handles a zero percentage base", () => {
  const result = buildThresholdComparison(thresholdDataset, [], {
    ...preset("threshold").config.thresholdComparison!,
    actual: { source: "manual", manualValue: 0, aggregation: "SUM" },
    reference: { source: "manual", manualValue: 10, aggregation: "SUM" },
    percentageBase: "actual",
  });
  assert.equal(result.model?.percentageDeviation, null);
  assert.ok(result.warnings.some((warning) => warning.includes("denominator")));
});

test("threshold zones reject overlaps", () => {
  assert.ok(
    validateThresholdZones([
      {
        key: "a",
        label: "A",
        from: null,
        to: 10,
        semantic: "good",
        displayColor: "green",
      },
      {
        key: "b",
        label: "B",
        from: 9,
        to: null,
        semantic: "bad",
        displayColor: "red",
      },
    ]).some((error) => error.includes("пересекаются")),
  );
});

test("rolling forecast selects latest and explicit vintages", () => {
  const page = preset("rolling-forecast");
  const latest = runQuery(rollingDataset, page.config);
  assert.equal(latest.diagnostics?.length, 0);
  assert.equal(latest.rollingForecast?.selected.observationDate, "20250901");
  assert.equal(latest.rollingForecast?.selected.targetDate, "202609");
  const selected = runQuery(rollingDataset, {
    ...page.config,
    rollingForecast: {
      ...page.config.rollingForecast!,
      observationDateMode: "selected",
      selectedObservationDate: "20250501",
    },
  });
  assert.equal(selected.rollingForecast?.selected.observationDate, "20250501");
  assert.equal(
    selected.rollingForecast?.selected.forecastVersion,
    "FRC",
  );
});

test("rolling forecast reports a missing selected vintage", () => {
  const page = preset("rolling-forecast");
  const model = runQuery(rollingDataset, {
    ...page.config,
    rollingForecast: {
      ...page.config.rollingForecast!,
      observationDateMode: "selected",
      selectedObservationDate: "19990101",
    },
  });
  assert.ok(model.diagnostics?.some((error) => error.includes("отсутствует")));
});

test("rolling forecast reports an invalid bound dataset instead of falling back silently", () => {
  const page = preset("rolling-forecast");
  const model = runQuery(
    rollingDataset,
    page.config,
    {},
    { splitDate: null },
    { rolling_key_rate: rollingDataset },
  );
  assert.ok(model.diagnostics?.some((error) => error.includes("Forecast dataset")));
  assert.equal(model.rollingForecast, undefined);
});

test("P&L Bridge derives roles from config and reconciles to net income", () => {
  const page = preset("pnl-waterfall");
  const model = runQuery(
    waterfallDataset,
    page.config,
    Object.fromEntries(
      (page.pageFilters || []).map((filter) => [
        filter.fieldId,
        filter.defaultValue,
      ]),
    ),
  );
  assert.equal(model.diagnostics?.length, 0);
  assert.equal(model.warnings?.length, 0);
  assert.equal(model.waterfall?.items[0].runningAfter, 29_740_000_000);
  assert.equal(
    model.waterfall?.items.at(-1)?.runningAfter,
    10_600_000_000,
  );
  assert.equal(
    model.waterfall?.items.find((item) => item.memberKey === "gross_profit")
      ?.difference,
    0,
  );
  assert.equal(model.waterfall?.items.at(-1)?.isTerminalCheckpoint, true);
  assert.equal(
    model.waterfall?.items.find((item) => item.memberKey === "cost_of_revenue")
      ?.signedValue,
    -6_140_000_000,
  );
});

test("specialized chart validation accepts complete presets", () => {
  for (const id of ["threshold", "rolling-forecast", "pnl-waterfall"]) {
    const page = preset(id);
    assert.deepEqual(
      validateConfig(datasets[page.config.datasetId], page.config),
      [],
    );
  }
});
