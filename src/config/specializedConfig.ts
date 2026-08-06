import type {
  ChartConfig,
  ChartType,
  Dataset,
  FieldMeta,
  RollingForecastBindings,
} from "../types";
import {
  DEFAULT_ROLLING_SETTINGS,
  DEFAULT_THRESHOLD_SETTINGS,
  DEFAULT_WATERFALL_SETTINGS,
} from "../query/specializedCharts";

export type SpecializedBucketId =
  | "threshold.actual"
  | "threshold.reference"
  | `rolling.${keyof RollingForecastBindings}`;

const thresholdDefaults = () => structuredClone(DEFAULT_THRESHOLD_SETTINGS);
const rollingDefaults = () => structuredClone(DEFAULT_ROLLING_SETTINGS);
const waterfallDefaults = () => structuredClone(DEFAULT_WATERFALL_SETTINGS);

export function ensureSpecializedConfig(
  config: ChartConfig,
  chartType: ChartType,
): ChartConfig {
  if (chartType === "threshold-comparison")
    return {
      ...config,
      chartType,
      thresholdComparison: config.thresholdComparison || thresholdDefaults(),
    };
  if (chartType === "rolling-forecast")
    return {
      ...config,
      chartType,
      rollingForecast: {
        ...rollingDefaults(),
        ...(config.rollingForecast || {}),
        bindings: {
          ...rollingDefaults().bindings,
          ...(config.rollingForecast?.bindings || {}),
        },
      },
    };
  if (chartType === "waterfall")
    return {
      ...config,
      chartType,
      waterfall: config.waterfall || waterfallDefaults(),
    };
  return { ...config, chartType };
}

const compatible = (bucket: SpecializedBucketId, field: FieldMeta) => {
  if (bucket === "threshold.actual" || bucket === "threshold.reference")
    return field.kind === "measure";
  if (
    bucket === "rolling.observationDateField" ||
    bucket === "rolling.targetDateField"
  )
    return field.kind === "dimension" && field.semantic?.dataType === "date";
  if (
    [
      "rolling.actualValueField",
      "rolling.forecastValueField",
      "rolling.lowerBoundField",
      "rolling.upperBoundField",
    ].includes(bucket)
  )
    return field.kind === "measure";
  if (bucket.startsWith("rolling.")) return field.kind === "dimension";
  return field.kind === "dimension";
};

export function bindSpecializedField(
  config: ChartConfig,
  bucket: SpecializedBucketId,
  field: FieldMeta | null,
): ChartConfig {
  if (field && !compatible(bucket, field)) return config;
  const fieldId = field?.id || null;
  if (bucket === "threshold.actual" || bucket === "threshold.reference") {
    const settings = config.thresholdComparison || thresholdDefaults(),
      key = bucket.split(".")[1] as "actual" | "reference";
    return {
      ...config,
      thresholdComparison: {
        ...settings,
        [key]: { ...settings[key], source: "metric", fieldId },
      },
    };
  }
  if (bucket.startsWith("rolling.")) {
    const settings = config.rollingForecast || rollingDefaults(),
      key = bucket.slice("rolling.".length) as keyof RollingForecastBindings;
    return {
      ...config,
      rollingForecast: {
        ...settings,
        bindings: { ...settings.bindings, [key]: fieldId },
      },
    };
  }
  return config;
}

export const specializedChart = (type: ChartType) =>
  ["threshold-comparison", "rolling-forecast", "waterfall"].includes(type);

export function chartTypeCompatible(
  dataset: Dataset,
  config: ChartConfig,
  type: ChartType,
): boolean {
  if (type === "threshold-comparison")
    return (
      dataset.fields.filter((field) => field.kind === "measure").length >= 1
    );
  if (type === "rolling-forecast")
    return (
      dataset.fields.filter((field) => field.kind === "measure").length >= 2 &&
      dataset.fields.filter(
        (field) =>
          field.kind === "dimension" && field.semantic?.dataType === "date",
      ).length >= 2
    );
  if (type === "waterfall")
    return (
      dataset.fields.some((field) => field.kind === "measure") &&
      dataset.fields.some((field) => field.kind === "dimension")
    );
  return true;
}

export function bucketAccepts(bucket: SpecializedBucketId, field: FieldMeta) {
  return compatible(bucket, field);
}
