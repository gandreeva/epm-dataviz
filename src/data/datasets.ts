import Papa from "papaparse";
import lifecycleRaw from "../../data/Выгрузка и ABC-системы на дату.csv?raw";
import contractRaw from "../../data/Условия по кредитным линиям.csv?raw";
import macroRaw from "../../data/Макроусловия по типу кредитного продукта.csv?raw";
import forecastRateRaw from "../../data/Прогноз ключевой ставки.csv?raw";
import actualRateRaw from "../../data/Фактическая ключевая ставка.csv?raw";
import eventCommentsRaw from "../../data/Комментарии к событиям.csv?raw";
import thresholdRaw from "../../data/threshold_comparison_epm.csv?raw";
import rollingForecastRaw from "../../data/rolling_forecast_key_rate.csv?raw";
import multiMappingDemoRaw from "../../data/multi_mapping_demo.csv?raw";
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
import { datasetDefinitionsFromCatalog } from "../semantic/businessCatalog";
import { composeDatasetRows } from "./composedDataset";
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
    delimiter: raw.slice(0, raw.indexOf("\n") >= 0 ? raw.indexOf("\n") : raw.length).includes(";") ? ";" : ",",
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
  multiMappingDemo = parse(multiMappingDemoRaw, "multi_mapping_demo"),
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
const sourceRows: Record<string, DataRow[]> = {
  key_rate_actual: actual,
  key_rate_forecast: forecast,
  credit_lifecycle: lifecycle,
  contract_terms: contracts,
  product_macro: macro,
  rolling_key_rate: rolling,
  multi_mapping_demo: multiMappingDemo,
  pnl_waterfall: waterfall,
  writecube_fin_reports: writeCube,
  threshold_finance: threshold,
};
const composedRows = new Map(
  datasetDefinitionsFromCatalog()
    .filter((definition): definition is Extract<typeof definition, { source: { type: "composed" } }> => definition.source.type === "composed")
    .map((definition) => [definition.datasetId, composeDatasetRows(definition, sourceRows)]),
);

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
  key_rate_scenarios: makeDataset("key_rate_scenarios", composedRows.get("key_rate_scenarios") || []),
  product_macro: makeDataset("product_macro", macro),
  financial_reporting: makeDataset("financial_reporting", composedRows.get("financial_reporting") || []),
  threshold_finance: makeDataset("threshold_finance", threshold),
  rolling_key_rate: makeDataset("rolling_key_rate", rolling),
  multi_mapping_demo: makeDataset("multi_mapping_demo", multiMappingDemo),
  pnl_waterfall: makeDataset("pnl_waterfall", waterfall),
  writecube_fin_reports: makeDataset("writecube_fin_reports", writeCube),
};
export const datasetList = Object.values(DATASETS);
