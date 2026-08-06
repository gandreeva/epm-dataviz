import type {
  Aggregation,
  BridgeModel,
  BridgeRenderItem,
  BridgeSequenceConfig,
  DataRow,
  Dataset,
  RollingForecastModel,
  RollingForecastSettings,
  ThresholdComparisonModel,
  ThresholdComparisonSettings,
  ArticleDisplayField,
  ThresholdZone,
  Unit,
  ValueBinding,
  PageFilterDefinition,
} from "../types";
import { eventTimestamp, semanticDateTimestamp } from "../events/eventAdapter";
import { FIN_ACCOUNT_DISPLAY as DATA_ACCOUNT_LABELS } from "../data/datasets";

const waterfallDebugEnabled = () => typeof window !== "undefined" && window.localStorage.getItem("waterfall.debug") === "true";
const waterfallDebug = (stage: string, payload: unknown) => { if (waterfallDebugEnabled()) console.info(`[waterfall:${stage}]`, payload); };

export const DEFAULT_THRESHOLD_ZONES: ThresholdZone[] = [
  {
    key: "good",
    label: "В допустимом диапазоне",
    from: null,
    to: 10,
    semantic: "good",
    displayColor: "green",
  },
  {
    key: "warning",
    label: "Требует внимания",
    from: 10,
    to: 20,
    semantic: "warning",
    displayColor: "yellow",
  },
  {
    key: "bad",
    label: "Критическое отклонение",
    from: 20,
    to: null,
    semantic: "bad",
    displayColor: "red",
  },
];

export const DEFAULT_THRESHOLD_SETTINGS: ThresholdComparisonSettings = {
  measureField: null,
  differentiator: { fieldId: null, valueA: null, valueB: null },
  actual: { source: "metric", fieldId: null, aggregation: "SUM" },
  reference: { source: "metric", fieldId: null, aggregation: "SUM" },
  referenceType: "plan",
  percentageBase: "actual",
  direction: "higher_is_better",
  thresholdsMode: "percentage",
  thresholds: DEFAULT_THRESHOLD_ZONES,
  showActualLabel: true,
  showReferenceLabel: true,
  showDeviation: true,
  showZoneLabels: true,
  showExplanation: true,
  showArticleLabel: false,
  articleFieldId: null,
  articleDisplayField: "text" as ArticleDisplayField,
  markerColors: { actual: "#0f8278", reference: "#263b56" },
};

export const DEFAULT_ROLLING_SETTINGS: RollingForecastSettings = {
  bindings: {},
  forecastDatasetId: "key_rate_forecast",
  actualDatasetId: "key_rate_actual",
  filters: [],
  horizonValue: 12,
  horizonUnit: "month",
  observationDateMode: "hover",
  selectedObservationDate: null,
  showLagConnector: true,
  showForecastBand: true,
  showForecastCenterLine: true,
  showObservationMarker: true,
  showTargetMarker: true,
  showSummaryCard: true,
  showPastForecastSplit: true,
  actualLabel: "Факт",
  forecastLabel: "Прогноз",
  pastLabel: "История",
  futureLabel: "Прогноз 12 месяцев",
  timeHierarchy: { mode: "hierarchy", activeHierarchyId: null, selectedLevelKey: null },
};

export const DEFAULT_WATERFALL_SETTINGS: BridgeSequenceConfig = {
  version: 2,
  dimensionKey: null,
  availableMeasureKeys: [],
  defaultMeasureKey: null,
  items: [],
  memberReference: { referenceId: null, attributeField: null, attributeValue: null },
  valueInterpretation: "absolute_by_operator",
  validateCheckpoints: true,
  toleranceType: "percentage",
  toleranceValue: 0.1,
  showConnectors: true,
  showValueLabels: true,
  showRunningBalance: false,
  showReconciliation: true,
  showReconciliationSummary: true,
  showWarnings: true,
  showDebug: false,
};

export interface SpecializedResult<T> {
  model?: T;
  diagnostics: string[];
  warnings: string[];
}
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown) => String(value ?? "");
const aggregate = (rows: DataRow[], field: string, fn: Aggregation) => {
  const values = rows
    .map((row) => number(row[field]))
    .filter((value): value is number => value !== null);
  if (fn === "COUNT") return rows.length;
  if (!values.length) return null;
  if (fn === "SUM") return values.reduce((sum, value) => sum + value, 0);
  if (fn === "AVG")
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (fn === "MIN") return Math.min(...values);
  return Math.max(...values);
};
const bindingValue = (rows: DataRow[], binding: ValueBinding) =>
  binding.source === "manual"
    ? number(binding.manualValue)
    : binding.fieldId
      ? aggregate(rows, binding.fieldId, binding.aggregation)
      : null;
const unitOf = (dataset: Dataset, fieldId: string | null | undefined): Unit =>
  dataset.fields.find((field) => field.id === fieldId)?.unit || "count";

export function validateThresholdZones(zones: ThresholdZone[]): string[] {
  const errors: string[] = [];
  if (!zones.length) return ["Добавьте хотя бы одну threshold zone"];
  const sorted = [...zones].sort(
    (a, b) =>
      (a.from ?? Number.NEGATIVE_INFINITY) -
      (b.from ?? Number.NEGATIVE_INFINITY),
  );
  sorted.forEach((zone) => {
    if (zone.from !== null && zone.to !== null && zone.from >= zone.to)
      errors.push(`Zone ${zone.label}: from должен быть меньше to`);
  });
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1],
      current = sorted[index];
    if (previous.to === null)
      errors.push(
        `Zone ${previous.label} не может быть открытой перед последней зоной`,
      );
    else if (current.from === null || previous.to > current.from)
      errors.push(
        `Threshold zones ${previous.label} и ${current.label} пересекаются`,
      );
    else if (previous.to < current.from)
      errors.push(
        `Между zones ${previous.label} и ${current.label} есть разрыв`,
      );
  }
  return errors;
}

export function buildThresholdComparison(
  dataset: Dataset,
  rows: DataRow[],
  settingsInput: ThresholdComparisonSettings | undefined,
  pageFilterDefinitions: PageFilterDefinition[] = [],
): SpecializedResult<ThresholdComparisonModel> {
  const settings = {
    ...DEFAULT_THRESHOLD_SETTINGS,
    ...settingsInput,
    differentiator: { ...DEFAULT_THRESHOLD_SETTINGS.differentiator, ...settingsInput?.differentiator },
    thresholds: settingsInput?.thresholds || DEFAULT_THRESHOLD_ZONES,
    markerColors: {
      actual: settingsInput?.markerColors?.actual || DEFAULT_THRESHOLD_SETTINGS.markerColors!.actual,
      reference: settingsInput?.markerColors?.reference || DEFAULT_THRESHOLD_SETTINGS.markerColors!.reference,
    },
  };
  const diagnostics = validateThresholdZones(settings.thresholds),
    warnings: string[] = [];
  const field = settings.measureField ? dataset.fields.find((item) => item.id === settings.measureField) : undefined;
  const differentiator = settings.differentiator;
  const differentiatorField = differentiator?.fieldId ? dataset.fields.find((item) => item.id === differentiator.fieldId) : undefined;
  const conflictingPageFilter = differentiator?.fieldId && pageFilterDefinitions.find((filter) => filter.fieldId === differentiator.fieldId);
  const legacyMode = !field && Boolean(settings.actual?.fieldId || settings.reference?.fieldId || settings.actual?.source === "manual" || settings.reference?.source === "manual");
  if (!legacyMode) {
    if (conflictingPageFilter) diagnostics.push(`Dimension ${differentiator?.fieldId} уже используется в page filter`);
    if (!field || field.kind !== "measure") diagnostics.push("Выберите показатель для сравнения");
    if (!differentiator?.fieldId || !dataset.fields.some((item) => item.id === differentiator.fieldId && item.kind === "dimension")) diagnostics.push("Выберите аналитику сравнения");
    if (!differentiator?.valueA) diagnostics.push("Выберите Value A");
    if (!differentiator?.valueB) diagnostics.push("Выберите Value B");
    if (differentiator?.valueA && differentiator.valueA === differentiator.valueB) diagnostics.push("Value A и Value B должны отличаться");
  }
  const leftRows = rows.filter((row) => String(row[differentiator?.fieldId || ""] ?? "") === differentiator?.valueA);
  const rightRows = rows.filter((row) => String(row[differentiator?.fieldId || ""] ?? "") === differentiator?.valueB);
  const actualValue = legacyMode ? bindingValue(rows, settings.actual) : field ? aggregate(leftRows, field.id, "SUM") : null,
    referenceValue = legacyMode ? bindingValue(rows, settings.reference) : field ? aggregate(rightRows, field.id, "SUM") : null;
  if (!legacyMode && field && actualValue === null)
    diagnostics.push(leftRows.length ? `Value A содержит строки, но показатель ${field.label} нечисловой` : `Value A отсутствует после применения page filters`);
  if (!legacyMode && field && referenceValue === null)
    diagnostics.push(rightRows.length ? `Value B содержит строки, но показатель ${field.label} нечисловой` : `Value B отсутствует после применения page filters`);
  const actualUnit = legacyMode ? unitOf(dataset, settings.actual.fieldId || settings.reference.fieldId) : field?.unit || "count",
    referenceUnit = legacyMode ? unitOf(dataset, settings.reference.fieldId || settings.actual.fieldId) : field?.unit || "count";
  if (diagnostics.length || actualValue === null || referenceValue === null)
    return { diagnostics: [...new Set(diagnostics)], warnings };
  const absoluteDeviation =
    settings.direction === "higher_is_better"
      ? referenceValue - actualValue
      : actualValue - referenceValue;
  const denominator =
    settings.percentageBase === "actual" ? actualValue : referenceValue;
  const percentageDeviation =
    denominator === 0
      ? null
      : (absoluteDeviation / Math.abs(denominator)) * 100;
  if (percentageDeviation === null)
    warnings.push(
      "Процентное отклонение недоступно: значение denominator равно нулю",
    );
  const currentZone =
    percentageDeviation === null
      ? undefined
      : settings.thresholds.find(
          (zone) =>
            (zone.from === null || percentageDeviation >= zone.from) &&
            (zone.to === null || percentageDeviation < zone.to),
        );
  if (percentageDeviation !== null && !currentZone)
    diagnostics.push("Отклонение не попало ни в одну threshold zone");
  const directionLabel =
    settings.direction === "higher_is_better" ? "выше — лучше" : "ниже — лучше";
  const statusLabel =
    currentZone?.label ||
    (percentageDeviation === null
      ? "Процент недоступен"
      : "Статус не определён");
  const articleField = settings.articleFieldId ? dataset.fields.find((item) => item.id === settings.articleFieldId) : undefined;
  const articleValues = articleField ? [...new Set(rows.map((row) => String(row[articleField.id] ?? "")).filter(Boolean))] : [];
  const accountLabels = DATA_ACCOUNT_LABELS;
  const articleLabel = settings.showArticleLabel
    ? articleValues.length === 1 ? (settings.articleDisplayField === "key" ? articleValues[0] : settings.articleDisplayField === "acc_type" ? accountLabels[articleValues[0]]?.accType || "—" : accountLabels[articleValues[0]]?.text || articleField?.semantic?.members?.[articleValues[0]]?.label || articleValues[0]) : articleValues.length > 1 ? "Все статьи" : null
    : null;
  const formatDateMember = (value: string) => {
    if (differentiatorField?.semantic?.dataType !== "date") return value;
    const format = differentiatorField.semantic.outputFormat || differentiatorField.semantic.inputFormats?.[0] || "";
    if (format === "YYYYMM" && /^\d{6}$/.test(value)) return value;
    if (format === "YYYYMMDD" && /^\d{8}$/.test(value)) return value;
    return value;
  };
  const comparisonLabel = `${formatDateMember(settings.differentiator?.valueA || "Value A")} / ${formatDateMember(settings.differentiator?.valueB || "Value B")}`;
  const valueAtDeviation = (deviation: number) => {
    const ratio = deviation / 100;
    if (settings.percentageBase === "reference") {
      return settings.direction === "higher_is_better"
        ? referenceValue * (1 - ratio)
        : referenceValue * (1 + ratio);
    }
    const denominator = settings.direction === "higher_is_better" ? 1 + ratio : 1 - ratio;
    return denominator === 0 ? null : referenceValue / denominator;
  };
  const convertedThresholds = settings.thresholds
    .map((threshold) => {
      const valueFrom = threshold.from === null ? null : valueAtDeviation(threshold.from);
      const valueTo = threshold.to === null ? null : valueAtDeviation(threshold.to);
      if ((valueFrom !== null && !Number.isFinite(valueFrom)) || (valueTo !== null && !Number.isFinite(valueTo))) return null;
      return { threshold, valueFrom, valueTo };
    })
    .filter((value): value is { threshold: ThresholdZone; valueFrom: number | null; valueTo: number | null } => value !== null);
  const scaleValues = convertedThresholds.flatMap((zone) => [zone.valueFrom, zone.valueTo]).filter((value): value is number => value !== null);
  const rawScale = [actualValue, referenceValue, ...scaleValues].filter(Number.isFinite);
  const rawMin = Math.min(...rawScale), rawMax = Math.max(...rawScale);
  const scaleMin = rawMin >= 0 ? 0 : rawMin - Math.abs(rawMin || 1) * 0.05;
  const scaleMax = rawMax === scaleMin ? scaleMin + Math.max(Math.abs(rawMax), 1) : rawMax * (rawMax >= 0 ? 1.05 : 1);
  const thresholdValueRanges = convertedThresholds.map(({ threshold, valueFrom, valueTo }) => ({
    ...threshold,
    valueFrom: Math.min(valueFrom ?? scaleMin, valueTo ?? scaleMax),
    valueTo: Math.max(valueFrom ?? scaleMin, valueTo ?? scaleMax),
  }));
  return {
    model: {
      metricLabel: field?.label || dataset.fields.find((item) => item.id === settings.actual.fieldId || item.id === settings.reference.fieldId)?.label || "Показатель",
      unit: actualUnit,
      actualValue,
      referenceValue,
      referenceType: settings.referenceType,
      absoluteDeviation,
      percentageDeviation,
      percentageBase: settings.percentageBase,
      direction: settings.direction,
      thresholds: settings.thresholds,
      currentZoneKey: currentZone?.key || null,
      statusLabel,
      explanation: `${directionLabel}. ${statusLabel}.`,
      scaleMin,
      scaleMax,
      thresholdValueRanges,
      markerColors: settings.markerColors,
      accountKey: null,
      leftValue: actualValue,
      rightValue: referenceValue,
      leftLabel: settings.differentiator?.labelA || formatDateMember(settings.differentiator?.valueA || "Value A"),
      rightLabel: settings.differentiator?.labelB || formatDateMember(settings.differentiator?.valueB || "Value B"),
      comparisonLabel,
      articleLabel,
      articleFieldLabel: articleField?.label || null,
      showArticleLabel: settings.showArticleLabel,
    },
    diagnostics: [...new Set(diagnostics)],
    warnings,
  };
}

const horizonLabel = (
  value: number,
  unit: RollingForecastSettings["horizonUnit"],
) => {
  const labels = {
    day: "дн.",
    week: "нед.",
    month: "мес.",
    quarter: "кв.",
    year: "г.",
  };
  return `${value} ${labels[unit]}`;
};
const hierarchyPeriodTimestamp = (timestamp: number, level?: string | null) => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()) || !level || level === "DAY") return timestamp;
  const year = date.getUTCFullYear();
  if (level === "YEAR") return Date.UTC(year, 0, 1);
  if (level === "HALF_YEAR") return Date.UTC(year, date.getUTCMonth() < 6 ? 0 : 6, 1);
  if (level === "QUARTER") return Date.UTC(year, Math.floor(date.getUTCMonth() / 3) * 3, 1);
  if (level === "MONTH") return Date.UTC(year, date.getUTCMonth(), 1);
  return timestamp;
};
const hierarchyPeriodDate = (timestamp: number, level?: string | null) => {
  const date = new Date(timestamp);
  if (!level || level === "DAY") return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  if (level === "YEAR") return String(date.getUTCFullYear());
  if (level === "HALF_YEAR") return `${date.getUTCFullYear()}H${date.getUTCMonth() < 6 ? 1 : 2}`;
  if (level === "QUARTER") return `${date.getUTCFullYear()}Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};
export function buildRollingForecast(
  dataset: Dataset,
  rows: DataRow[],
  settingsInput: RollingForecastSettings | undefined,
  actualDataset: Dataset = dataset,
  actualRows: DataRow[] = rows,
): SpecializedResult<RollingForecastModel> {
  const settings = {
    ...DEFAULT_ROLLING_SETTINGS,
    ...settingsInput,
    bindings: {
      ...DEFAULT_ROLLING_SETTINGS.bindings,
      ...settingsInput?.bindings,
    },
  };
  const b = settings.bindings,
    diagnostics: string[] = [],
    warnings: string[] = [];
  const required: Array<[keyof typeof b, string]> = [
    ["observationDateField", "Observation Date"],
    ["actualValueField", "Actual"],
    ["targetDateField", "Target Date"],
    ["forecastValueField", "Forecast"],
  ];
  required.forEach(([key, label]) => {
    if (!b[key]) diagnostics.push(`Добавьте поле в ${label}`);
  });
  if (settings.horizonValue <= 0)
    diagnostics.push("Forecast horizon должен быть больше нуля");
  const actualUnit = unitOf(actualDataset, b.actualValueField),
    forecastUnit = unitOf(dataset, b.forecastValueField);
  if (b.actualValueField && b.forecastValueField && actualUnit !== forecastUnit)
    diagnostics.push("Actual и Forecast должны иметь одинаковые units");
  if (diagnostics.length) return { diagnostics, warnings };
  const actualByDate = new Map<
      string,
      { date: string; timestamp: number; value: number }
    >(),
    vintages: RollingForecastModel["vintages"] = [];
  const targetSemantic = dataset.fields.find((field) => field.id === b.targetDateField)?.semantic;
  const targetGranularity = targetSemantic?.granularity || "day";
  const shiftHorizon = (date: string, direction: 1 | -1) => {
    const timestamp = semanticDateTimestamp(date, targetSemantic);
    if (timestamp === null) return null;
    const value = new Date(timestamp);
    const amount = direction * settings.horizonValue * ({ day: 1, week: 7, month: 0, quarter: 0, year: 0 } as Record<string, number>)[settings.horizonUnit];
    if (settings.horizonUnit === "month" || settings.horizonUnit === "quarter" || settings.horizonUnit === "year") {
      const months = direction * settings.horizonValue * (settings.horizonUnit === "year" ? 12 : settings.horizonUnit === "quarter" ? 3 : 1);
      const day = value.getUTCDate();
      value.setUTCDate(1);
      value.setUTCMonth(value.getUTCMonth() + months);
      const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
      value.setUTCDate(Math.min(day, last));
    } else value.setUTCDate(value.getUTCDate() + amount);
    return value.getTime();
  };
  for (const row of actualRows) {
    const observationDate = text(row[b.observationDateField!]), observationTimestamp = eventTimestamp(observationDate), actualValue = number(row[b.actualValueField!]);
    if (observationTimestamp !== null && actualValue !== null) actualByDate.set(observationDate, { date: observationDate, timestamp: observationTimestamp, value: actualValue });
  }
  for (const row of rows) {
    const targetDate = text(row[b.targetDateField!]),
      targetTimestamp = semanticDateTimestamp(targetDate, targetSemantic),
      forecastValue = number(row[b.forecastValueField!]);
    if (
      targetTimestamp === null ||
      forecastValue === null
    ) {
      warnings.push(
        `Пропущена невалидная forecast row ${targetDate || "без даты"}`,
      );
      continue;
    }
    const lowerBound = b.lowerBoundField
        ? number(row[b.lowerBoundField])
        : null,
      upperBound = b.upperBoundField ? number(row[b.upperBoundField]) : null;
    if (lowerBound !== null && upperBound !== null && lowerBound > upperBound) {
      diagnostics.push(`Lower Bound больше Upper Bound для ${targetDate}`);
      continue;
    }
    const legacyObservationDate = actualRows === rows ? text(row[b.observationDateField!]) : "";
    const computedObservation = legacyObservationDate ? eventTimestamp(legacyObservationDate) : shiftHorizon(targetDate, -1);
    const actual = computedObservation === null ? undefined : [...actualByDate.values()].find((item) => item.timestamp === computedObservation || (targetGranularity === "month" && new Date(item.timestamp).toISOString().slice(0, 7) === new Date(computedObservation).toISOString().slice(0, 7)));
    if (!actual) { warnings.push(`Не найден Actual для forecast ${targetDate}`); continue; }
    const observationDate = actual.date, observationTimestamp = actual.timestamp;
    vintages.push({
      observationDate,
      observationTimestamp,
      actualValue: actual?.value ?? 0,
      targetDate,
      targetTimestamp,
      forecastValue,
      lowerBound,
      upperBound,
      forecastVersion: b.forecastVersionField
        ? text(row[b.forecastVersionField]) || null
        : null,
    });
  }
  vintages.sort(
    (a, b) =>
      a.observationTimestamp - b.observationTimestamp ||
      a.targetTimestamp - b.targetTimestamp,
  );
  if (!vintages.length) diagnostics.push("Нет валидных forecast vintages");
  const duplicate = new Set<string>();
  for (const item of vintages) {
    const key = `${item.observationDate}|${item.targetDate}`;
    if (duplicate.has(key)) diagnostics.push(`Duplicate vintage ${key}`);
    duplicate.add(key);
  }
  const requestedSelected =
    settings.observationDateMode === "selected" &&
    settings.selectedObservationDate
      ? vintages.find(
          (item) => item.observationDate === settings.selectedObservationDate,
        )
      : vintages.at(-1);
  const selected = requestedSelected || vintages.at(-1);
  if (settings.observationDateMode === "selected" && settings.selectedObservationDate && !requestedSelected && selected) {
    warnings.push(`Selected vintage ${settings.selectedObservationDate} отсутствует после фильтрации; выбран последний доступный vintage ${selected.observationDate}`);
  }
  if (diagnostics.length || !selected)
    return { diagnostics: [...new Set(diagnostics)], warnings };
  const actualSeries = (() => {
      const level = settings.timeHierarchy?.selectedLevelKey;
      const grouped = new Map<number, { date: string; timestamp: number; value: number }>();
      for (const point of [...actualByDate.values()].sort((a, b) => a.timestamp - b.timestamp)) {
        const timestamp = hierarchyPeriodTimestamp(point.timestamp, level);
        grouped.set(timestamp, { ...point, timestamp, date: hierarchyPeriodDate(timestamp, level) });
      }
      return [...grouped.values()].sort((a, b) => a.timestamp - b.timestamp);
    })(),
    absoluteDelta = selected.forecastValue - selected.actualValue,
    percentageDelta =
      selected.actualValue === 0
        ? null
        : (absoluteDelta / Math.abs(selected.actualValue)) * 100;
  return {
    model: {
      actualSeries,
      vintages,
      selected,
      unit: actualUnit,
      horizonLabel: horizonLabel(settings.horizonValue, settings.horizonUnit),
      absoluteDelta,
      percentageDelta,
      settings,
    },
    diagnostics: [],
    warnings,
  };
}

const bridgeMeasureFields = (dataset: Dataset) =>
  dataset.fields.filter(
    (field) => field.kind === "measure" && !["text", "date"].includes(field.unit),
  );
const bridgeMemberKeys = (rows: DataRow[], dimensionKey: string | null) =>
  dimensionKey
    ? [...new Set(rows.map((row) => text(row[dimensionKey])).filter(Boolean))]
    : [];
const bridgeMemberLabel = (
  dataset: Dataset,
  dimensionKey: string | null,
  memberKey: string,
  fallback: string,
) => dimensionKey === "fin_acc"
  ? DATA_ACCOUNT_LABELS[memberKey]?.text
    ? `${DATA_ACCOUNT_LABELS[memberKey].text} (${memberKey})`
    : fallback
  : fallback;

export function validateBridgeSequence(
  dataset: Dataset,
  settingsInput: BridgeSequenceConfig | undefined,
) {
  const settings = settingsInput || DEFAULT_WATERFALL_SETTINGS,
    blockingErrors: string[] = [],
    warnings: string[] = [],
    dimension = dataset.fields.find(
      (field) => field.id === settings.dimensionKey && field.kind === "dimension",
    ),
    active = settings.items
      .filter((item) => item.enabled && item.action !== "exclude")
      .sort((a, b) => a.order - b.order);
  if (!dimension) blockingErrors.push("Выберите аналитику статей");
  if (settings.toleranceValue < 0)
    blockingErrors.push("Tolerance не может быть отрицательным");
  if (new Set(settings.items.map((item) => item.id)).size !== settings.items.length)
    blockingErrors.push("Bridge sequence item id должен быть уникальным");
  if (new Set(active.map((item) => item.order)).size !== active.length)
    blockingErrors.push("Порядок активных строк должен быть уникальным");
  const openings = active.filter((item) => item.action === "opening");
  if (openings.length !== 1)
    blockingErrors.push("Bridge требует ровно одну строку Начало");
  const openingIndex = active.findIndex((item) => item.action === "opening");
  if (
    openingIndex > 0 &&
    active.slice(0, openingIndex).some((item) =>
      ["add", "subtract"].includes(item.action),
    )
  )
    blockingErrors.push("Движения до строки Начало запрещены");
  const resolvedMeasures = active.flatMap((item) => {
    if (!item.memberKey) {
      blockingErrors.push("Для каждой активной строки требуется стабильный memberKey");
      return [];
    }
    if (item.action === "opening" && !bridgeMemberKeys(dataset.rows, settings.dimensionKey).includes(item.memberKey)) {
      blockingErrors.push(`${item.displayLabel}: в транзакционных данных нет значения ${item.memberKey}`);
    } else if ((item.action === "add" || item.action === "subtract") && !bridgeMemberKeys(dataset.rows, settings.dimensionKey).includes(item.memberKey)) {
      warnings.push(`${item.displayLabel}: движение отсутствует после фильтрации, принято 0`);
    }
    if (!item.measureKey) {
      blockingErrors.push(`${item.displayLabel}: выберите показатель`);
      return [];
    }
    const measure = dataset.fields.find((field) => field.id === item.measureKey);
    if (!measure) {
      warnings.push(`${item.displayLabel}: Unresolved measure ${item.measureKey}`);
      return [];
    }
    if (measure.kind !== "measure" || ["text", "date"].includes(measure.unit)) {
      blockingErrors.push(`${item.displayLabel}: показатель должен быть числовым`);
      return [];
    }
    return [measure];
  });
  const units = [...new Set(resolvedMeasures.map((field) => field.unit))];
  if (units.length > 1)
    blockingErrors.push("Все показатели Bridge должны иметь совместимые units");
  if (!active.some((item) => item.action === "checkpoint"))
    warnings.push("Добавьте хотя бы один Контрольный итог");
  return {
    blockingErrors: [...new Set(blockingErrors)],
    warnings: [...new Set(warnings)],
  };
}

export function buildWaterfall(
  dataset: Dataset,
  rows: DataRow[],
  settingsInput: BridgeSequenceConfig | undefined,
): SpecializedResult<BridgeModel> {
  const settings: BridgeSequenceConfig = {
      ...DEFAULT_WATERFALL_SETTINGS,
      ...settingsInput,
      items: settingsInput?.items || [],
      availableMeasureKeys: settingsInput?.availableMeasureKeys || [],
    },
    validation = validateBridgeSequence(dataset, settings),
    diagnostics = [...validation.blockingErrors],
    warnings = [...validation.warnings],
    availableMemberKeys = bridgeMemberKeys(rows, settings.dimensionKey),
    availableMeasureKeys = bridgeMeasureFields(dataset).map((field) => field.id),
    configuredMembers = new Set(settings.items.map((item) => item.memberKey)),
    configuredMeasures = new Set(settings.availableMeasureKeys),
    newMemberKeys = availableMemberKeys.filter((key) => !configuredMembers.has(key)),
    newMeasureKeys = availableMeasureKeys.filter((key) => !configuredMeasures.has(key)),
    active = settings.items
      .filter((item) => item.enabled && item.action !== "exclude")
      .sort((a, b) => a.order - b.order),
    unresolvedItemIds: string[] = [],
    sourceValues = new Map<string, number | null>();
  waterfallDebug("query", { datasetId: dataset.id, datasetLabel: dataset.label, totalRows: rows.length, dimensionKey: settings.dimensionKey, pageItems: active.map((item) => ({ itemId: item.id, memberKey: item.memberKey, action: item.action, measureKey: item.measureKey })) });
  for (const item of active) {
    const itemLabel = bridgeMemberLabel(dataset, settings.dimensionKey, item.memberKey, item.displayLabel);
    const memberRows = rows.filter(
        (row) => text(row[settings.dimensionKey || ""]) === item.memberKey,
      ),
      sourceValue = aggregate(memberRows, item.measureKey, "SUM");
    if (sourceValue === null) {
      if (item.action === "checkpoint") {
        sourceValues.set(item.id, null);
        warnings.push(`${itemLabel}: используется расчётный контрольный итог`);
      } else if (item.action === "add" || item.action === "subtract") {
        sourceValues.set(item.id, null);
        warnings.push(`${itemLabel}: движение отсутствует после фильтрации, принято 0`);
      } else {
        unresolvedItemIds.push(item.id);
        warnings.push(`${itemLabel}: Значение недоступно`);
      }
    } else sourceValues.set(item.id, sourceValue);
    waterfallDebug("source", { itemId: item.id, memberKey: item.memberKey, action: item.action, measureKey: item.measureKey, matchingRows: memberRows.length, sourceValue });
  }
  if (diagnostics.length || unresolvedItemIds.length)
    return { diagnostics: [...new Set(diagnostics)], warnings: [...new Set(warnings)] };
  const checkpointIds = active
      .filter((item) => item.action === "checkpoint")
      .map((item) => item.id),
    terminalCheckpointId = checkpointIds.at(-1),
    unit = unitOf(dataset, active[0]?.measureKey),
    renderItems: BridgeRenderItem[] = [];
  let running = 0;
  for (const item of active) {
    const itemLabel = bridgeMemberLabel(dataset, settings.dimensionKey, item.memberKey, item.displayLabel);
    const sourceValue = sourceValues.get(item.id),
      before = running;
    if (sourceValue === undefined) continue;
    const numericSourceValue = sourceValue ?? 0;
    let signedValue = numericSourceValue,
      displayValue = numericSourceValue,
      after = running,
      base = 0,
      reportedValue: number | null = null,
      calculatedValue: number | null = null,
      difference: number | null = null,
      reconciliationStatus: "ok" | "warning" | null = null,
      role: BridgeRenderItem["role"] = "opening",
      valueSource: "transaction" | "calculated" | "missing" = "transaction";
    if (item.action === "opening") {
      after = numericSourceValue;
      running = after;
    } else if (item.action === "add" || item.action === "subtract") {
      if (sourceValue === null) valueSource = "missing";
      signedValue = item.action === "add" ? Math.abs(numericSourceValue) : -Math.abs(numericSourceValue);
      role = item.action === "add" ? "positive_movement" : "negative_movement";
      after = before + signedValue;
      base = Math.min(before, after);
      running = after;
    } else {
      role = "checkpoint";
      const calculated = before;
      calculatedValue = calculated;
      if (sourceValue === null) {
        valueSource = "calculated";
        signedValue = calculated;
        displayValue = calculated;
        reportedValue = null;
        difference = null;
      } else {
        reportedValue = sourceValue;
        difference = reportedValue - calculated;
        signedValue = reportedValue;
        displayValue = reportedValue;
      }
      if (sourceValue !== null && settings.validateCheckpoints) {
        const withinTolerance =
          settings.toleranceType === "absolute"
            ? Math.abs(difference ?? 0) <= settings.toleranceValue
            : calculated === 0
              ? difference === 0
              : (Math.abs(difference ?? 0) / Math.abs(calculated)) * 100 <=
                settings.toleranceValue;
        reconciliationStatus = withinTolerance ? "ok" : "warning";
        if (!withinTolerance)
          warnings.push(
            `${itemLabel}: расхождение ${(difference ?? 0).toFixed(2)} превышает tolerance`,
          );
      }
    }
    renderItems.push({
      id: item.id,
      waterfallItemId: item.id,
      memberKey: item.memberKey,
      measureKey: item.measureKey,
      label: bridgeMemberLabel(dataset, settings.dimensionKey, item.memberKey, item.displayLabel),
      measureLabel: item.measureLabel,
      role,
      signedValue,
      displayValue,
      order: item.order,
      base,
      height: Math.abs(signedValue),
      runningBefore: before,
      runningAfter: after,
      isTerminalCheckpoint: item.id === terminalCheckpointId,
      reportedValue,
      calculatedValue,
      difference,
      reconciliationStatus,
      valueSource,
      unit,
    });
    waterfallDebug("item", { itemId: item.id, label: itemLabel, role, sourceValue, calculatedValue, signedValue, displayValue, runningBefore: before, runningAfter: after, valueSource });
  }
  return {
    model: {
      items: renderItems,
      unit,
      settings,
      availableMemberKeys,
      availableMeasureKeys,
      unresolvedItemIds,
      newMemberKeys,
      newMeasureKeys,
    },
    diagnostics: [],
    warnings: [...new Set(warnings)],
  };
}
