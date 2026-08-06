import Papa from "papaparse";
import lifecycleRaw from "../../data/Выгрузка и ABC-системы на дату.csv?raw";
import contractRaw from "../../data/Условия по кредитным линиям.csv?raw";
import macroRaw from "../../data/Макроусловия по типу кредитного продукта.csv?raw";
import forecastRateRaw from "../../data/Прогноз ключевой ставки.csv?raw";
import actualRateRaw from "../../data/Фактическая ключевая ставка.csv?raw";
import eventCommentsRaw from "../../data/Комментарии к событиям.csv?raw";
import thresholdRaw from "../../data/threshold_comparison_epm.csv?raw";
import rollingForecastRaw from "../../data/rolling_forecast_key_rate.csv?raw";
import pnlWaterfallRaw from "../../data/pnl_waterfall.csv?raw";
import writeCubeRaw from "../../data/WriteCube-95_fin_reports.csv?raw";
import finAccountReferenceRaw from "../../data/reference_store/sandbox/fin_acc.csv?raw";
import type {
  DataRow,
  Dataset,
  DatasetId,
  EventComment,
  FieldMeta,
} from "../types";
import {
  datasetPresentation,
  eventProjection,
  fieldSemantic,
  referenceMeta,
} from "../semantic/businessCatalog";

const fieldsFrom = (datasetId: DatasetId, rows: DataRow[]): FieldMeta[] =>
  Object.keys(rows[0] || {}).map((id) => {
    const resolved = fieldSemantic(datasetId, id);
    return {
      id,
      label: resolved.label,
      kind: resolved.kind,
      unit: resolved.unit,
      aggregations: resolved.aggregations,
      semantic: resolved.semantic,
      semanticDiagnostic: resolved.diagnostic,
    };
  });
const parse = (raw: string, datasetId: DatasetId): DataRow[] =>
  Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    transform: (v, k) =>
      fieldSemantic(datasetId, String(k)).semantic?.dataType === "number"
        ? v === ""
          ? null
          : Number(v)
        : v,
  }).data;
const parseWriteCube = (raw: string): DataRow[] =>
  Papa.parse<Record<string, string>>(raw, {
    header: true,
    delimiter: ";",
    skipEmptyLines: true,
    transform: (value, key) => key === "value" ? (value === "" ? null : Number(String(value).replace(",", "."))) : value,
  }).data;
const actual = parse(actualRateRaw, "key_rate_actual"),
  forecast = parse(forecastRateRaw, "key_rate_forecast"),
  lifecycle = parse(lifecycleRaw, "credit_lifecycle"),
  contracts = parse(contractRaw, "contract_terms"),
  macro = parse(macroRaw, "product_macro"),
  threshold = parse(thresholdRaw, "threshold_finance"),
  rolling = parse(rollingForecastRaw, "rolling_key_rate"),
  waterfall = parse(pnlWaterfallRaw, "pnl_waterfall");
const writeCube = parseWriteCube(writeCubeRaw);
const referenceRaw: Record<string, string> = { fin_acc: finAccountReferenceRaw };
export const referenceRows = (referenceId: string): Record<string, string>[] => {
  const raw = referenceRaw[referenceId];
  const meta = referenceMeta(referenceId);
  if (!raw || !meta) return [];
  return Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true }).data;
};
export const referenceMember = (referenceId: string, key: string) => {
  const meta = referenceMeta(referenceId), row = referenceRows(referenceId).find((item) => String(item[meta?.key || ""] ?? "") === key);
  if (!meta || !row) return undefined;
  return { key, text: String(row[meta.fields?.text?.column || ""] ?? key), accType: String(row[meta.fields?.acc_type?.column || ""] ?? "") };
};
export const FIN_ACCOUNT_DISPLAY: Record<string, { text: string; accType: string }> = Object.fromEntries(
  referenceRows("fin_acc").map((row) => {
    const key = String(row[referenceMeta("fin_acc")?.key || ""] ?? "");
    return [key, referenceMember("fin_acc", key) || { text: key, accType: "" }];
  }).filter(([key]) => Boolean(key)),
);
export const FIN_ACCOUNT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(FIN_ACCOUNT_DISPLAY).map(([key, value]) => [key, value.text]),
);
const eventComments = Papa.parse<EventComment>(eventCommentsRaw, {
  header: true,
  skipEmptyLines: true,
}).data;
const month = (value: unknown) => String(value ?? "").slice(0, 6);

const scenarioRates: DataRow[] = [
  ...actual.map((r) => ({
    period: month(r["0date"]),
    scenario_series: "FCT",
    key_rate: r.key_rate,
    loan_rate: r.loan_rate,
  })),
  ...forecast.map((r) => ({
    period: String(r["0calmonth"]),
    scenario_series: String(r.fin_scenario),
    key_rate: r.key_rate,
    loan_rate: r.loan_rate,
  })),
];

const latestByMonth = new Map<string, DataRow>();
lifecycle.forEach((r) => {
  const k = [
    r.fin_version,
    r.fin_scenario,
    r.fin_doc_num,
    month(r["0date"]),
  ].join("|");
  const prev = latestByMonth.get(k);
  if (!prev || String(prev["0date"]) < String(r["0date"]))
    latestByMonth.set(k, r);
});
const reporting: DataRow[] = [];
latestByMonth.forEach((r) => {
  const base = {
    fin_version: r.fin_version,
    fin_scenario: r.fin_scenario,
    fin_doc_num: r.fin_doc_num,
    period: month(r["0date"]),
  };
  const entries: [string, number][] = [
    ["A3", Number(r.ifrs_scope || 0)],
    ["A3.1", -Number(r.loan_reserve || 0)],
    ["L12", -Number(r.norev_cl_reserve || 0)],
    ["PL1", Number(r.interest_accrued || 0)],
    ["PL4", -Number(r.change_loan_reserve || 0)],
    ["PL13", -Number(r.change_norev_cl_reserve || 0)],
  ];
  entries.forEach(([fin_acc, value]) =>
    reporting.push({ ...base, fin_acc, value }),
  );
});

const makeDataset = (id: DatasetId, rows: DataRow[]): Dataset => ({
  id,
  ...datasetPresentation(id),
  fields: fieldsFrom(id, rows),
  rows,
  eventProjection: eventProjection(id),
  eventComments: id === "credit_lifecycle" ? eventComments : undefined,
});
export const DATASETS: Record<DatasetId, Dataset> = {
  credit_lifecycle: makeDataset("credit_lifecycle", lifecycle),
  contract_terms: makeDataset("contract_terms", contracts),
  key_rate_actual: makeDataset("key_rate_actual", actual),
  key_rate_forecast: makeDataset("key_rate_forecast", forecast),
  key_rate_scenarios: makeDataset("key_rate_scenarios", scenarioRates),
  product_macro: makeDataset("product_macro", macro),
  financial_reporting: makeDataset("financial_reporting", reporting),
  threshold_finance: makeDataset("threshold_finance", threshold),
  rolling_key_rate: makeDataset("rolling_key_rate", rolling),
  pnl_waterfall: makeDataset("pnl_waterfall", waterfall),
  writecube_fin_reports: makeDataset("writecube_fin_reports", writeCube),
};
export const datasetList = Object.values(DATASETS);
