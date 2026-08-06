import type {
  ActualForecastSettings,
  Aggregation,
  HierarchyAggregation,
  ChartConfig,
  ChartModel,
  ChartPoint,
  ChartSeries,
  DashboardParameters,
  DataRow,
  Dataset,
  MetricBinding,
  PageFilterState,
  PageFilterValue,
  PageFilterDefinition,
  PointSeriesContext,
  SeriesTimeRole,
  TimeGranularity,
  KpiCardModel,
  KpiModel,
  KpiSettings,
} from "../types";
import { buildEventRecords, eventTimestamp } from "../events/eventAdapter";
import {
  buildRollingForecast,
  buildThresholdComparison,
  buildWaterfall,
  validateBridgeSequence,
} from "./specializedCharts";

const COLORS = [
  "#0f8278",
  "#263b56",
  "#c58936",
  "#6f8294",
  "#925f55",
  "#53736a",
  "#977b9c",
  "#a65c36",
];
const applyScopedRollingFilters = (rows: DataRow[], dataset: Dataset, definitions: PageFilterDefinition[], state: PageFilterState, source: "forecast" | "actual", bindings?: { targetDateField?: string | null; observationDateField?: string | null }, diagnostics: string[] = []) => definitions.reduce((current, definition) => {
  const scope = definition.scope?.type || "page";
  if (!(scope === source || scope === "both")) return current;
  const sourceField = source === "forecast" ? definition.scope?.forecastFieldId : definition.scope?.actualFieldId;
  const inferredField = definition.fieldId === bindings?.targetDateField && source === "actual"
    ? bindings?.observationDateField
    : definition.fieldId === bindings?.observationDateField && source === "forecast"
      ? bindings?.targetDateField
      : undefined;
  const field = sourceField || inferredField || definition.scope?.fieldId || definition.fieldId;
  if (!dataset.fields.some((item) => item.id === field)) {
    diagnostics.push(`Фильтр ${definition.fieldId} не применён к ${source}: поле ${field} отсутствует в источнике`);
    return current;
  }
  return current.filter((row) => matches(row, field, state[definition.fieldId] ?? definition.defaultValue));
}, rows);
const latestThresholdPeriod = (dataset: Dataset, rows: DataRow[]) => {
  const period = dataset.fields.find((field) => field.semantic?.dataType === "date" || field.semantic?.granularity);
  if (!period || rows.length < 2) return rows;
  const latest = rows.reduce((max, row) => String(row[period.id] ?? "") > max ? String(row[period.id] ?? "") : max, "");
  return latest ? rows.filter((row) => String(row[period.id] ?? "") === latest) : rows;
};
export const DEFAULT_ACTUAL_FORECAST: ActualForecastSettings = {
  enabled: false,
  splitMode: "date",
  statusField: null,
  actualValues: [],
  forecastValues: [],
  showDivider: true,
  showPeriodLabels: true,
  forecastBackground: true,
  forecastLineStyle: "dashed",
  actualLabel: "Факт",
  forecastLabel: "Прогноз",
};
const text = (v: unknown) => (v == null || v === "" ? "∅" : String(v));
const unique = (values: string[]) => [
  ...new Set(values.filter((value) => value && value !== "∅")),
];
const aggregate = (rows: DataRow[], field: string, fn: Aggregation | HierarchyAggregation, orderField?: string) => {
  const orderedRows = orderField ? [...rows].sort((a, b) => canonical(a[orderField]).localeCompare(canonical(b[orderField]))) : rows;
  const values = orderedRows.map((r) => Number(r[field])).filter(Number.isFinite);
  if (fn === "COUNT") return rows.length;
  if (fn === "COUNT_DISTINCT") return new Set(orderedRows.map((r) => text(r[field])).filter((v) => v !== "∅")).size;
  if (!values.length) return null;
  if (fn === "SUM") return values.reduce((a, b) => a + b, 0);
  if (fn === "AVG") return values.reduce((a, b) => a + b, 0) / values.length;
  if (fn === "MIN") return Math.min(...values);
  if (fn === "MAX") return Math.max(...values);
  const ordered = orderedRows
    .map((row, index) => ({ row, index, value: Number(row[field]) }))
    .filter((item) => Number.isFinite(item.value));
  if (!ordered.length) return null;
  if (fn === "FIRST" || fn === "FIRST_NON_NULL") return ordered[0].value;
  if (fn === "LAST" || fn === "LAST_NON_NULL") return ordered[ordered.length - 1].value;
  return null;
};
const metricKey = (m: MetricBinding, stack: string) =>
  `${m.fieldId}__${m.aggregation}__${stack}`;
const canonical = (value: unknown) => String(value ?? "").replace(/-/g, "");
type TemporalParts = { year: number; month?: number; day?: number; quarter?: number };
const parseTemporalParts = (value: unknown, inputFormats?: string[]): TemporalParts | null => {
  const source = String(value ?? "").trim();
  if (!source) return null;
  const compact = source.replace(/[.\s\/_-]/g, "");
  const quarter = /^(\d{4})Q([1-4])$/i.exec(source);
  if (quarter) return { year: Number(quarter[1]), quarter: Number(quarter[2]), month: (Number(quarter[2]) - 1) * 3 + 1 };
  const yearMonth = /^(\d{4})(\d{2})$/.exec(compact);
  const yearMonthDay = /^(\d{4})(\d{2})(\d{2})$/.exec(compact);
  const prefersDay = inputFormats?.some((format) => format.includes("DD"));
  const match = yearMonthDay || (prefersDay ? null : yearMonth);
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = match[3] ? Number(match[3]) : undefined;
    if (year >= 1 && month >= 1 && month <= 12 && (!day || (day >= 1 && day <= 31))) return { year, month, day };
  }
  if (yearMonth) {
    const year = Number(yearMonth[1]), month = Number(yearMonth[2]);
    if (year >= 1 && month >= 1 && month <= 12) return { year, month };
  }
  return null;
};
const dateLabel = (value: string, granularity: "day" | "month") => {
  const normalized = canonical(value);
  if (granularity === "day" && normalized.length === 8)
    return `${normalized.slice(6, 8)}.${normalized.slice(4, 6)}.${normalized.slice(0, 4)}`;
  if (granularity === "month" && normalized.length === 6)
    return `${normalized.slice(4, 6)}.${normalized.slice(0, 4)}`;
  return value;
};
const temporalBucket = (value: string, level: string | null | undefined, fallback: TimeGranularity, inputFormats?: string[]) => {
  const raw = canonical(value), parts = parseTemporalParts(value, inputFormats);
  if (!level) return raw;
  if (!parts) return raw;
  const { year, month = 1 } = parts;
  if (level === "YEAR") return String(year);
  if (level === "HALF_YEAR") return `${year}H${month <= 6 ? 1 : 2}`;
  if (level === "QUARTER") return `${year}Q${parts.quarter || Math.ceil(month / 3)}`;
  if (level === "MONTH") return `${year}${String(month).padStart(2, "0")}`;
  if (level === "DAY" && fallback === "day" && parts.day) return `${year}${String(month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}`;
  return raw;
};
const temporalBucketLabel = (value: string, level: string | null | undefined, fallback: TimeGranularity, inputFormats?: string[]) => {
  const raw = temporalBucket(value, level, fallback, inputFormats);
  if (level === "YEAR" || level === "HALF_YEAR" || level === "QUARTER") return raw;
  return dateLabel(raw, fallback === "day" && raw.length === 8 ? "day" : "month");
};
const resolveHierarchyTimestamp = (rawValue: string, level: string | null | undefined, granularity: TimeGranularity, inputFormats?: string[]) => {
  const raw = canonical(rawValue), parts = parseTemporalParts(rawValue, inputFormats);
  if (!parts) return undefined;
  if (!level) return eventTimestamp(raw, granularity) ?? undefined;
  const { year, month = 1 } = parts;
  const normalizedMonth = level === "HALF_YEAR" ? (month <= 6 ? 1 : 7) : level === "QUARTER" ? (parts.quarter ? (parts.quarter - 1) * 3 + 1 : Math.floor((month - 1) / 3) * 3 + 1) : level === "YEAR" ? 1 : month;
  const day = level === "DAY" && granularity === "day" ? parts.day || 1 : 1;
  const timestamp = Date.UTC(year, normalizedMonth - 1, day);
  return Number.isFinite(timestamp) ? timestamp : undefined;
};
const DEFAULT_KPI_SETTINGS: KpiSettings = {
  timeFieldId: null,
  comparisonSource: "previous-period",
  comparisonOffset: 1,
  comparisonType: "absolute",
  showPeriodLabel: true,
  showComparisonLabel: true,
  showTrendIndicator: true,
  showSparkline: true,
  layout: "auto",
  alignment: "left",
  labelFontSize: "small",
  valueFontSize: "xlarge",
  positiveColor: "#16835b",
  negativeColor: "#c44f4f",
  neutralColor: "#738188",
  reverseComparisonColor: false,
};
const kpiDateLabel = (value: string, granularity: TimeGranularity) =>
  granularity === "day" && canonical(value).length === 8
    ? `${canonical(value).slice(6, 8)}.${canonical(value).slice(4, 6)}.${canonical(value).slice(0, 4)}`
    : granularity === "month" && canonical(value).length === 6
      ? `${canonical(value).slice(4, 6)}.${canonical(value).slice(0, 4)}`
      : value;
const buildKpi = (dataset: Dataset, rows: DataRow[], config: ChartConfig): KpiModel => {
  const settings = { ...DEFAULT_KPI_SETTINGS, ...(config.kpi || {}) },
    timeField = dataset.fields.find((field) => field.id === settings.timeFieldId) ||
      dataset.fields.find((field) => field.semantic?.dataType === "date"),
    granularity = timeField?.semantic?.granularity || "day",
    periods = new Map<string, { raw: string; timestamp?: number; rows: DataRow[] }>();
  if (timeField) rows.forEach((row) => {
    const raw = text(row[timeField.id]), timestamp = eventTimestamp(raw, granularity);
    if (timestamp === null) return;
    const key = canonical(raw).slice(0, granularity === "month" ? 6 : 8);
    const current = periods.get(key);
    periods.set(key, { raw: current?.raw || raw, timestamp: current?.timestamp ?? timestamp ?? undefined, rows: [...(current?.rows || []), row] });
  });
  const orderedPeriods = [...periods.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)),
    currentIndex = orderedPeriods.length - 1,
    comparisonIndex = settings.comparisonSource === "previous-period" ? currentIndex - Math.max(1, settings.comparisonOffset || 1) : -1,
    currentPeriod = orderedPeriods[currentIndex],
    comparisonPeriod = orderedPeriods[comparisonIndex],
    cards: KpiCardModel[] = config.metrics.map((metric) => {
      const field = dataset.fields.find((item) => item.id === metric.fieldId),
        currentValue = currentPeriod ? aggregate(currentPeriod.rows, metric.fieldId, metric.aggregation) : aggregate(rows, metric.fieldId, metric.aggregation),
        comparisonValue = comparisonPeriod ? aggregate(comparisonPeriod.rows, metric.fieldId, metric.aggregation) : null,
        absoluteDelta = currentValue !== null && comparisonValue !== null ? currentValue - comparisonValue : null,
        percentDelta = absoluteDelta !== null && comparisonValue !== null && comparisonValue !== 0 ? absoluteDelta / Math.abs(comparisonValue) * 100 : null,
        trend = absoluteDelta === null ? "unknown" : absoluteDelta > 0 ? "up" : absoluteDelta < 0 ? "down" : "flat";
      return { id: metric.fieldId, label: field?.label || metric.fieldId, unit: field?.unit || "count", currentValue, currentPeriodLabel: currentPeriod ? kpiDateLabel(currentPeriod.raw, granularity) : undefined, comparisonValue, comparisonPeriodLabel: comparisonPeriod ? kpiDateLabel(comparisonPeriod.raw, granularity) : undefined, absoluteDelta, percentDelta, trend, sparkline: orderedPeriods.slice(-120).map((period) => ({ timestamp: period.timestamp, label: kpiDateLabel(period.raw, granularity), value: aggregate(period.rows, metric.fieldId, metric.aggregation) })) };
    });
  return { cards, settings, title: settings.title, note: settings.note };
};
const matches = (row: DataRow, field: string, value: PageFilterValue) =>
  Array.isArray(value)
    ? !value.length || value.includes(text(row[field]))
    : (!value.from || canonical(row[field]) >= canonical(value.from)) &&
      (!value.to || canonical(row[field]) <= canonical(value.to));
export const applyPageFilters = (
  rows: DataRow[],
  filters: PageFilterState,
  exceptField?: string,
) =>
  rows.filter((row) =>
    Object.entries(filters).every(
      ([field, value]) => field === exceptField || matches(row, field, value),
    ),
  );
export const availableFilterValues = (
  dataset: Dataset,
  filters: PageFilterState,
  field: string,
) =>
  [
    ...new Set(
      applyPageFilters(dataset.rows, filters, field).map((row) =>
        text(row[field]),
      ),
    ),
  ].sort();
export const resolveTimeDomain = (
  timestamps: number[],
  range: { from: string; to: string } | undefined,
  granularity: TimeGranularity,
): [number, number] | undefined => {
  const observed = timestamps.filter(Number.isFinite);
  const minimum = observed.length ? Math.min(...observed) : undefined,
    maximum = observed.length ? Math.max(...observed) : undefined;
  const from = range?.from
      ? (eventTimestamp(range.from, granularity) ?? undefined)
      : undefined,
    to = range?.to
      ? (eventTimestamp(range.to, granularity) ?? undefined)
      : undefined;
  const start = from ?? minimum,
    end = to ?? maximum;
  return start !== undefined && end !== undefined && start <= end
    ? [start, end]
    : undefined;
};

const roleFromMembers = (
  dataset: Dataset,
  fieldId: string,
  value: string,
): SeriesTimeRole | undefined =>
  dataset.fields.find((field) => field.id === fieldId)?.semantic?.members?.[
    value
  ]?.timeRole;
const resolvedRoleSets = (
  dataset: Dataset,
  settings: ActualForecastSettings,
) => {
  const field = dataset.fields.find((item) => item.id === settings.statusField);
  const members = field?.semantic?.members || {};
  return {
    actual: new Set(
      settings.actualValues?.length
        ? settings.actualValues
        : Object.entries(members)
            .filter(([, meta]) => meta.timeRole === "actual")
            .map(([value]) => value),
    ),
    forecast: new Set(
      settings.forecastValues?.length
        ? settings.forecastValues
        : Object.entries(members)
            .filter(([, meta]) => meta.timeRole === "forecast")
            .map(([value]) => value),
    ),
  };
};
const roleForRows = (
  rows: DataRow[],
  settings: ActualForecastSettings,
  dataset: Dataset,
  timestamp: number | undefined,
  splitTimestamp: number,
  seriesRole: SeriesTimeRole | undefined,
): { role: SeriesTimeRole; statusValues: string[] } => {
  if (settings.splitMode === "date")
    return {
      role:
        timestamp !== undefined && timestamp >= splitTimestamp
          ? "forecast"
          : "actual",
      statusValues: [],
    };
  if (settings.splitMode === "series")
    return { role: seriesRole || "unknown", statusValues: [] };
  const statusValues = unique(
      rows.map((row) => text(row[settings.statusField || ""])),
    ),
    sets = resolvedRoleSets(dataset, settings);
  const roles = unique(
    statusValues.map((value) =>
      sets.actual.has(value)
        ? "actual"
        : sets.forecast.has(value)
          ? "forecast"
          : "unknown",
    ),
  ) as SeriesTimeRole[];
  return { role: roles.length === 1 ? roles[0] : "unknown", statusValues };
};

export function runQuery(
  dataset: Dataset,
  config: ChartConfig,
  pageFilters: PageFilterState = {},
  parameters: DashboardParameters = { splitDate: null },
  datasetRegistry?: Record<string, Dataset>,
  pageFilterDefinitions: PageFilterDefinition[] = [],
): ChartModel {
  const matchesLegacy = (row: DataRow) =>
    Object.entries(config.filters).every(
      ([field, selected]) =>
        !selected.length || selected.includes(text(row[field])),
    );
  const legacy = dataset.rows.filter(matchesLegacy),
    filtered = applyPageFilters(legacy, pageFilters);
  const specializedBase = {
    data: [],
    series: [],
    categories: [],
    events: [],
    eventCategories: [],
  };
  if (config.chartType === "threshold-comparison") {
    const thresholdSettings = config.thresholdComparison;
    const legacyThreshold = Boolean(
      thresholdSettings &&
        !thresholdSettings.measureField &&
        (thresholdSettings.actual?.fieldId ||
          thresholdSettings.reference?.fieldId ||
          thresholdSettings.actual?.source === "manual" ||
          thresholdSettings.reference?.source === "manual"),
    );
    const result = buildThresholdComparison(
      dataset,
      legacyThreshold ? latestThresholdPeriod(dataset, filtered) : filtered,
      thresholdSettings,
      pageFilterDefinitions,
    );
    return {
      ...specializedBase,
      thresholdComparison: result.model,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
    };
  }
  if (config.chartType === "rolling-forecast") {
    const rollingSettings = config.rollingForecast;
    const forecastId = rollingSettings?.forecastDatasetId;
    const actualId = rollingSettings?.actualDatasetId;
    const sourceDiagnostics: string[] = [], sourceWarnings: string[] = [];
    const resolveSource = (id: string | null | undefined, role: "Forecast" | "Actual") => {
      if (!id) return dataset;
      const resolved = datasetRegistry?.[id];
      if (datasetRegistry && !resolved) {
        sourceDiagnostics.push(`${role} dataset «${id}» не найден в каталоге источников`);
        return null;
      }
      return resolved || dataset;
    };
    const forecastDataset = resolveSource(forecastId, "Forecast");
    const actualDataset = resolveSource(actualId, "Actual");
    if (!forecastDataset || !actualDataset) {
      return { ...specializedBase, diagnostics: sourceDiagnostics, warnings: [] };
    }
    const result = buildRollingForecast(
      forecastDataset,
      applyScopedRollingFilters(forecastDataset.rows, forecastDataset, pageFilterDefinitions, pageFilters, "forecast", config.rollingForecast?.bindings, sourceWarnings),
      config.rollingForecast,
      actualDataset,
      applyScopedRollingFilters(actualDataset.rows, actualDataset, pageFilterDefinitions, pageFilters, "actual", config.rollingForecast?.bindings, sourceWarnings),
    );
    return {
      ...specializedBase,
      rollingForecast: result.model,
      diagnostics: [...sourceDiagnostics, ...result.diagnostics],
      warnings: [...sourceWarnings, ...result.warnings],
    };
  }
  if (config.chartType === "waterfall" && config.waterfall) {
    const result = buildWaterfall(dataset, filtered, config.waterfall);
    return {
      ...specializedBase,
      waterfall: result.model,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
    };
  }
  if (config.chartType === "kpi") {
    const kpi = buildKpi(dataset, filtered, config);
    return {
      ...specializedBase,
      kpi,
      diagnostics: filtered.length ? [] : ["По выбранным фильтрам данных нет"],
      warnings: kpi.settings.comparisonSource !== "none" && !kpi.cards.some((card) => card.comparisonValue !== null)
        ? ["Для KPI нет доступного периода сравнения"]
        : [],
    };
  }
  if (!config.metrics.length)
    return {
      data: [],
      series: [],
      categories: [],
      events: [],
      eventCategories: [],
      diagnostics: ["Добавьте показатель в Metrics"],
      warnings: [],
    };
  const view = config.viewBy.length ? config.viewBy : ["_all"],
    stack = config.stackBy[0];
  const viewFields = view.map((id) =>
    dataset.fields.find((field) => field.id === id),
  );
  const viewPresentation = config.viewByPresentation || {};
  const temporalLevels = view.map((id) => {
    const field = dataset.fields.find((item) => item.id === id),
      presentation = viewPresentation[id],
      hierarchy = field?.semantic?.hierarchies?.find((item) => String(item.hierarchyId) === String(presentation?.activeHierarchyId));
    return { field, presentation, hierarchy, level: presentation?.mode === "hierarchy" ? presentation.selectedLevelKey : null };
  });
  const timeIndexes = viewFields.flatMap((field, index) =>
    field?.semantic?.dataType === "date" && field.semantic.granularity
      ? [index]
      : [],
  );
  type Category = {
    key: string;
    values: string[];
    label: string;
    order: number;
    timestamp?: number;
    rawTimeValue?: string;
  };
  const categoryIndex = new Map<string, Category>(),
    groups = new Map<string, DataRow[]>();
  filtered.forEach((row) => {
    const values = view.map((f, index) => {
      if (f === "_all") return "Итого";
      const raw = text(row[f]), temporal = temporalLevels[index];
      return temporal.field?.semantic?.dataType === "date" && temporal.field.semantic.granularity
        ? temporalBucket(raw, temporal.level, temporal.field.semantic.granularity, temporal.field.semantic.inputFormats)
        : raw;
    }),
      categoryKey = JSON.stringify(values);
    if (!categoryIndex.has(categoryKey)) {
      const label = values
          .map((value, index) => {
            const semantic = viewFields[index]?.semantic;
            const temporal = temporalLevels[index];
            return semantic?.dataType === "date" && semantic.granularity
              ? temporalBucketLabel(value, temporal.level, semantic.granularity, semantic.inputFormats)
              : value;
          })
          .join(" · "),
        timeIndex = timeIndexes[0],
        semantic =
          timeIndex === undefined ? undefined : viewFields[timeIndex]?.semantic,
        rawTimeValue = timeIndex === undefined ? undefined : text(row[view[timeIndex]]),
        timestamp =
          timeIndex === undefined || !semantic?.granularity
            ? undefined
            : (resolveHierarchyTimestamp(rawTimeValue || values[timeIndex], temporalLevels[timeIndex]?.level, semantic.granularity, semantic.inputFormats) ??
              undefined);
      categoryIndex.set(categoryKey, {
        key: categoryKey,
        values,
        label,
        order: categoryIndex.size,
        timestamp,
        rawTimeValue,
      });
    }
    const stackValue = stack ? text(row[stack]) : "",
      key = `${categoryKey}\u001f${stackValue}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });
  const categoryItems = [...categoryIndex.values()].sort((a, b) => {
      for (const index of timeIndexes) {
        const result = canonical(a.values[index]).localeCompare(
          canonical(b.values[index]),
        );
        if (result) return result;
      }
      return a.order - b.order;
    }),
    categories = categoryItems.map((category) => category.label);
  const stackValues = stack
    ? [...new Set([...groups.keys()].map((key) => key.split("\u001f")[1]))]
    : [""];
  const series: ChartSeries[] = [];
  config.metrics.forEach((metric, metricIndex) =>
    stackValues.forEach((stackValue, stackIndex) => {
      const id = metricKey(metric, stackValue),
        field = dataset.fields.find((item) => item.id === metric.fieldId),
        stackField = stack
          ? dataset.fields.find((item) => item.id === stack)
          : undefined,
        setting = config.seriesSettings[id],
        stackLabel = stackValue
          ? stackField?.semantic?.members?.[stackValue]?.label || stackValue
          : "",
        label = [field?.label || metric.fieldId, stackLabel]
          .filter(Boolean)
          .join(" · "),
        timeRole =
          setting?.timeRole ||
          (!stack ? undefined : roleFromMembers(dataset, stack, stackValue));
      series.push({
        id,
        dataKey: `s_${metricIndex}_${stackIndex}`,
        label,
        fullLabel: label,
        measureId: metric.fieldId,
        measureKey: metric.fieldId,
        measureLabel: field?.label || metric.fieldId,
        columnPath: stack
          ? [{ dimensionKey: stack, value: stackValue, label: stackLabel }]
          : [],
        order: series.length,
        color:
          setting?.color ||
          COLORS[
            (metricIndex * stackValues.length + stackIndex) % COLORS.length
          ],
        visible: setting?.visible !== false,
        unit: field?.unit || "count",
        seriesType: metric.seriesType || (metricIndex < 2 ? "column" : "line"),
        yAxisId: metric.yAxisId,
        timeRole,
        valueFormat: { unit: field?.unit },
      });
    }),
  );
  const data: ChartPoint[] = categoryItems.map((category) => {
    const point: ChartPoint = {
      categoryKey: category.key,
      categoryLabel: category.label,
      timestamp: category.timestamp,
    };
    series.forEach((item) => {
      const metric = config.metrics.find(
          (binding) => binding.fieldId === item.measureKey,
        )!,
        stackValue = stack ? item.columnPath[0]?.value || "" : "";
      const hierarchyAggregation = temporalLevels.some((item) => item.level)
        ? (metric.hierarchyAggregation || metric.aggregation)
        : metric.aggregation;
      const hierarchyOrderField = ["FIRST_NON_NULL", "LAST_NON_NULL", "FIRST", "LAST"].includes(hierarchyAggregation)
        ? temporalLevels.find((item) => item.level)?.field?.id
        : undefined;
      point[item.dataKey] = aggregate(
        groups.get(`${category.key}\u001f${stackValue}`) || [],
        metric.fieldId,
        hierarchyAggregation,
        hierarchyOrderField,
      );
    });
    return point;
  });
  const warnings: string[] = [];
  const settings = { ...DEFAULT_ACTUAL_FORECAST, ...config.actualForecast },
    splitTimestamp = parameters.splitDate
      ? eventTimestamp(parameters.splitDate, "day")
      : null,
    eligible =
      ["line", "time-series-events"].includes(config.chartType) &&
      timeIndexes.length > 0;
  let actualForecast: ChartModel["actualForecast"];
  if (
    settings.enabled &&
    eligible &&
    parameters.splitDate &&
    splitTimestamp !== null
  ) {
    const contexts: Record<string, Record<string, PointSeriesContext>> = {};
    let mixed = false,
      positionConflict = false;
    for (const category of categoryItems) {
      contexts[category.key] = {};
      for (const item of series) {
        const stackValue = stack ? item.columnPath[0]?.value || "" : "",
          rows = groups.get(`${category.key}\u001f${stackValue}`) || [],
          resolved = roleForRows(
            rows,
            settings,
            dataset,
            category.timestamp,
            splitTimestamp,
            item.timeRole,
          ),
          conflict =
            category.timestamp !== undefined &&
            ((resolved.role === "actual" &&
              category.timestamp >= splitTimestamp) ||
              (resolved.role === "forecast" &&
                category.timestamp < splitTimestamp));
        if (resolved.role === "unknown") mixed = true;
        if (conflict) positionConflict = true;
        const scenarioFields = dataset.fields
            .filter((field) => field.semantic?.role === "scenario")
            .map((field) => field.id),
          versionFields = dataset.fields
            .filter((field) => field.semantic?.role === "version")
            .map((field) => field.id);
        contexts[category.key][item.dataKey] = {
          timeRole: resolved.role,
          statusValues: resolved.statusValues,
          scenarioValues: unique(
            rows.flatMap((row) =>
              scenarioFields.map((field) => text(row[field])),
            ),
          ),
          versionValues: unique(
            rows.flatMap((row) =>
              versionFields.map((field) => text(row[field])),
            ),
          ),
          conflict,
        };
      }
    }
    if (mixed)
      warnings.push("Найдены точки с неопределённой Actual / Forecast ролью");
    if (positionConflict)
      warnings.push(
        "Статус части точек не совпадает с глобальной датой разделения",
      );
    actualForecast = {
      enabled: true,
      splitTimestamp,
      splitDate: parameters.splitDate,
      settings,
      contexts,
    };
  }
  const eventBuild = buildEventRecords(dataset),
    selected = new Set(config.eventFields),
    eventCategories = eventBuild.categories
      .filter((category) => selected.has(category.key))
      .map((category) => ({
        ...category,
        visible: config.eventCategoryVisibility[category.key] !== false,
      })),
    visibleCategories = new Set(
      eventCategories
        .filter((category) => category.visible)
        .map((category) => category.key),
    );
  let events = eventBuild.records
    .filter(
      (record) =>
        selected.has(record.event.categoryKey) &&
        visibleCategories.has(record.event.categoryKey) &&
        matchesLegacy(record.sourceRow) &&
        applyPageFilters([record.sourceRow], pageFilters).length > 0,
    )
    .map((record) => record.event);
  warnings.push(...eventBuild.warnings);
  if (events.length > 200) {
    warnings.push(`Показаны первые 200 из ${events.length} событий`);
    events = events.slice(0, 200);
  }
  const timestamps = [
      ...data
        .map((point) => point.timestamp)
        .filter((value): value is number => typeof value === "number"),
      ...events.map((event) => event.timestamp),
    ],
    temporalField = viewFields.find(
      (field) =>
        field?.semantic?.dataType === "date" && field.semantic.granularity,
    ),
    filterValue = temporalField ? pageFilters[temporalField.id] : undefined,
    dateRange =
      filterValue && !Array.isArray(filterValue) ? filterValue : undefined,
    timeDomain = temporalField?.semantic?.granularity
      ? resolveTimeDomain(
          timestamps,
          dateRange,
          temporalField.semantic.granularity,
        )
      : timestamps.length
        ? ([Math.min(...timestamps), Math.max(...timestamps)] as [
            number,
            number,
          ])
        : undefined;
  return {
    data,
    series,
    categories,
    events,
    eventCategories,
    timeDomain,
    actualForecast,
    diagnostics: filtered.length ? [] : ["По выбранным фильтрам данных нет"],
    warnings,
  };
}

export function validateConfig(
  dataset: Dataset,
  config: ChartConfig,
): string[] {
  const errors: string[] = [];
  const presentations = config.viewByPresentation || {};
  config.viewBy.forEach((fieldId) => {
    const field = dataset.fields.find((item) => item.id === fieldId), presentation = presentations[fieldId];
    if (field?.semantic?.dataType !== "date" || presentation?.mode !== "hierarchy") return;
    const hierarchy = field.semantic.hierarchies?.find((item) => String(item.hierarchyId) === String(presentation.activeHierarchyId));
    if (!hierarchy) errors.push(`Иерархия для поля ${field.label} недоступна`);
    else if (!hierarchy.levels.some((level) => level.levelKey === presentation.selectedLevelKey)) errors.push(`Уровень ${presentation.selectedLevelKey || ""} отсутствует в активной иерархии`);
  });
  config.metrics.forEach((metric) => {
    if (["FIRST_NON_NULL", "LAST_NON_NULL", "FIRST", "LAST"].includes(metric.hierarchyAggregation || "") && !metric.hierarchyOrderLevel) errors.push(`Для показателя ${metric.fieldId} укажите базовый уровень FIRST/LAST`);
  });
  const metrics = config.metrics.length,
    dims = config.viewBy.length,
    specialized = [
      "threshold-comparison",
      "rolling-forecast",
      "waterfall",
    ].includes(config.chartType);
  if (!metrics && !specialized) errors.push("Добавьте минимум один показатель");
  if (
    !dims &&
    ![
      "kpi",
      "bullet",
      "threshold-comparison",
      "rolling-forecast",
      "waterfall",
    ].includes(config.chartType)
  )
    errors.push("Добавьте аналитику в View by");
  if (
    config.chartType === "pie" &&
    (metrics !== 1 || dims !== 1 || config.stackBy.length > 0)
  )
    errors.push("Pie требует 1 Metric, 1 View by и пустой Stack by");
  if (
    config.chartType === "stacked-column" &&
    (metrics !== 1 || !config.stackBy.length)
  )
    errors.push("Stacked Column требует 1 Metric и Stack by");
  if (config.chartType === "combo" && (metrics < 2 || metrics > 4))
    errors.push("Combo требует от 2 до 4 metrics");
  if (
    config.chartType === "combo" &&
    config.dualAxisEnabled &&
    metrics >= 2 &&
    !config.metrics.some((metric) => metric.yAxisId === "left")
  )
    errors.push("Dual Axis требует показатель на левой оси");
  if (
    config.chartType === "combo" &&
    config.dualAxisEnabled &&
    metrics >= 2 &&
    !config.metrics.some((metric) => metric.yAxisId === "right")
  )
    errors.push("Dual Axis требует покатель на правой оси");
  if (config.chartType === "heatmap" && (metrics !== 1 || dims !== 2))
    errors.push("Heatmap требует 2 View by и 1 Metric");
  if (config.chartType === "bullet" && metrics < 2)
    errors.push("Bullet требует Actual и Target");
  if (config.chartType === "threshold-comparison") {
    const settings = config.thresholdComparison;
    if (!settings) errors.push("Настройте Threshold Comparison");
    else {
      const legacy = !settings.measureField && Boolean(settings.actual?.fieldId || settings.reference?.fieldId || settings.actual?.source === "manual" || settings.reference?.source === "manual");
      if (!legacy) {
        if (!settings.measureField) errors.push("Выберите показатель");
        if (!settings.differentiator?.fieldId) errors.push("Выберите аналитику сравнения");
        if (!settings.differentiator?.valueA) errors.push("Выберите Value A");
        if (!settings.differentiator?.valueB) errors.push("Выберите Value B");
        if (settings.differentiator?.valueA && settings.differentiator.valueA === settings.differentiator.valueB)
          errors.push("Value A и Value B должны отличаться");
      }
    }
  }
  if (config.chartType === "rolling-forecast") {
    const b = config.rollingForecast?.bindings;
    if (!b?.observationDateField) errors.push("Добавьте Observation Date");
    if (!b?.actualValueField) errors.push("Добавьте Actual");
    if (!b?.targetDateField) errors.push("Добавьте Target Date");
    if (!b?.forecastValueField) errors.push("Добавьте Forecast");
  }
  if (config.chartType === "waterfall") {
    errors.push(
      ...validateBridgeSequence(dataset, config.waterfall).blockingErrors,
    );
  }
  if (config.chartType === "time-series-events") {
    const temporal = config.viewBy.some(
      (id) =>
        dataset.fields.find((field) => field.id === id)?.semantic?.dataType ===
        "date",
    );
    if (!temporal)
      errors.push("Time Series with Events требует временной View by");
    if (!dataset.eventProjection || !config.eventFields.length)
      errors.push("Time Series with Events требует подключённые Events");
  }
  const split = config.actualForecast;
  if (split?.enabled) {
    const temporal = config.viewBy.some(
      (id) =>
        dataset.fields.find((field) => field.id === id)?.semantic?.dataType ===
        "date",
    );
    if (!["line", "time-series-events"].includes(config.chartType) || !temporal)
      errors.push("Actual / Forecast Split доступен только для временных Line");
    if (split.splitMode === "field") {
      if (
        !split.statusField ||
        !dataset.fields.some(
          (field) =>
            field.id === split.statusField && field.kind === "dimension",
        )
      )
        errors.push("Выберите status field для Actual / Forecast");
      if (
        split.actualValues?.some((value) =>
          split.forecastValues?.includes(value),
        )
      )
        errors.push("Actual и Forecast values не должны пересекаться");
    }
  }
  const ids = new Set(dataset.fields.map((field) => field.id)),
    specializedIds = [
      config.thresholdComparison?.actual.fieldId,
      config.thresholdComparison?.reference.fieldId,
      ...Object.values(config.rollingForecast?.bindings || {}),
    ].filter((id): id is string => typeof id === "string" && Boolean(id));
  [
    ...config.viewBy,
    ...config.stackBy,
    ...config.metrics.map((metric) => metric.fieldId),
    ...specializedIds,
  ].forEach((id) => {
    if (!ids.has(id)) errors.push(`Поле ${id} отсутствует в dataset`);
  });
  return [...new Set(errors)];
}
