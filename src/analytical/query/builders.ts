import type { ChartConfig, Dataset, PageFilterDefinition, PageFilterState, PivotTableConfig, RollingForecastSettings, BridgeSequenceConfig } from "../../types";
import type { AnalyticalQuery, QueryFilter } from "./types";
import { effectiveMetricAggregation } from "./metricSemantics";

const primitive = (value: unknown) => value == null ? null : typeof value === "number" || typeof value === "boolean" ? value : String(value);
export const isDashboardParameterField = (fieldId: string) => fieldId === "splitDate" || fieldId === "split-date";

const temporalKey = (field: Dataset["fields"][number]) => field.semantic?.temporalKey || (field.semantic?.dataType === "date" ? "calendar" : undefined);
const temporalGranularity = (field: Dataset["fields"][number]) => field.semantic?.granularity || (field.semantic?.inputFormats?.includes("YYYYMM") ? "month" : "day");
const compatibleTemporalRoles = new Set(["date", "calmonth"]);

const temporalRolesCompatible = (definition: PageFilterDefinition, field: Dataset["fields"][number]) => {
  const sourceRole = definition.source?.semanticRole;
  const targetRole = field.semantic?.role;
  if (!sourceRole || !targetRole) return false;
  return compatibleTemporalRoles.has(sourceRole) && compatibleTemporalRoles.has(targetRole);
};

/** Resolve a logical page date filter to the physical date field of a dataset. */
export const resolveTemporalField = (dataset: Dataset, definition: PageFilterDefinition, preferredFieldId?: string) => {
  const exact = preferredFieldId || definition.fieldId;
  const exactField = dataset.fields.find((field) => field.id === exact && field.semantic?.dataType === "date");
  if (exactField) return exactField;
  if (definition.kind !== "date-range") return undefined;
  // Cross-dataset temporal projection is semantic, never dataset-specific.
  // Legacy filters without source provenance are exact-match only, preventing
  // an old WriteCube filter from being guessed onto an unrelated dataset.
  const key = definition.temporalKey || "calendar";
  return dataset.fields.find((field) => field.semantic?.dataType === "date" && temporalKey(field) === key && temporalRolesCompatible(definition, field));
};

const compactDate = (value: string) => value.replace(/[-.]/g, "");
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Convert a user range to the canonical representation of a target physical date field. */
export const normalizeTemporalRange = (
  from: string,
  to: string,
  inputGranularity: "day" | "month",
  targetGranularity: "day" | "month",
) => {
  const normalizedFrom = compactDate(from), normalizedTo = compactDate(to);
  if (inputGranularity === "month") {
    if (!/^\d{6}$/.test(normalizedFrom) || !/^\d{6}$/.test(normalizedTo)) throw new Error("Некорректный месячный диапазон дат.");
    if (targetGranularity === "month") return { from: normalizedFrom, to: normalizedTo };
    const [fromYear, fromMonth] = [Number(normalizedFrom.slice(0, 4)), Number(normalizedFrom.slice(4, 6))];
    const [toYear, toMonth] = [Number(normalizedTo.slice(0, 4)), Number(normalizedTo.slice(4, 6))];
    return { from: `${normalizedFrom}01`, to: `${normalizedTo}${String(daysInMonth(toYear, toMonth)).padStart(2, "0")}` };
  }
  if (!/^\d{8}$/.test(normalizedFrom) || !/^\d{8}$/.test(normalizedTo)) throw new Error("Некорректный дневной диапазон дат.");
  if (targetGranularity === "day") return { from: normalizedFrom, to: normalizedTo };
  return { from: normalizedFrom.slice(0, 6), to: normalizedTo.slice(0, 6) };
};

const matchesDateFormat = (value: string, formats: string[]) => formats.some((format) =>
  format === "YYYYMM" ? /^\d{6}$/.test(value)
    : format === "YYYYMMDD" ? /^\d{8}$/.test(value)
      : format === "YYYY-MM-DD" ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        : format === "YYYY.MM.DD" ? /^\d{4}\.\d{2}\.\d{2}$/.test(value)
          : false,
);

export function queryFilters(config: ChartConfig | PivotTableConfig, pageFilters: PageFilterDefinition[], runtime: PageFilterState, dataset?: Dataset): QueryFilter[] {
  const filters: QueryFilter[] = [];
  const hasField = (fieldId: string) => !dataset || dataset.fields.some((field) => field.id === fieldId);
  if ("filters" in config) Object.entries(config.filters).forEach(([fieldId, values]) => { if (!isDashboardParameterField(fieldId) && values.length && hasField(fieldId)) filters.push({ fieldId, operator: "IN", values }); });
  pageFilters.forEach((definition) => {
    if (isDashboardParameterField(definition.fieldId)) return;
    const value = runtime[definition.fieldId] ?? definition.defaultValue;
    if (definition.kind === "categorical") {
      if (!hasField(definition.fieldId)) return;
      filters.push({ fieldId: definition.fieldId, operator: "IN", values: value as string[] });
    }
    else {
      const inputRange = value as { from?: string; to?: string };
      const from = String(inputRange?.from || "").trim();
      const to = String(inputRange?.to || "").trim();
      if (!from || !to) throw new Error(`Заполните обе границы фильтра «${dataset?.fields.find((field) => field.id === definition.fieldId)?.label || definition.fieldId}».`);
      const field = dataset ? resolveTemporalField(dataset, definition) : undefined;
      if (!field) return;
      const inputGranularity = definition.granularity || temporalGranularity(field);
      const inputFormats = inputGranularity === "month" ? ["YYYYMM"] : ["YYYYMMDD", "YYYY-MM-DD", "YYYY.MM.DD"];
      if (!matchesDateFormat(from, inputFormats) || !matchesDateFormat(to, inputFormats)) {
        throw new Error(`Фильтр «${field.label || definition.fieldId}» должен использовать формат ${inputFormats.join(", ")}.`);
      }
      const normalizedRange = normalizeTemporalRange(from, to, inputGranularity, temporalGranularity(field));
      filters.push({ fieldId: field.id, operator: "BETWEEN", from: primitive(normalizedRange.from), to: primitive(normalizedRange.to) });
    }
  });
  return filters;
}

export function chartAnalyticalQuery(dataset: Dataset, config: ChartConfig, pageFilters: PageFilterDefinition[], runtime: PageFilterState): AnalyticalQuery {
  const dimensions = [...config.viewBy, ...config.stackBy.filter((field) => !config.viewBy.includes(field))].map((fieldId) => {
    const field = dataset.fields.find((item) => item.id === fieldId);
    const presentation = config.viewByPresentation?.[fieldId];
    const hierarchy = field?.semantic?.hierarchies?.find((item) => String(item.hierarchyId) === String(presentation?.activeHierarchyId));
    return field?.semantic?.dataType === "date" && presentation?.mode === "hierarchy" && hierarchy && presentation.selectedLevelKey
      ? { fieldId, hierarchy: { hierarchyId: hierarchy.hierarchyId, levelKey: presentation.selectedLevelKey, granularity: field.semantic.granularity } }
      : { fieldId };
  });
  const timeFieldId = config.viewBy.find((fieldId) => dataset.fields.find((field) => field.id === fieldId)?.semantic?.dataType === "date");
  return {
    datasetId: dataset.id,
    dimensions,
    measures: config.metrics.map((metric) => {
      const aggregation = effectiveMetricAggregation(metric, config);
      const orderBy = aggregation === "FIRST_NON_NULL" || aggregation === "LAST_NON_NULL"
        ? (timeFieldId ? [{ fieldId: timeFieldId, direction: aggregation === "FIRST_NON_NULL" ? "asc" as const : "desc" as const }] : undefined)
        : undefined;
      return { fieldId: metric.fieldId, aggregation, orderBy };
    }),
    filters: queryFilters(config, pageFilters, runtime, dataset),
    orderBy: config.viewBy.length ? config.viewBy.map((fieldId) => ({ fieldId, direction: "asc" as const })) : undefined,
    limit: 10000,
  };
}

export function kpiAnalyticalQuery(dataset: Dataset, config: ChartConfig, pageFilters: PageFilterDefinition[], runtime: PageFilterState): AnalyticalQuery {
  const timeField = config.kpi?.timeFieldId || dataset.fields.find((field) => field.semantic?.dataType === "date")?.id;
  return { datasetId: dataset.id, dimensions: timeField ? [{ fieldId: timeField }] : [], measures: config.metrics.map((metric) => ({ fieldId: metric.fieldId, aggregation: metric.aggregation })), filters: queryFilters(config, pageFilters, runtime, dataset), orderBy: timeField ? [{ fieldId: timeField, direction: "asc" as const }] : undefined, limit: 10000 };
}

export function thresholdAnalyticalQuery(dataset: Dataset, config: ChartConfig, pageFilters: PageFilterDefinition[], runtime: PageFilterState): AnalyticalQuery | null {
  const settings = config.thresholdComparison;
  if (!settings?.measureField || !settings.differentiator?.fieldId) return null;
  return { datasetId: dataset.id, dimensions: [{ fieldId: settings.differentiator.fieldId }], measures: [{ fieldId: settings.measureField, aggregation: "SUM" }], filters: queryFilters(config, pageFilters, runtime, dataset), limit: 10000 };
}

export function rollingAnalyticalQuery(dataset: Dataset, settings: RollingForecastSettings, pageFilters: PageFilterDefinition[], runtime: PageFilterState, source: "forecast" | "actual"): AnalyticalQuery | null {
  const bindings = settings.bindings;
  const dateField = source === "forecast" ? bindings.targetDateField : bindings.observationDateField;
  const valueField = source === "forecast" ? bindings.forecastValueField : bindings.actualValueField;
  if (!dateField || !valueField) return null;
  const dimensions = [dateField, ...(source === "forecast" && bindings.forecastVersionField ? [bindings.forecastVersionField] : [])];
  const measures = [{ fieldId: valueField, aggregation: "SUM" as const }];
  if (source === "forecast" && bindings.lowerBoundField) measures.push({ fieldId: bindings.lowerBoundField, aggregation: "SUM" as const });
  if (source === "forecast" && bindings.upperBoundField) measures.push({ fieldId: bindings.upperBoundField, aggregation: "SUM" as const });
  const filters: QueryFilter[] = [];
  pageFilters.forEach((definition) => {
    if (isDashboardParameterField(definition.fieldId)) return;
    const scope = definition.scope?.type || "page";
    if (scope !== "page" && scope !== source && scope !== "both") return;
    const preferredFieldId = source === "forecast" ? definition.scope?.forecastFieldId || definition.scope?.fieldId : definition.scope?.actualFieldId || definition.scope?.fieldId;
    const temporalField = definition.kind === "date-range" ? resolveTemporalField(dataset, definition, preferredFieldId) : undefined;
    const fieldId = temporalField?.id || preferredFieldId || definition.fieldId;
    if (!dataset.fields.some((field) => field.id === fieldId) && !temporalField) return;
    const value = runtime[definition.fieldId] ?? definition.defaultValue;
    if (definition.kind === "categorical") filters.push({ fieldId, operator: "IN", values: value as string[] });
    else {
      const inputRange = value as { from?: string; to?: string };
      const from = String(inputRange?.from || "").trim();
      const to = String(inputRange?.to || "").trim();
      if (!from || !to) throw new Error(`Заполните обе границы фильтра «${dataset?.fields.find((field) => field.id === fieldId)?.label || fieldId}».`);
      const field = temporalField || dataset?.fields.find((item) => item.id === fieldId);
      const inputGranularity = definition.granularity || temporalGranularity(field!);
      const inputFormats = inputGranularity === "month" ? ["YYYYMM"] : ["YYYYMMDD", "YYYY-MM-DD", "YYYY.MM.DD"];
      if (!matchesDateFormat(from, inputFormats) || !matchesDateFormat(to, inputFormats)) {
        throw new Error(`Фильтр «${field?.label || fieldId}» должен использовать формат ${inputFormats.join(", ")}.`);
      }
      const normalizedRange = normalizeTemporalRange(from, to, inputGranularity, temporalGranularity(field!));
      filters.push({ fieldId, operator: "BETWEEN", from: primitive(normalizedRange.from), to: primitive(normalizedRange.to) });
    }
  });
  settings.filters.filter((filter) => filter.source === source || filter.source === "both").forEach((filter) => {
    if (dataset.fields.some((field) => field.id === filter.fieldId)) filters.push(filter.kind === "categorical" ? { fieldId: filter.fieldId, operator: "IN", values: Array.isArray(filter.value) ? filter.value : [] } : { fieldId: filter.fieldId, operator: "BETWEEN", from: primitive((filter.value as { from?: string })?.from), to: primitive((filter.value as { to?: string })?.to) });
  });
  return { datasetId: dataset.id, dimensions: dimensions.map((fieldId) => ({ fieldId })), measures, filters, orderBy: [{ fieldId: dateField, direction: "asc" }], limit: 50000 };
}

export function waterfallAnalyticalQuery(dataset: Dataset, config: BridgeSequenceConfig, pageFilters: PageFilterDefinition[], runtime: PageFilterState, chartConfig: ChartConfig): AnalyticalQuery | null {
  if (!config.dimensionKey) return null;
  const measureFields = [...new Set(config.items.filter((item) => item.enabled && item.action !== "exclude").map((item) => item.measureKey).filter(Boolean))];
  if (!measureFields.length) return null;
  return { datasetId: dataset.id, dimensions: [{ fieldId: config.dimensionKey }], measures: measureFields.map((fieldId) => ({ fieldId, aggregation: "SUM" as const })), filters: queryFilters(chartConfig, pageFilters, runtime, dataset), limit: 50000 };
}

export function pivotAnalyticalQuery(dataset: Dataset, config: PivotTableConfig, pageFilters: PageFilterDefinition[], runtime: PageFilterState): AnalyticalQuery {
  return { datasetId: dataset.id, dimensions: [...config.rows, ...config.columns].map((fieldId) => ({ fieldId })), measures: config.aggregations.filter((item) => item.visible).map((item) => ({ fieldId: item.measureField, aggregation: item.operation })), filters: queryFilters(config as never, pageFilters, runtime, dataset), orderBy: config.rows.map((fieldId) => ({ fieldId, direction: "asc" as const })), limit: 50000 };
}
