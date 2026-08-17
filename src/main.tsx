import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Activity,
  BadgePercent,
  BookOpen,
  BarChart3,
  Database,
  ChartBarStacked,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  ChartSpline,
  CalendarDays,
  CalendarClock,
  FolderTree,
  Clock3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Filter,
  GripVertical,
  Hash,
  House,
  Info,
  Layers3,
  Pencil,
  Gauge,
  Grid2X2,
  PanelsTopLeft,
  Package,
  Presentation,
  Plus,
  Save,
  Search,
  Sigma,
  Settings2,
  Rocket,
  RotateCcw,
  Folder,
  Trash2,
  Undo2,
  X,
  Target,
  Table2,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { DATASETS, datasetList } from "./data/datasets";
import { DEFAULT_CONFIG, DEFAULT_PAGES, DEFAULT_PIE_SETTINGS } from "./config/presets";
import {
  isValidSplitDate,
  makeDashboard,
  migrateDashboard,
  normalizeSplitDateInput,
} from "./config/dashboard";
import {
  availableFilterValues,
  validateConfig,
} from "./query/queryEngine";
import { ChartRenderer } from "./components/ChartRenderer";
import { DashboardCanvas } from "./components/DashboardCanvas";
import { DEFAULT_TEXT_CONTENT, TextWidget } from "./components/TextWidget";
import { DynamicMarkdownWidget, type MarkdownContext, type MarkdownFieldValue, type MarkdownRow } from "./components/DynamicMarkdownWidget";
import { PageHeader } from "./components/PageHeader";
import { PivotTableWidget } from "./components/PivotTableWidget";
import { BuilderSelector } from "./components/BuilderSelector";
import { SpecializedMapping } from "./components/SpecializedMapping";
import {
  bindSpecializedField,
  bucketAccepts as bucketAcceptsSpecialized,
  chartTypeCompatible,
  ensureSpecializedConfig,
  specializedChart,
  type SpecializedBucketId,
} from "./config/specializedConfig";
import type {
  ActualForecastSettings,
  BuilderDashboard,
  BuilderPage,
  ChartConfig,
  ChartModel,
  ChartType,
  Dataset,
  DataRow,
  DashboardParameters,
  DatasetId,
  FieldMeta,
  PageFilterDefinition,
  PageFilterState,
  PageFilterValue,
  PieSettings,
  SeriesRenderType,
  SeriesTimeRole,
  HierarchyAggregation,
  TimeHierarchyPresentation,
  TimeHierarchyDefinition,
  ResponsiveLayouts,
  DashboardWidget,
  PageHeaderConfig,
  PivotTableConfig,
  PivotConditionalFormatting,
  PivotDataBar,
  PivotHeatmapConfig,
  MarkdownWidgetConfig,
} from "./types";
import {
  smallMultiplesSyncEnabled,
  toggleSmallMultiplesSync,
} from "./query/smallMultiples";
import { UI_IDS, ui } from "./uiIds";
import { catalogGroups, datasetSemanticMeta } from "./semantic/businessCatalog";
import { createDefaultPivotConfig, pivotHeatmapRange, type PivotTableModel } from "./query/pivotQuery";
import { DatasetRegistry } from "./analytical/datasets/DatasetRegistry";
import { QueryController } from "./analytical/runtime/QueryController";
import { ApplicationAnalyticalClient } from "./analytical/runtime/ApplicationAnalyticalClient";
import { DatasetMetadataService } from "./analytical/metadata/DatasetMetadataService";
import { datasetDefinition } from "./analytical/datasets/definitions";
import { validateAndNormalizeCsv } from "./analytical/datasets/formatValidator";
import { chartAnalyticalQuery, kpiAnalyticalQuery, pivotAnalyticalQuery, queryFilters, resolveTemporalField, rollingAnalyticalQuery, thresholdAnalyticalQuery, waterfallAnalyticalQuery } from "./analytical/query/builders";
import { chartModelFromQueryResult, kpiModelFromQueryResult, normalizeWaterfallQueryResult, pivotModelFromQueryResults, serializeQueryValue } from "./analytical/adapters";
import { planPivotQueries } from "./analytical/pivot/PivotQueryPlanner";
import type { ComposedDatasetDefinition, CsvDatasetDefinition, QueryResult } from "./analytical/query/types";
import { transportKey } from "./analytical/query/transport";
import { buildRollingForecast, buildThresholdComparison, buildWaterfall, DEFAULT_ROLLING_SETTINGS } from "./query/specializedCharts";
import { resolveActualForecast } from "./query/actualForecast";
import { CatalogWorkspace, type CatalogEntityRef } from "./components/CatalogWorkspace";
import i18n, { setStoredLocale } from "./i18n";
import { useTranslation } from "react-i18next";
import "./styles.css";
import "./builder.css";
import "./builder-controls.css";
import "./filter-controls.css";
import "./catalog-filter-controls.css";
import "./event-controls.css";
import "./specialized-charts.css";

const DUCKDB_CHART_TYPES = new Set<ChartType>([
  // All generic renderers consume the same ChartModel produced from the
  // analytical result.  Keeping this list exhaustive prevents a chart from
  // silently falling back to the legacy in-memory query path.
  "column", "line", "pie", "time-series-events", "stacked-column", "combo",
  "bullet", "kpi", "heatmap", "table", "small-multiples",
  "threshold-comparison", "rolling-forecast", "waterfall",
]);
const isDuckDbChart = (chartType?: ChartType) => Boolean(chartType && DUCKDB_CHART_TYPES.has(chartType));
const emptyChartModel = (message = "Ожидание результата аналитического запроса"): ChartModel => ({
  data: [], series: [], categories: [], events: [], eventCategories: [], diagnostics: [], warnings: [message],
});

function LanguageSwitcher() {
  const { t } = useTranslation("common");
  const locale = i18n.language.startsWith("en") ? "en" : "ru";
  return (
    <div {...ui(UI_IDS.localeSwitcher)} className="locale-switcher" aria-label={t("languageSwitcher")}>
      <button {...ui(UI_IDS.localeOption("ru"))} type="button" aria-pressed={locale === "ru"} onClick={() => setStoredLocale("ru")}>RU</button>
      <button {...ui(UI_IDS.localeOption("en"))} type="button" aria-pressed={locale === "en"} onClick={() => setStoredLocale("en")}>EN</button>
    </div>
  );
}

const isConfigurableWidget = (widget: DashboardWidget | undefined): widget is DashboardWidget & { type: "chart" | "kpi" | "table" } =>
  Boolean(widget && (widget.type === "chart" || widget.type === "kpi" || widget.type === "table"));

function EventsMapping({
  dataset,
  config,
  model,
  dispatch,
}: {
  dataset: (typeof DATASETS)[DatasetId];
  config: ChartConfig;
  model: ChartModel;
  dispatch: React.Dispatch<Action>;
}) {
  const projection = dataset.eventProjection;
  const connected = Boolean(config.eventFields.length);
  return (
    <section
      {...ui(UI_IDS.mapping.bucket("events"))}
      className="builder-bucket"
    >
      <header>
        <b>Events</b>
        <small>Annotation layer</small>
      </header>
      {!projection ? (
        <p>Для dataset нет event projection</p>
      ) : !connected ? (
        <button
          {...ui(UI_IDS.builder.eventsConnect)}
          className="connect-events"
          onClick={() =>
            dispatch({
              type: "event-connect",
              fields: projection.categories.map((category) => category.key),
            })
          }
        >
          <Plus />
          Подключить lifecycle events
        </button>
      ) : (
        <div className="event-source">
          <header>
            <span>
              {projection.commentSource} · {model.events.length} событий
            </span>
            <button
              {...ui(UI_IDS.builder.eventsDisconnect)}
              type="button"
              aria-label="Отключить события"
              onClick={() => dispatch({ type: "event-disconnect" })}
            >
              <Trash2 />
            </button>
          </header>
          <div className="event-category-list">
            {projection.categories
              .filter((category) => config.eventFields.includes(category.key))
              .map((category) => {
                const visible =
                  config.eventCategoryVisibility[category.key] !== false;
                return (
                  <button
                    {...ui(UI_IDS.eventCategory(category.key))}
                    key={category.key}
                    type="button"
                    aria-pressed={visible}
                    onClick={() =>
                      dispatch({ type: "event-category", id: category.key })
                    }
                  >
                    <i style={{ background: category.color }} />
                    {category.label}
                    <small>{visible ? "Видимо" : "Скрыто"}</small>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </section>
  );
}

type BuilderChartType = ChartType | "pivot-table" | "markdown";
const chartTypes: { id: BuilderChartType; label: string; hint: string }[] = [
  ["column", "Столбцы", "Сравнение категорий"],
  ["line", "Линия", "Тренд во времени"],
  ["pie", "Круговая", "Структура портфеля"],
  ["time-series-events", "Время + события", "Динамика и события"],
  ["stacked-column", "Накопительные", "Структура по периодам"],
  ["combo", "Combo", "Движения, остаток и ставка"],
  [
    "threshold-comparison",
    "Threshold Comparison",
    "Факт против плана и пороговых зон",
  ],
  ["waterfall", "Bridge / Waterfall", "Движение показателя и контрольные итоги"],
  [
    "rolling-forecast",
    "Rolling Forecast",
    "Analyst target и диапазон прогноза",
  ],
  ["bullet", "Bullet", "Факт к цели"],
  ["kpi", "KPI", "Ключевые значения"],
  ["heatmap", "Heatmap", "Концентрация"],
  ["table", "Таблица", "Точные значения"],
  ["small-multiples", "Small multiples", "Синхронные показатели"],
  ["pivot-table", "Pivot Table", "Интерактивная сводная таблица"],
  ["markdown", "Markdown visualization", "Динамический контент из Table или Pivot Table"],
].map(([id, label, hint]) => ({ id: id as BuilderChartType, label, hint }));

const chartTypeIcons = {
  column: BarChart3,
  line: ChartLine,
  pie: ChartPie,
  "time-series-events": Activity,
  "stacked-column": ChartBarStacked,
  combo: ChartNoAxesCombined,
  waterfall: Layers3,
  "threshold-comparison": Target,
  "rolling-forecast": ChartSpline,
  bullet: Gauge,
  kpi: BadgePercent,
  heatmap: Grid2X2,
  table: Table2,
  "small-multiples": PanelsTopLeft,
} satisfies Record<ChartType, LucideIcon>;

function ChartTypeIcon({ type }: { type: ChartType }) {
  const Icon = chartTypeIcons[type] ?? BarChart3;
  return <Icon className="chart-type-icon" aria-hidden="true" focusable="false" />;
}
const markdownValue = (raw: unknown, label?: string): MarkdownFieldValue => { let scalar = raw; if (typeof scalar === "string" && /^\s*\[\s*"/.test(scalar)) { try { const parsed = JSON.parse(scalar); scalar = Array.isArray(parsed) ? parsed.length <= 1 ? parsed[0] : parsed.join(", ") : parsed; } catch {} } if (Array.isArray(scalar)) scalar = scalar.length <= 1 ? scalar[0] : scalar.join(", "); return { raw: scalar ?? "", formatted: scalar == null || scalar === "" ? "—" : String(label ?? scalar), label: String(label ?? scalar ?? "—") }; };
const markdownContextFromChart = (model: ChartModel, dimensionId = "Category"): MarkdownContext => {
  const series = model.series.filter((item) => item.visible);
  const rows = model.data.map((item) => ({ fields: { [dimensionId]: markdownValue(item.categoryKey, item.categoryLabel), Category: markdownValue(item.categoryKey, item.categoryLabel), category: markdownValue(item.categoryKey, item.categoryLabel) }, values: Object.fromEntries(series.map((s) => [s.label, markdownValue(item[s.dataKey], item[s.dataKey] == null ? "—" : String(item[s.dataKey]))])), row_total: {} }));
  return { rows, columns: series.map((s) => markdownValue(s.id, s.label)), values: series.map((s) => markdownValue(s.id, s.label)), col_totals: {}, grand_totals: {} };
};
const markdownContextFromPivot = (model: PivotTableModel, config: PivotTableConfig): MarkdownContext => {
  const rows = model.rows.map((row) => { const values = Object.fromEntries(config.aggregations.map((aggregation) => { const cell = model.cells.find((item) => item.rowId === row.id && item.aggregationId === aggregation.id); return [aggregation.label, markdownValue(cell?.value, cell?.value == null ? "—" : String(cell.value))]; })); return { fields: Object.fromEntries(row.labels.map((label, index) => [`Level ${index + 1}`, markdownValue(label)])), values, row_total: values }; });
  return { rows, columns: model.columns.map((column) => markdownValue(column.id, column.labels.join(" / "))), values: config.aggregations.map((aggregation) => markdownValue(aggregation.id, aggregation.label)), col_totals: {}, grand_totals: {} };
};
type Action =
  | { type: "set"; config: ChartConfig }
  | { type: "dataset"; id: DatasetId }
  | { type: "chart"; chartType: ChartType }
  | { type: "add"; bucket: "viewBy" | "stackBy" | "metrics"; field: FieldMeta }
  | { type: "remove"; bucket: "viewBy" | "stackBy" | "metrics"; id: string }
  | { type: "agg"; id: string }
  | { type: "filter"; field: string; value: string }
  | { type: "series-visibility"; id: string }
  | { type: "series-color"; id: string; color: string }
  | { type: "series-time-role"; id: string; timeRole: SeriesTimeRole }
  | { type: "actual-forecast"; patch: Partial<ActualForecastSettings> }
  | { type: "metric-type"; id: string; seriesType: SeriesRenderType }
  | { type: "metric-axis"; id: string; yAxisId: "left" | "right" }
  | { type: "dual-axis" }
  | { type: "event-connect"; fields: string[] }
  | { type: "event-disconnect" }
  | { type: "event-category"; id: string }
  | { type: "reset" };
export function reducer(s: ChartConfig, a: Action): ChartConfig {
  if (a.type === "set") return structuredClone(a.config);
  if (a.type === "reset") return structuredClone(DEFAULT_CONFIG);
  if (a.type === "dataset")
    return {
      ...structuredClone(s),
      datasetId: a.id,
    };
  if (a.type === "chart") {
    if (a.chartType !== "combo")
      return ensureSpecializedConfig(s, a.chartType);
    return {
      ...s,
      chartType: "combo",
      dualAxisEnabled: s.dualAxisEnabled ?? true,
      metrics: s.metrics.map((m, i) => ({
        ...m,
        seriesType: m.seriesType || (i === 0 ? "column" : "line"),
      })),
    };
  }
  if (a.type === "add") {
    if (a.bucket === "metrics") {
      if (s.metrics.some((x) => x.fieldId === a.field.id)) return s;
      const index = s.metrics.length;
      const metrics = [
        ...s.metrics,
        {
          fieldId: a.field.id,
          aggregation: "SUM" as const,
          yAxisId: (index === 1 ? "right" : "left") as "left" | "right",
          seriesType: (index === 0 ? "column" : "line") as SeriesRenderType,
        },
      ];
      return {
        ...s,
        metrics,
        dualAxisEnabled: metrics.length > 1,
        chartType:
          metrics.length > 1
            ? "combo"
            : s.viewBy.length
              ? s.viewBy.some(
                  (x) =>
                    x.includes("date") ||
                    x.includes("period") ||
                    x.includes("month"),
                )
                ? "line"
                : "column"
              : "kpi",
      };
    }
    if (s[a.bucket].includes(a.field.id)) return s;
    const values = [...s[a.bucket], a.field.id];
    const chartType =
      a.bucket === "viewBy"
        ? values.length === 2 && s.metrics.length === 1
          ? "heatmap"
          : a.field.unit === "date"
            ? "line"
            : "column"
        : a.bucket === "stackBy" && s.metrics.length === 1
          ? "stacked-column"
          : s.chartType;
    return { ...s, [a.bucket]: values, chartType };
  }
  if (a.type === "remove")
    return a.bucket === "metrics"
      ? { ...s, metrics: s.metrics.filter((x) => x.fieldId !== a.id) }
      : { ...s, [a.bucket]: s[a.bucket].filter((x) => x !== a.id), viewByPresentation: a.bucket === "viewBy" ? Object.fromEntries(Object.entries(s.viewByPresentation || {}).filter(([fieldId]) => fieldId !== a.id)) : s.viewByPresentation };
  if (a.type === "agg") {
    const cycle = ["SUM", "AVG", "MIN", "MAX", "COUNT"] as const;
    return {
      ...s,
      metrics: s.metrics.map((m) =>
        m.fieldId === a.id
          ? {
              ...m,
              aggregation:
                cycle[(cycle.indexOf(m.aggregation as (typeof cycle)[number]) + 1) % cycle.length],
            }
          : m,
      ),
    };
  }
  if (a.type === "filter") {
    const selected = s.filters[a.field] || [];
    return {
      ...s,
      filters: {
        ...s.filters,
        [a.field]: selected.includes(a.value)
          ? selected.filter((x) => x !== a.value)
          : [...selected, a.value],
      },
    };
  }
  if (a.type === "series-visibility") {
    const current = s.seriesSettings[a.id] || { visible: true, order: 0 };
    return {
      ...s,
      seriesSettings: {
        ...s.seriesSettings,
        [a.id]: { ...current, visible: !current.visible },
      },
    };
  }
  if (a.type === "series-color") {
    const current = s.seriesSettings[a.id] || { visible: true, order: 0 };
    return {
      ...s,
      seriesSettings: {
        ...s.seriesSettings,
        [a.id]: { ...current, color: a.color },
      },
    };
  }
  if (a.type === "series-time-role") {
    const current = s.seriesSettings[a.id] || { visible: true, order: 0 };
    return {
      ...s,
      seriesSettings: {
        ...s.seriesSettings,
        [a.id]: { ...current, timeRole: a.timeRole },
      },
    };
  }
  if (a.type === "actual-forecast")
    return {
      ...s,
      actualForecast: {
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
        ...s.actualForecast,
        ...a.patch,
      },
    };
  if (a.type === "metric-type")
    return {
      ...s,
      metrics: s.metrics.map((m) =>
        m.fieldId === a.id ? { ...m, seriesType: a.seriesType } : m,
      ),
    };
  if (a.type === "metric-axis") {
    const metric = s.metrics.find((m) => m.fieldId === a.id);
    if (!metric || metric.yAxisId === a.yAxisId) return s;
    if (
      s.dualAxisEnabled &&
      s.metrics.filter((m) => m.yAxisId === metric.yAxisId).length === 1
    )
      return s;
    return {
      ...s,
      metrics: s.metrics.map((m) =>
        m.fieldId === a.id ? { ...m, yAxisId: a.yAxisId } : m,
      ),
    };
  }
  if (a.type === "dual-axis") {
    if (s.dualAxisEnabled) return { ...s, dualAxisEnabled: false };
    let metrics = s.metrics;
    if (metrics.length >= 2 && !metrics.some((m) => m.yAxisId === "right"))
      metrics = metrics.map((m, i) =>
        i === 1 ? { ...m, yAxisId: "right" } : m,
      );
    if (metrics.length >= 2 && !metrics.some((m) => m.yAxisId === "left"))
      metrics = metrics.map((m, i) =>
        i === 0 ? { ...m, yAxisId: "left" } : m,
      );
    return { ...s, metrics, dualAxisEnabled: true };
  }
  if (a.type === "event-connect")
    return {
      ...s,
      eventFields: a.fields,
      eventCategoryVisibility: Object.fromEntries(
        a.fields.map((field) => [field, true]),
      ),
      chartType: "time-series-events",
    };
  if (a.type === "event-disconnect")
    return { ...s, eventFields: [], eventCategoryVisibility: {} };
  if (a.type === "event-category")
    return {
      ...s,
      eventCategoryVisibility: {
        ...s.eventCategoryVisibility,
        [a.id]: s.eventCategoryVisibility[a.id] === false,
      },
    };
  return s;
}
function DraggableField({
  field,
  onAdd,
  isFilter,
  onFilterToggle,
  readOnly = false,
}: {
  field: FieldMeta;
  onAdd?: (anchor: HTMLElement) => void;
  isFilter: boolean;
  onFilterToggle?: () => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `field:${field.id}`,
    data: { field },
    disabled: readOnly,
  });
  return (
    <div
      {...ui(UI_IDS.builder.field(field.id))}
      ref={setNodeRef}
      className="builder-field"
      style={{
        transform: transform
          ? `translate3d(${transform.x}px,${transform.y}px,0)`
          : undefined,
      }}
    >
      <button
        className="builder-field-main"
        {...(!readOnly ? attributes : {})}
        {...(!readOnly ? listeners : {})}
        title={field.semanticDiagnostic}
        onDoubleClick={readOnly ? undefined : () => onAdd?.(document.body)}
      >
        <GripVertical />
        <span className={`builder-field-semantic-icon ${field.kind} ${field.semantic?.referenceId ? "reference" : ""}`} aria-hidden="true">
          {field.semantic?.referenceId ? <BookOpen /> : field.kind === "measure" ? <Sigma /> : field.semantic?.dataType === "date" ? <CalendarClock /> : <Tag />}
        </span>
        <span>
          <b>
            {field.label}
            {field.semanticDiagnostic && " ⚠"}
          </b>
          <small>
            {field.semantic?.role || field.id} ·{" "}
            {field.semantic?.dataType === "date" ? `${field.semantic?.granularity === "month" ? "Месяц" : "День"} · ${field.semantic?.outputFormat || field.semantic?.inputFormats?.[0] || (field.semantic?.granularity === "month" ? "YYYYMM" : "YYYYMMDD")}` : field.semantic?.granularity || field.unit}
          </small>
        </span>
      </button>
      {!readOnly && field.kind === "dimension" && (
        <button
          {...ui(UI_IDS.catalog.filterToggle(field.id))}
          type="button"
          className={
            "builder-field-filter " + (isFilter ? "active-filter" : "")
          }
          aria-label={`${isFilter ? "Убрать" : "Добавить"} ${field.label} ${isFilter ? "из" : "в"} фильтры страницы`}
          aria-pressed={isFilter}
          title={
            isFilter
              ? "Убрать из фильтров страницы"
              : "Добавить в фильтры страницы"
          }
          onClick={onFilterToggle}
        >
          <Filter />
        </button>
      )}
      {!readOnly && <button
        type="button"
        className="builder-field-add"
        aria-label={`Добавить ${field.label} на график`}
        onClick={() => onAdd?.(document.body)}
      >
        <Plus />
      </button>}
    </div>
  );
}
function Bucket({
  id,
  title,
  items,
  onRemove,
  onAgg,
  onFilterToggle,
  onAdd,
  onTimePresentation,
  onTimeToggle,
  onMetricFormatting,
  onMetricConditional,
  onMetricBars,
  onMetricHeatmap,
}: {
  id: "viewBy" | "stackBy" | "metrics";
  title: string;
  items: { id: string; label: string; agg?: string; isFilter?: boolean; formattingStatus?: string; conditionalCount?: number; barsStatus?: string; heatmapStatus?: string; time?: { presentation: TimeHierarchyPresentation; hierarchies: TimeHierarchyDefinition[] } }[];
  onRemove: (id: string) => void;
  onAgg?: (id: string) => void;
  onFilterToggle?: (id: string) => void;
  onAdd?: (anchor: HTMLElement) => void;
  onTimePresentation?: (fieldId: string, presentation: TimeHierarchyPresentation) => void;
  onTimeToggle?: (fieldId: string) => void;
  onMetricFormatting?: (id: string) => void;
  onMetricConditional?: (id: string) => void;
  onMetricBars?: (id: string) => void;
  onMetricHeatmap?: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `bucket:${id}` });
  return (
    <section
      {...ui(UI_IDS.mapping.bucket(id))}
      ref={setNodeRef}
      className={"builder-bucket " + (isOver ? "over" : "")}
    >
      <header>
        <b>{title}</b>
        <span className="bucket-header-actions">
          <small>{id === "metrics" ? "Measures" : "Dimensions"}</small>
          {onAdd && <button {...ui(UI_IDS.mapping.bucketAdd(id))} type="button" className="bucket-add" aria-label={`Добавить поле в ${title}`} onClick={(event) => onAdd(event.currentTarget)}><Plus /></button>}
        </span>
      </header>
      {items.length ? (
        items.map((x) => (
          <div className="mapped-token" key={x.id}>
            <div className="mapped-token-main">
            {x.agg && <button onClick={() => onAgg?.(x.id)}>{x.agg}</button>}
            <span>{x.label}</span>
            {x.agg && onMetricFormatting && <button type="button" {...ui(`mapping.pivot.metric.${x.id}.formatting`)} className={`mapped-token-action pivot-command-icon ${x.formattingStatus && x.formattingStatus !== "Настроить формат" ? "active-filter" : ""}`} aria-label={`Формат показателя ${x.label}`} title={x.formattingStatus || "Настроить формат"} onClick={() => onMetricFormatting(x.id)}><span className="material-symbols-outlined" aria-hidden="true">123</span></button>}
            {x.agg && onMetricConditional && <button type="button" {...ui(`mapping.pivot.metric.${x.id}.conditional-formatting`)} className={`mapped-token-action pivot-command-icon ${x.conditionalCount ? "active-filter" : ""}`} aria-label={`Условное форматирование ${x.label}`} title={x.conditionalCount ? `${x.conditionalCount} правил` : "Условное форматирование"} onClick={() => onMetricConditional(x.id)}><span className="material-symbols-outlined" aria-hidden="true">format_color_fill</span>{x.conditionalCount ? <em>{x.conditionalCount}</em> : null}</button>}
            {x.agg && onMetricBars && <button type="button" {...ui(`mapping.pivot.metric.${x.id}.data-bars`)} className={`mapped-token-action pivot-command-icon ${x.barsStatus && x.barsStatus !== "Не настроено" ? "active-filter" : ""}`} aria-label={`Data bars ${x.label}`} title={x.barsStatus || "Data bars"} onClick={() => onMetricBars(x.id)}><span className="material-symbols-outlined" aria-hidden="true">stacked_bar_chart</span></button>}
            {x.agg && onMetricHeatmap && <button type="button" {...ui(`mapping.pivot.metric.${x.id}.heatmap`)} className={`mapped-token-action pivot-command-icon ${x.heatmapStatus ? "active-filter" : ""}`} aria-label={`Heatmap ${x.label}`} title={x.heatmapStatus || "Heatmap"} onClick={() => onMetricHeatmap(x.id)}><span className="material-symbols-outlined" aria-hidden="true">gradient</span></button>}
            {x.time && onTimeToggle && <button type="button" {...ui(UI_IDS.mapping.hierarchyToggle(x.id))} className={`mapped-token-action ${x.time.presentation.mode === "hierarchy" ? "active-filter" : ""}`} aria-label={`${x.time.presentation.mode === "hierarchy" ? "Выключить" : "Включить"} временную иерархию для ${x.label}`} aria-pressed={x.time.presentation.mode === "hierarchy"} title={x.time.presentation.mode === "hierarchy" ? "Выключить временную иерархию" : "Включить временную иерархию"} onClick={() => onTimeToggle(x.id)}><FolderTree /></button>}
            {onFilterToggle && (
              <button
                {...ui(UI_IDS.mapping.filterToggle(x.id))}
                className={`mapped-token-action ${x.isFilter ? "active-filter" : ""}`}
                aria-label={`${x.isFilter ? "Убрать" : "Добавить"} ${x.label} ${x.isFilter ? "из" : "в"} фильтры страницы`}
                aria-pressed={x.isFilter}
                title={
                  x.isFilter
                    ? "Убрать из фильтров страницы"
                    : "Добавить в фильтры страницы"
                }
                onClick={() => onFilterToggle(x.id)}
              >
                <Filter />
              </button>
            )}
            <button
              className="mapped-token-action"
              aria-label={`Удалить ${x.label}`}
              onClick={() => onRemove(x.id)}
            >
              <Trash2 />
            </button>
            </div>
            {x.time?.presentation.mode === "hierarchy" && x.time.hierarchies?.length && onTimePresentation && <div className="mapped-token-time-settings"><BuilderSelector uiId={`mapping.viewby.${x.id}.hierarchy`} label="" value={String(x.time.presentation.activeHierarchyId)} ariaLabel={`Иерархия для ${x.label}`} options={x.time.hierarchies.map((hierarchy) => ({ id: String(hierarchy.hierarchyId), label: hierarchy.displayLabel, meta: `${hierarchy.levels.length} уровней` }))} onChange={(selected) => { const hierarchy = x.time?.hierarchies?.find((item) => String(item.hierarchyId) === selected); onTimePresentation(x.id, { mode: "hierarchy", activeHierarchyId: hierarchy?.hierarchyId ?? null, selectedLevelKey: hierarchy?.defaultLevelKey || hierarchy?.levels[0]?.levelKey || null }); }} /></div>}
          </div>
        ))
      ) : (
        <p>Перетащите поле сюда</p>
      )}
    </section>
  );
}
const SERIES_COLORS = [
  "#0f8278",
  "#263b56",
  "#c58936",
  "#6f8294",
  "#925f55",
  "#53736a",
  "#977b9c",
  "#a65c36",
];
const TIME_ROLE_OPTIONS: Array<[SeriesTimeRole, string]> = [
  ["actual", "Факт"],
  ["forecast", "Прогноз"],
  ["plan", "План"],
  ["scenario", "Сценарий"],
  ["unknown", "Не задано"],
];
const ACTUAL_FORECAST_ROLE_OPTIONS: Array<[SeriesTimeRole, string]> =
  TIME_ROLE_OPTIONS.filter(([value]) => value !== "scenario");
function TimeHierarchySwitcher({ config, dataset, dispatch }: { config: ChartConfig; dataset: (typeof DATASETS)[DatasetId]; dispatch: React.Dispatch<Action> }) {
  const { t } = useTranslation("common");
  const supported = ["line", "time-series-events", "rolling-forecast", "column", "combo", "stacked-column", "small-multiples"].includes(config.chartType);
  const rolling = config.chartType === "rolling-forecast";
  const rollingDataset = rolling
    ? (config.rollingForecast?.forecastDatasetId && DATASETS[config.rollingForecast.forecastDatasetId]) || DATASETS.key_rate_forecast
    : dataset;
  const fieldId = rolling ? config.rollingForecast?.bindings.targetDateField || null : config.viewBy.find((id) => dataset.fields.find((field) => field.id === id)?.semantic?.dataType === "date");
  const field = fieldId ? rollingDataset.fields.find((item) => item.id === fieldId) : undefined;
  const fallbackHierarchy = field?.semantic?.hierarchies?.[0];
  const rollingPresentation = config.rollingForecast?.timeHierarchy;
  const presentation = rolling
    ? { mode: "hierarchy" as const, activeHierarchyId: rollingPresentation?.activeHierarchyId ?? fallbackHierarchy?.hierarchyId ?? null, selectedLevelKey: rollingPresentation?.selectedLevelKey ?? fallbackHierarchy?.defaultLevelKey ?? fallbackHierarchy?.levels[0]?.levelKey ?? null }
    : fieldId ? config.viewByPresentation?.[fieldId] : undefined;
  if (!supported || !fieldId || !field?.semantic?.hierarchies?.length || presentation?.mode !== "hierarchy") return null;
  const hierarchy = field.semantic.hierarchies.find((item) => String(item.hierarchyId) === String(presentation.activeHierarchyId));
  if (!hierarchy) return null;
  return <div className="time-hierarchy-switcher" data-ui-id="chart.time-hierarchy.switcher" role="group" aria-label={t("timeHierarchy.switcherLabel")}>{hierarchy.levels.map((level) => <button key={level.levelKey} type="button" data-ui-id={`chart.time-hierarchy.level.${level.levelKey}`} aria-pressed={presentation.selectedLevelKey === level.levelKey} className={presentation.selectedLevelKey === level.levelKey ? "active" : ""} onClick={() => dispatch({ type: "set", config: rolling ? { ...config, rollingForecast: { ...config.rollingForecast!, timeHierarchy: { ...presentation, activeHierarchyId: hierarchy.hierarchyId, selectedLevelKey: level.levelKey } } } : { ...config, viewByPresentation: { ...(config.viewByPresentation || {}), [fieldId]: { ...presentation, selectedLevelKey: level.levelKey } } } })}>{t(`timeHierarchy.levels.${level.levelKey}`, { defaultValue: level.levelLabel })}</button>)}</div>;
}
function SeriesCustomization({
  config,
  model,
  field,
  dispatch,
}: {
  config: ChartConfig;
  model: ChartModel;
  field: (id: string) => FieldMeta | undefined;
  dispatch: React.Dispatch<Action>;
}) {
  const combo = config.chartType === "combo",
    smallMultiples = config.chartType === "small-multiples",
    temporal = config.viewBy.some(
      (id) => field(id)?.semantic?.dataType === "date",
    ),
    hierarchyActive = temporal && config.viewBy.some((id) => config.viewByPresentation?.[id]?.mode === "hierarchy"),
    showRoles =
      config.actualForecast?.enabled &&
      config.actualForecast.splitMode === "series",
    axisCounts = {
      left: config.metrics.filter((m) => m.yAxisId === "left").length,
      right: config.metrics.filter((m) => m.yAxisId === "right").length,
    };
  return (
    <section {...ui(UI_IDS.mapping.series)} className="series-customization">
      <div className="series-customization-title">
        <div>
          <h3>Настройка серий</h3>
          <small>Цвет, видимость и временная роль</small>
        </div>
        <div className="series-title-actions">
          {combo && (
            <label {...ui(UI_IDS.design.dualAxis)} className="dual-axis-toggle">
              <span>Две оси</span>
              <input
                type="checkbox"
                checked={Boolean(config.dualAxisEnabled)}
                disabled={config.metrics.length < 2}
                onChange={() => dispatch({ type: "dual-axis" })}
              />
              <i />
            </label>
          )}
          {smallMultiples && (
            <label
              {...ui(UI_IDS.mapping.smallMultiplesSync)}
              className="dual-axis-toggle"
              title={
                temporal
                  ? "Показывать один день на всех мини-графиках"
                  : "Требуется временная аналитика в View by"
              }
            >
              <span>Общий курсор</span>
              <input
                type="checkbox"
                checked={smallMultiplesSyncEnabled(
                  config.smallMultiplesSyncCursor,
                  temporal,
                )}
                disabled={!temporal}
                onChange={() =>
                  dispatch({
                    type: "set",
                    config: {
                      ...config,
                      smallMultiplesSyncCursor: toggleSmallMultiplesSync(
                        config.smallMultiplesSyncCursor,
                      ),
                    },
                  })
                }
              />
              <i />
            </label>
          )}
        </div>
      </div>
      {config.metrics.map((metric) => {
        const metricSeries = model.series.filter(
          (series) => series.measureKey === metric.fieldId,
        );
        return (
          <article className="metric-series-card" key={metric.fieldId}>
            <header>
              <div>
                <b>{field(metric.fieldId)?.label || metric.fieldId}</b>
                <small>{field(metric.fieldId)?.unit}</small>
              </div>
              {combo && (
                <div className="metric-controls">
                  <label>
                    Тип
                    <select
                      {...ui(UI_IDS.metricSetting(metric.fieldId, "type"))}
                      value={metric.seriesType || "line"}
                      onChange={(event) =>
                        dispatch({
                          type: "metric-type",
                          id: metric.fieldId,
                          seriesType: event.target.value as SeriesRenderType,
                        })
                      }
                    >
                      <option value="column">Column</option>
                      <option value="line">Line</option>
                    </select>
                  </label>
                  <fieldset disabled={!config.dualAxisEnabled}>
                    <legend>Ось</legend>
                    {(["left", "right"] as const).map((axis) => {
                      const blocked =
                        metric.yAxisId !== axis &&
                        axisCounts[metric.yAxisId] <= 1;
                      return (
                        <button
                          {...ui(
                            UI_IDS.metricSetting(
                              metric.fieldId,
                              `axis-${axis}`,
                            ),
                          )}
                          key={axis}
                          type="button"
                          aria-pressed={metric.yAxisId === axis}
                          disabled={blocked}
                          onClick={() =>
                            dispatch({
                              type: "metric-axis",
                              id: metric.fieldId,
                              yAxisId: axis,
                            })
                          }
                        >
                          {axis === "left" ? "Left" : "Right"}
                        </button>
                      );
                    })}
                  </fieldset>
                </div>
              )}
            </header>
            {hierarchyActive && <div className="metric-hierarchy-controls"><label>Агрегация по иерархии<select data-ui-id={`mapping.metrics.${metric.fieldId}.hierarchy-aggregation`} value={metric.hierarchyAggregation || metric.aggregation} onChange={(event) => dispatch({ type: "set", config: { ...config, metrics: config.metrics.map((item) => item.fieldId === metric.fieldId ? { ...item, hierarchyAggregation: event.target.value as HierarchyAggregation, hierarchyOrderLevel: ["FIRST_NON_NULL", "LAST_NON_NULL"].includes(event.target.value) ? (item.hierarchyOrderLevel || "MONTH") : item.hierarchyOrderLevel } : item) } })}><option value="SUM">SUM</option><option value="AVG">AVG</option><option value="MIN">MIN</option><option value="MAX">MAX</option><option value="COUNT">COUNT</option><option value="COUNT_DISTINCT">COUNT DISTINCT</option><option value="FIRST_NON_NULL">FIRST_NON_NULL</option><option value="LAST_NON_NULL">LAST_NON_NULL</option></select></label>{["FIRST_NON_NULL", "LAST_NON_NULL"].includes(metric.hierarchyAggregation || "") && <label>Базовый уровень<select data-ui-id={`mapping.metrics.${metric.fieldId}.order-level`} value={metric.hierarchyOrderLevel || "MONTH"} onChange={(event) => dispatch({ type: "set", config: { ...config, metrics: config.metrics.map((item) => item.fieldId === metric.fieldId ? { ...item, hierarchyOrderLevel: event.target.value } : item) } })}><option value="YEAR">Year</option><option value="HALF_YEAR">Half-Year</option><option value="QUARTER">Quarter</option><option value="MONTH">Month</option><option value="DAY">Day</option></select></label>}</div>}
            <div className="metric-series-list">
              {metricSeries.map((series) => (
                <div
                  className={
                    series.visible ? "series-row" : "series-row is-hidden"
                  }
                  key={series.id}
                >
                  <div className="series-row-name">
                    <i style={{ background: series.color }} />
                    <span>{series.label}</span>
                  </div>
                  {showRoles && (
                    <select
                      {...ui(UI_IDS.seriesSetting(series.id, "time-role"))}
                      className="series-time-role"
                      aria-label={`Роль ${series.label}`}
                      value={(() => {
                        const role =
                          config.seriesSettings[series.id]?.timeRole ||
                          series.timeRole ||
                          "unknown";
                        return (showRoles
                          ? ACTUAL_FORECAST_ROLE_OPTIONS
                          : TIME_ROLE_OPTIONS
                        ).some(([value]) => value === role)
                          ? role
                          : "unknown";
                      })()}
                      onChange={(event) =>
                        dispatch({
                          type: "series-time-role",
                          id: series.id,
                          timeRole: event.target.value as SeriesTimeRole,
                        })
                      }
                    >
                      {(showRoles
                        ? ACTUAL_FORECAST_ROLE_OPTIONS
                        : TIME_ROLE_OPTIONS
                      ).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                  <div
                    className="series-palette"
                    aria-label={`Палитра ${series.label}`}
                  >
                    {SERIES_COLORS.map((color) => (
                      <button
                        {...ui(
                          UI_IDS.seriesSetting(
                            series.id,
                            `color-${color.slice(1)}`,
                          ),
                        )}
                        type="button"
                        key={color}
                        className={
                          series.color.toLowerCase() === color.toLowerCase()
                            ? "active"
                            : ""
                        }
                        style={
                          { "--series-color": color } as React.CSSProperties
                        }
                        aria-label={`Цвет ${color} для ${series.label}`}
                        aria-pressed={
                          series.color.toLowerCase() === color.toLowerCase()
                        }
                        onClick={() =>
                          dispatch({
                            type: "series-color",
                            id: series.id,
                            color,
                          })
                        }
                      />
                    ))}
                    <label className="custom-color" title="Произвольный цвет">
                      <input
                        {...ui(UI_IDS.seriesSetting(series.id, "color-custom"))}
                        type="color"
                        value={series.color}
                        aria-label={`Произвольный цвет для ${series.label}`}
                        onChange={(event) =>
                          dispatch({
                            type: "series-color",
                            id: series.id,
                            color: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <button
                    {...ui(UI_IDS.seriesSetting(series.id, "visibility"))}
                    className="series-visibility"
                    type="button"
                    aria-label={`${series.visible ? "Скрыть" : "Показать"} ${series.label}`}
                    aria-pressed={series.visible}
                    onClick={() =>
                      dispatch({ type: "series-visibility", id: series.id })
                    }
                  >
                    {series.visible ? <Eye /> : <EyeOff />}
                  </button>
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function PieSettingsPanel({ config, dispatch }: { config: ChartConfig; dispatch: React.Dispatch<Action> }) {
  if (config.chartType !== "pie") return null;
  const settings: PieSettings = { ...DEFAULT_PIE_SETTINGS, ...(config.pie || {}) };
  const patch = (value: Partial<PieSettings>) => dispatch({ type: "set", config: { ...config, pie: { ...settings, ...value } } });
  return <section className="pie-settings-panel specialized-settings" data-ui-id="mapping.pie.settings"><header><b>Pie Configuration</b><small>Настройка donut, подписей, легенды и сегментов</small></header><div className="specialized-options"><label className="specialized-check"><input data-ui-id="mapping.pie.donut" type="checkbox" checked={settings.donut} onChange={(e) => patch({ donut: e.target.checked })}/><span>Donut hole</span></label><label className="specialized-check"><input data-ui-id="mapping.pie.show-labels" type="checkbox" checked={settings.showLabels} onChange={(e) => patch({ showLabels: e.target.checked })}/><span>Подписи</span></label><label className="specialized-check"><input data-ui-id="mapping.pie.show-legend" type="checkbox" checked={settings.showLegend} onChange={(e) => patch({ showLegend: e.target.checked })}/><span>Легенда</span></label><label className="specialized-check"><input data-ui-id="mapping.pie.show-total" type="checkbox" checked={settings.showTotal} onChange={(e) => patch({ showTotal: e.target.checked })}/><span>Итого в центре</span></label></div><div className="specialized-form two-columns"><label>Положение подписей<select data-ui-id="mapping.pie.label-position" value={settings.labelPosition} onChange={(e) => patch({ labelPosition: e.target.value as PieSettings["labelPosition"] })}><option value="inside">Внутри</option><option value="legend">В легенде</option><option value="callout">Выноски</option></select></label><label>Положение легенды<select data-ui-id="mapping.pie.legend-position" value={settings.legendPosition} onChange={(e) => patch({ legendPosition: e.target.value as PieSettings["legendPosition"] })}><option value="right">Справа</option><option value="bottom">Снизу</option></select></label><label>Лимит сегментов<input data-ui-id="mapping.pie.slice-limit" type="number" min="1" value={settings.sliceLimit || ""} onChange={(e) => patch({ sliceLimit: e.target.value ? Number(e.target.value) : null })}/></label><label>Размер отверстия<input data-ui-id="mapping.pie.inner-radius" type="number" min="0" max="80" value={settings.innerRadiusPercent} disabled={!settings.donut} onChange={(e) => patch({ innerRadiusPercent: Number(e.target.value) })}/></label></div><label className="specialized-check"><input data-ui-id="mapping.pie.group-other" type="checkbox" checked={settings.groupRemainingAsOther} onChange={(e) => patch({ groupRemainingAsOther: e.target.checked })}/><span>Объединять остаток в «Прочие»</span></label><div className="pie-palette-editor">{settings.palette.map((color, index) => <label key={`${color}-${index}`}><input data-ui-id={`mapping.pie.palette.${index}`} type="color" value={color} onChange={(e) => patch({ palette: settings.palette.map((item, i) => i === index ? e.target.value : item) })}/></label>)}</div></section>;
}

function KpiSettingsPanel({ config, dataset, dispatch }: { config: ChartConfig; dataset: (typeof DATASETS)[DatasetId]; dispatch: React.Dispatch<Action> }) {
  if (config.chartType !== "kpi") return null;
  const settings = {
    timeFieldId: null,
    comparisonSource: "previous-period" as const,
    comparisonOffset: 1,
    comparisonType: "absolute" as const,
    showPeriodLabel: true,
    showComparisonLabel: true,
    showTrendIndicator: true,
    showSparkline: true,
    layout: "auto" as const,
    alignment: "left" as const,
    labelFontSize: "small" as const,
    valueFontSize: "xlarge" as const,
    positiveColor: "#16835b",
    negativeColor: "#c44f4f",
    neutralColor: "#738188",
    reverseComparisonColor: false,
    title: "KPI кредитного портфеля",
    note: "Сравнение с предыдущим доступным периодом",
    ...(config.kpi || {}),
  };
  const patch = (value: Partial<typeof settings>) => dispatch({ type: "set", config: { ...config, kpi: { ...settings, ...value } } });
  const dateFields = dataset.fields.filter((field) => field.kind === "dimension" && field.semantic?.dataType === "date");
  return <section className="kpi-settings-panel specialized-settings" data-ui-id="mapping.kpi.settings">
    <header><b>KPI</b><small>Текущее значение, сравнение и тренд</small></header>
    <div className="specialized-form two-columns">
      <label>Временная аналитика<select data-ui-id="mapping.kpi.time-field" value={settings.timeFieldId || ""} onChange={(e) => patch({ timeFieldId: e.target.value || null })}><option value="">Авто</option>{dateFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
      <label>Источник сравнения<select data-ui-id="mapping.kpi.comparison-source" value={settings.comparisonSource} onChange={(e) => patch({ comparisonSource: e.target.value as typeof settings.comparisonSource })}><option value="none">Нет</option><option value="previous-period">Предыдущий период</option></select></label>
      <label>Вид дельты<select data-ui-id="mapping.kpi.comparison-type" value={settings.comparisonType} disabled={settings.comparisonSource === "none"} onChange={(e) => patch({ comparisonType: e.target.value as typeof settings.comparisonType })}><option value="none">Нет</option><option value="absolute">Абсолютная</option><option value="percent">Процентная</option></select></label>
      <label>Смещение периодов<input data-ui-id="mapping.kpi.comparison-offset" type="number" min="1" value={settings.comparisonOffset || 1} disabled={settings.comparisonSource === "none"} onChange={(e) => patch({ comparisonOffset: Math.max(1, Number(e.target.value) || 1) })}/></label>
    </div>
    <div className="specialized-options">
      {(["showPeriodLabel", "showComparisonLabel", "showTrendIndicator", "showSparkline"] as const).map((key) => <label className="specialized-check" key={key}><input data-ui-id={`mapping.kpi.${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`} type="checkbox" checked={settings[key]} onChange={(e) => patch({ [key]: e.target.checked })}/><span>{{ showPeriodLabel: "Период", showComparisonLabel: "Подпись сравнения", showTrendIndicator: "Индикатор тренда", showSparkline: "Sparkline" }[key]}</span></label>)}
    </div>
    <div className="specialized-form two-columns">
      <label>Раскладка<select data-ui-id="mapping.kpi.layout" value={settings.layout} onChange={(e) => patch({ layout: e.target.value as typeof settings.layout })}><option value="auto">Авто</option><option value="horizontal">Горизонтальная</option><option value="vertical">Вертикальная</option></select></label>
      <label>Выравнивание<select data-ui-id="mapping.kpi.alignment" value={settings.alignment} onChange={(e) => patch({ alignment: e.target.value as typeof settings.alignment })}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option></select></label>
      <label>Размер label<select data-ui-id="mapping.kpi.label-font-size" value={settings.labelFontSize} onChange={(e) => patch({ labelFontSize: e.target.value as typeof settings.labelFontSize })}><option value="small">Малый</option><option value="medium">Средний</option><option value="large">Большой</option></select></label>
      <label>Размер value<select data-ui-id="mapping.kpi.value-font-size" value={settings.valueFontSize} onChange={(e) => patch({ valueFontSize: e.target.value as typeof settings.valueFontSize })}><option value="medium">Средний</option><option value="large">Большой</option><option value="xlarge">Очень большой</option></select></label>
    </div>
    <div className="kpi-color-options"><label>Positive<input data-ui-id="mapping.kpi.color-positive" type="color" value={settings.positiveColor} onChange={(e) => patch({ positiveColor: e.target.value })}/></label><label>Negative<input data-ui-id="mapping.kpi.color-negative" type="color" value={settings.negativeColor} onChange={(e) => patch({ negativeColor: e.target.value })}/></label><label>Neutral<input data-ui-id="mapping.kpi.color-neutral" type="color" value={settings.neutralColor} onChange={(e) => patch({ neutralColor: e.target.value })}/></label></div>
    <label className="specialized-check"><input data-ui-id="mapping.kpi.reverse-comparison-color" type="checkbox" checked={settings.reverseComparisonColor} onChange={(e) => patch({ reverseComparisonColor: e.target.checked })}/><span>Обратная полярность цвета</span></label>
    <div className="specialized-form"><label>Заголовок<input data-ui-id="mapping.kpi.title" value={settings.title || ""} onChange={(e) => patch({ title: e.target.value })}/></label><label>Примечание<textarea data-ui-id="mapping.kpi.note" value={settings.note || ""} onChange={(e) => patch({ note: e.target.value })}/></label></div>
  </section>;
}

function ActualForecastPanel({
  dataset,
  config,
  dispatch,
  metadataService,
}: {
  dataset: (typeof DATASETS)[DatasetId];
  config: ChartConfig;
  dispatch: React.Dispatch<Action>;
  metadataService?: DatasetMetadataService;
}) {
  const settings = config.actualForecast || {
    enabled: false,
    splitMode: "date" as const,
    showDivider: true,
    showPeriodLabels: true,
    forecastBackground: true,
    forecastLineStyle: "dashed" as const,
    actualValues: [],
    forecastValues: [],
  };
  const rolling = config.chartType === "rolling-forecast";
  const temporal = rolling
    ? Boolean(config.rollingForecast?.bindings.targetDateField && dataset.fields.some((field) => field.id === config.rollingForecast?.bindings.targetDateField && field.semantic?.dataType === "date"))
    : config.viewBy.some(
    (id) =>
      dataset.fields.find((field) => field.id === id)?.semantic?.dataType ===
      "date",
  );
  if (!temporal || !["line", "time-series-events", "rolling-forecast"].includes(config.chartType))
    return null;
  const [metadataValues, setMetadataValues] = useState<string[]>([]);
  const statusFields = dataset.fields.filter(
      (field) =>
        field.kind === "dimension" && field.semantic?.dataType !== "date",
    ),
    statusField = statusFields.find(
      (field) => field.id === settings.statusField,
    ),
    values = metadataValues,
    catalogActual = Object.entries(statusField?.semantic?.members || {})
      .filter(([, meta]) => meta.timeRole === "actual")
      .map(([value]) => value),
    catalogForecast = Object.entries(statusField?.semantic?.members || {})
      .filter(([, meta]) => meta.timeRole === "forecast")
      .map(([value]) => value),
    actual = settings.actualValues?.length
      ? settings.actualValues
      : catalogActual,
    forecast = settings.forecastValues?.length
      ? settings.forecastValues
      : catalogForecast;
  const selectField = (fieldId: string) => {
    const selected = dataset.fields.find((field) => field.id === fieldId),
      members = selected?.semantic?.members || {};
    dispatch({
      type: "actual-forecast",
      patch: {
        statusField: fieldId || null,
        actualValues: Object.entries(members)
          .filter(([, meta]) => meta.timeRole === "actual")
          .map(([value]) => value),
        forecastValues: Object.entries(members)
          .filter(([, meta]) => meta.timeRole === "forecast")
          .map(([value]) => value),
      },
    });
  };
  useEffect(() => {
    let cancelled = false;
    setMetadataValues([]);
    if (!statusField || !metadataService) return () => { cancelled = true; };
    metadataService.distinct(dataset.id, statusField.id).then((next) => {
      if (!cancelled) setMetadataValues(next);
    }).catch(() => { if (!cancelled) setMetadataValues([]); });
    return () => { cancelled = true; };
  }, [dataset.id, statusField?.id, metadataService]);
  const toggleValue = (role: "actual" | "forecast", value: string) => {
    const own = role === "actual" ? actual : forecast,
      other = role === "actual" ? forecast : actual,
      next = own.includes(value)
        ? own.filter((item) => item !== value)
        : [...own, value];
    dispatch({
      type: "actual-forecast",
      patch:
        role === "actual"
          ? {
              actualValues: next,
              forecastValues: other.filter((item) => item !== value),
            }
          : {
              forecastValues: next,
              actualValues: other.filter((item) => item !== value),
            },
    });
  };
  return (
    <section
      {...ui(UI_IDS.actualForecast.root)}
      className="actual-forecast-settings"
    >
      <header>
        <div>
          <b>Actual / Forecast Split</b>
          <small>Граница берётся из глобальной даты</small>
        </div>
        <label className="dual-axis-toggle">
          <input
            {...ui(UI_IDS.actualForecast.enabled)}
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              dispatch({
                type: "actual-forecast",
                patch: { enabled: event.target.checked },
              })
            }
          />
          <i />
        </label>
      </header>
      {settings.enabled && (
        <div className="actual-forecast-body">
          <label>
            Режим
            <select
              {...ui(UI_IDS.actualForecast.mode)}
              value={rolling ? "date" : settings.splitMode}
              disabled={rolling}
              onChange={(event) =>
                dispatch({
                  type: "actual-forecast",
                  patch: {
                    splitMode: event.target
                      .value as ActualForecastSettings["splitMode"],
                  },
                })
              }
            >
              <option value="date">По дате</option>
              <option value="field">По полю</option>
              <option value="series">По сериям</option>
            </select>
          </label>
          {!rolling && settings.splitMode === "field" && (
            <>
              <label>
                Поле статуса
                <select
                  {...ui(UI_IDS.actualForecast.statusField)}
                  value={settings.statusField || ""}
                  onChange={(event) => selectField(event.target.value)}
                >
                  <option value="">Выберите поле</option>
                  {statusFields.map((field) => (
                    <option value={field.id} key={field.id}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </label>
              {statusField && (
                <div className="role-value-grid">
                  <fieldset>
                    <legend>Факт</legend>
                    {values.map((value) => (
                      <label key={value}>
                        <input
                          type="checkbox"
                          checked={actual.includes(value)}
                          onChange={() => toggleValue("actual", value)}
                        />
                        {statusField.semantic?.members?.[value]?.label || value}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Прогноз</legend>
                    {values.map((value) => (
                      <label key={value}>
                        <input
                          type="checkbox"
                          checked={forecast.includes(value)}
                          onChange={() => toggleValue("forecast", value)}
                        />
                        {statusField.semantic?.members?.[value]?.label || value}
                      </label>
                    ))}
                  </fieldset>
                </div>
              )}
            </>
          )}
          {!rolling && settings.splitMode === "series" && (
            <p>Роли задаются для каждой серии выше.</p>
          )}
          <div className="split-visual-options">
            <label>
              <input
                type="checkbox"
                checked={settings.showDivider}
                onChange={(event) =>
                  dispatch({
                    type: "actual-forecast",
                    patch: { showDivider: event.target.checked },
                  })
                }
              />
              Граница
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showPeriodLabels}
                onChange={(event) =>
                  dispatch({
                    type: "actual-forecast",
                    patch: { showPeriodLabels: event.target.checked },
                  })
                }
              />
              Подписи зон
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.forecastBackground}
                onChange={(event) =>
                  dispatch({
                    type: "actual-forecast",
                    patch: { forecastBackground: event.target.checked },
                  })
                }
              />
              Фон прогноза
            </label>
            <label>
              Линия
              <select
                value={settings.forecastLineStyle}
                onChange={(event) =>
                  dispatch({
                    type: "actual-forecast",
                    patch: {
                      forecastLineStyle: event.target.value as
                        "solid" | "dashed",
                    },
                  })
                }
              >
                <option value="dashed">Пунктир</option>
                <option value="solid">Сплошная</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </section>
  );
}
const inputDate = (value: string, granularity: "day" | "month") =>
  granularity === "day" && value.length === 8
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : granularity === "month" && value.length === 6
      ? `${value.slice(0, 4)}-${value.slice(4)}`
      : value;
const canonicalDate = (value: string) => value.replace(/-/g, "");
function DateField({
  uiId,
  value,
  type,
  format,
  ariaLabel,
  invalid = false,
  onChange,
}: {
  uiId?: string;
  value: string;
  type: "date" | "month";
  format: "YYYY-MM-DD" | "YYYY-MM";
  ariaLabel: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  const { i18n, t } = useTranslation("common");
  const rootRef = useRef<HTMLDivElement>(null);
  const canonical = value.replace(/-/g, "");
  const parseValue = () => {
    const fallback = new Date();
    const year = type === "month" ? Number(canonical.slice(0, 4)) : Number(canonical.slice(0, 4));
    const month = type === "month" ? Number(canonical.slice(4, 6)) : Number(canonical.slice(4, 6));
    const day = type === "month" ? 1 : Number(canonical.slice(6, 8));
    if (!/^\d{6,8}$/.test(canonical) || !year || !month || month > 12 || !day || day > 31) return new Date(Date.UTC(fallback.getFullYear(), fallback.getMonth(), 1));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? parsed
      : new Date(Date.UTC(fallback.getFullYear(), fallback.getMonth(), 1));
  };
  const hasValidValue = (() => {
    const expectedLength = type === "month" ? 6 : 8;
    if (!new RegExp(`^\\d{${expectedLength}}$`).test(canonical)) return false;
    const parsed = parseValue();
    const year = Number(canonical.slice(0, 4));
    const month = Number(canonical.slice(4, 6));
    const day = type === "month" ? 1 : Number(canonical.slice(6, 8));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  })();
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => parseValue());
  useEffect(() => { if (open) setViewDate(parseValue()); }, [value, open, type]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); } };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  const locale = i18n.language.startsWith("en") ? "en-US" : "ru-RU";
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(viewDate);
  const displayValue = hasValidValue
    ? new Intl.DateTimeFormat(locale, type === "month" ? { month: "long", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parseValue())
    : "";
  const selected = parseValue();
  const selectedKey = hasValidValue ? (type === "month" ? `${selected.getUTCFullYear()}-${selected.getUTCMonth()}` : `${selected.getUTCFullYear()}-${selected.getUTCMonth()}-${selected.getUTCDate()}`) : "";
  const changeValue = (date: Date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    onChange(type === "month" ? `${year}-${month}` : `${year}-${month}-${day}`);
    setOpen(false);
  };
  const shiftView = (amount: number) => setViewDate(new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() + amount, 1)));
  const shiftYear = (amount: number) => setViewDate(new Date(Date.UTC(viewDate.getUTCFullYear() + amount, viewDate.getUTCMonth(), 1)));
  const calendarId = uiId ? `${uiId}.calendar` : undefined;
  const buttonId = (suffix: string) => calendarId ? `${calendarId}.${suffix}` : undefined;
  const dayCells = () => {
    const first = new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth(), 1));
    const offset = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth(), index - offset + 1)));
  };
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
  const formatDay = (date: Date) => `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
  return (
    <div ref={rootRef} className={`date-field${invalid ? " is-invalid" : ""}`}>
      <input
        {...(uiId ? ui(uiId) : {})}
        type="text"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        value={displayValue}
        placeholder={type === "month" ? t("calendar.selectMonth") : t("calendar.selectDate")}
        readOnly
        onClick={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(true); } }}
      />
      <button type="button" className="date-field-trigger" aria-label={ariaLabel} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)}><CalendarDays aria-hidden="true" /></button>
      {open && <div {...(calendarId ? ui(calendarId) : {})} className={`localized-calendar localized-calendar-${type}`} role="dialog" aria-label={t("calendar.calendarLabel")}>
        <header className="localized-calendar-header">
          <button {...(buttonId(type === "month" ? "previous-year" : "previous-month") ? ui(buttonId(type === "month" ? "previous-year" : "previous-month")!) : {})} type="button" aria-label={t(type === "month" ? "calendar.previousYear" : "calendar.previousMonth")} onClick={() => type === "month" ? shiftYear(-1) : shiftView(-1)}><ChevronLeft /></button>
          <b>{monthLabel}</b>
          <button {...(buttonId(type === "month" ? "next-year" : "next-month") ? ui(buttonId(type === "month" ? "next-year" : "next-month")!) : {})} type="button" aria-label={t(type === "month" ? "calendar.nextYear" : "calendar.nextMonth")} onClick={() => type === "month" ? shiftYear(1) : shiftView(1)}><ChevronRight /></button>
        </header>
        {type === "month" ? <div className="localized-calendar-month-grid">{Array.from({ length: 12 }, (_, month) => { const date = new Date(Date.UTC(viewDate.getUTCFullYear(), month, 1)); const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`; return <button {...(buttonId(`month.${month + 1}`) ? ui(buttonId(`month.${month + 1}`)!) : {})} type="button" className={key === selectedKey ? "selected" : ""} aria-selected={key === selectedKey} onClick={() => changeValue(date)}>{new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date)}</button>; })}</div> : <><div className="localized-calendar-weekdays">{Array.from({ length: 7 }, (_, day) => { const date = new Date(Date.UTC(2024, 0, 1 + day)); return <span key={day}>{new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date)}</span>; })}</div><div className="localized-calendar-day-grid">{dayCells().map((date) => { const key = formatDay(date); const isSelected = key === selectedKey; const isToday = key === todayKey; const inMonth = date.getUTCMonth() === viewDate.getUTCMonth(); const dayId = buttonId(`day.${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`); return <button {...(dayId ? ui(dayId) : {})} type="button" className={`${inMonth ? "" : "outside"} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}`} aria-selected={isSelected} aria-current={isToday ? "date" : undefined} onClick={() => changeValue(date)}>{date.getUTCDate()}</button>; })}</div></>}
        <footer><button type="button" onClick={() => changeValue(new Date(Date.UTC(today.getFullYear(), today.getMonth(), type === "month" ? 1 : today.getDate())))}>{t("calendar.today")}</button><button type="button" onClick={() => setOpen(false)}>{t("calendar.close")}</button></footer>
      </div>}
    </div>
  );
}
function FilterCombobox({
  uiId,
  label,
  selected,
  options,
  open,
  onOpen,
  onClose,
  onChange,
  portal = false,
}: {
  uiId?: string;
  label: string;
  selected: string[];
  options: string[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string[]) => void;
  portal?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const close = (restoreFocus = false) => {
    onClose();
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const summary =
    selected.length === 0
      ? "Все"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} выбрано`;
  useEffect(() => {
    if (!open) return;
    const pointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement)?.closest(".filter-combobox-popup")) return;
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !portal) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopupPosition({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portal]);
  return (
    <div {...(uiId ? ui(uiId) : {})} className="filter-combobox" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="filter-combobox-trigger"
        aria-label={`${label}: ${summary}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : onOpen())}
      >
        <span>{summary}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        portal ? createPortal(<div
          className="filter-combobox-popup"
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          style={popupPosition ? { position: "fixed", top: popupPosition.top, left: popupPosition.left, width: popupPosition.width, zIndex: 1000 } : { visibility: "hidden" }}
        >
          <button
            type="button"
            className="filter-clear"
            onClick={() => onChange([])}
          >
            Все / очистить
          </button>
          {options.map((v) => (
            <label key={v}>
              <input
                type="checkbox"
                checked={selected.includes(v)}
                onChange={() =>
                  onChange(
                    selected.includes(v)
                      ? selected.filter((x) => x !== v)
                      : [...selected, v],
                  )
                }
              />
              {v}
            </label>
          ))}
          <button
            type="button"
            className="filter-done"
            onClick={() => close(true)}
          >
            Готово
          </button>
        </div>, document.body) : <div
          className="filter-combobox-popup"
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
        >
          <button type="button" className="filter-clear" onClick={() => onChange([])}>Все / очистить</button>
          {options.map((v) => <label key={v}><input type="checkbox" checked={selected.includes(v)} onChange={() => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])} />{v}</label>)}
          <button type="button" className="filter-done" onClick={() => close(true)}>Готово</button>
        </div>
      )}
    </div>
  );
}
function PageFilters({
  page,
  dataset,
  state,
  onChange,
  onReset,
  defaults = false,
  splitDate,
  onSplitDate,
  splitDateError = false,
  onAddFilter,
  onRemoveFilter,
  rolling = false,
  onFilterScope,
  variant = "panel",
  filterOptions,
}: {
  page: BuilderPage;
  dataset: (typeof DATASETS)[DatasetId];
  state: PageFilterState;
  onChange: (field: string, value: PageFilterValue) => void;
  onReset?: () => void;
  defaults?: boolean;
  splitDate?: string | null;
  onSplitDate?: (value: string) => void;
  splitDateError?: boolean;
  onAddFilter?: (anchor: HTMLElement) => void;
  onRemoveFilter?: (fieldId: string) => void;
  rolling?: boolean;
  onFilterScope?: (fieldId: string, scope: "forecast" | "actual" | "both") => void;
  variant?: "panel" | "toolbar";
  filterOptions?: Record<string, string[]>;
}) {
  const { t } = useTranslation("common");
  const compact = variant === "toolbar";
  const [openFilterId, setOpenFilterId] = useState<string | null>(null);
  useEffect(() => {
    if (
      openFilterId &&
      !page.pageFilters.some((filter) => filter.fieldId === openFilterId)
    )
      setOpenFilterId(null);
  }, [openFilterId, page.pageFilters]);
  return (
    <section
      {...(!compact ? ui(defaults ? UI_IDS.mapping.pageFilters : UI_IDS.pageFilters.root) : {})}
      className={compact ? "page-filter-toolbar-controls" : defaults ? "page-filter-editor" : "page-filter-bar"}
    >
      {!compact && <header>
        <b>{defaults ? "Фильтры страницы" : "Фильтры и параметры"}</b>
        <span className="page-filter-header-actions">
          {onReset && <button {...ui(UI_IDS.pageFilters.reset)} className="page-filter-reset" type="button" onClick={onReset} aria-label={t("pageFilters.reset")} title={t("pageFilters.reset")}><RotateCcw aria-hidden="true" /></button>}
          {onAddFilter && <button {...ui(UI_IDS.mapping.pageFiltersAdd)} className="page-filter-add" type="button" aria-label="Добавить фильтр" onClick={(event) => onAddFilter(event.currentTarget)}><Plus /></button>}
        </span>
      </header>}
      <div className={compact ? "page-filter-toolbar-items" : undefined}>
        {!defaults && (
              <div className={`page-filter-item page-filter-item-required${compact ? " page-filter-chip" : ""}`}>
            <div className="page-filter-main split-date-control">
              <span className="page-filter-label">
                Дата разделения <b aria-hidden="true">*</b>
              </span>
              <div className="page-filter-control-row">
                <DateField
                  uiId={UI_IDS.pageFilters.splitDate}
                  type="date"
                  format="YYYY-MM-DD"
                  ariaLabel="Дата разделения"
                  invalid={splitDateError}
                  value={inputDate(splitDate || "", "day")}
                  onChange={(value) => onSplitDate?.(value)}
                />
              </div>
              {splitDateError && (
                <small id="split-date-error" role="alert">
                  Укажите обязательную дату разделения
                </small>
              )}
            </div>
            {!compact && <div className="page-filter-actions"><button type="button" className="page-filter-remove page-filter-remove-disabled" aria-hidden="true" tabIndex={-1} disabled><Trash2 /></button></div>}
          </div>
        )}
        {page.pageFilters.map((def) => {
            const meta = dataset.fields.find((f) => f.id === def.fieldId) || resolveTemporalField(dataset, def),
            label = meta?.label || def.fieldId,
            value = state[def.fieldId] ?? def.defaultValue;
          if (def.kind === "date-range") {
            const range = value as { from: string; to: string };
            return (
              <div className={`page-filter-item${compact ? " page-filter-chip date-range-chip" : ""}`} key={def.fieldId}>
                <div className="page-filter-main">
                  <span className="page-filter-label">{label}{rolling && onFilterScope && <select {...(!defaults ? ui(UI_IDS.pageFilters.scope(def.fieldId)) : {})} className="page-filter-scope" value={def.scope?.type === "actual" || def.scope?.type === "both" ? def.scope.type : "forecast"} onChange={(event) => onFilterScope(def.fieldId, event.target.value as "forecast" | "actual" | "both")}><option value="forecast">Forecast</option><option value="actual">Actual</option><option value="both">Both</option></select>}</span>
                  <div className="page-filter-control-row">
                    <div className="date-range">
                      <DateField
                        uiId={!defaults ? UI_IDS.pageFilters.rangeStart(def.fieldId) : undefined}
                        type={def.granularity === "day" ? "date" : "month"}
                        format={def.granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM"}
                        ariaLabel={`${label} начало`}
                        value={inputDate(range.from, def.granularity)}
                        onChange={(value) => onChange(def.fieldId, { ...range, from: canonicalDate(value) })}
                      />
                      <span className="date-range-separator" aria-hidden="true">—</span>
                      <DateField
                        uiId={!defaults ? UI_IDS.pageFilters.rangeEnd(def.fieldId) : undefined}
                        type={def.granularity === "day" ? "date" : "month"}
                        format={def.granularity === "day" ? "YYYY-MM-DD" : "YYYY-MM"}
                        ariaLabel={`${label} окончание`}
                        value={inputDate(range.to, def.granularity)}
                        onChange={(value) => onChange(def.fieldId, { ...range, to: canonicalDate(value) })}
                      />
                    </div>
                  </div>
                </div>
                {onRemoveFilter && <div className="page-filter-actions"><button {...(!defaults ? ui(UI_IDS.pageFilters.remove(def.fieldId)) : {})} type="button" className="page-filter-remove" aria-label={`Удалить фильтр ${label}`} title="Удалить фильтр" onClick={() => onRemoveFilter(def.fieldId)}><Trash2 /></button></div>}
              </div>
            );
          }
          const selected = value as string[],
            dynamicOptions = filterOptions?.[def.fieldId],
            options = dynamicOptions !== undefined ? [...dynamicOptions] : availableFilterValues(dataset, state, def.fieldId);
          selected.forEach((item) => {
            if (!options.includes(item)) options.push(item);
          });
          return (
            <div className={`page-filter-item${compact ? " page-filter-chip" : ""}`} key={def.fieldId}>
              <div className="page-filter-main">
                <span className="page-filter-label">{label}{rolling && onFilterScope && <select {...(!defaults ? ui(UI_IDS.pageFilters.scope(def.fieldId)) : {})} className="page-filter-scope" value={def.scope?.type === "actual" || def.scope?.type === "both" ? def.scope.type : "forecast"} onChange={(event) => onFilterScope(def.fieldId, event.target.value as "forecast" | "actual" | "both")}><option value="forecast">Forecast</option><option value="actual">Actual</option><option value="both">Both</option></select>}</span>
                <div className="page-filter-control-row">
                  <FilterCombobox
                    uiId={
                      defaults ? undefined : UI_IDS.pageFilters.control(def.fieldId)
                    }
                    label={label}
                    selected={selected}
                    options={options}
                    open={openFilterId === def.fieldId}
                    onOpen={() => setOpenFilterId(def.fieldId)}
                    onClose={() =>
                      setOpenFilterId((current) =>
                        current === def.fieldId ? null : current,
                      )
                    }
                    onChange={(next) => onChange(def.fieldId, next)}
                    portal={compact}
                  />
                </div>
              </div>
              {onRemoveFilter && <div className="page-filter-actions"><button {...(!defaults ? ui(UI_IDS.pageFilters.remove(def.fieldId)) : {})} type="button" className="page-filter-remove" aria-label={`Удалить фильтр ${label}`} title="Удалить фильтр" onClick={() => onRemoveFilter(def.fieldId)}><Trash2 /></button></div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function pageFilterSummary(
  definition: PageFilterDefinition,
  state: PageFilterState,
  dataset: (typeof DATASETS)[DatasetId],
) {
  const label = (dataset.fields.find((field) => field.id === definition.fieldId) || resolveTemporalField(dataset, definition))?.label || definition.fieldId;
  const value = state[definition.fieldId] ?? definition.defaultValue;
  if (definition.kind === "date-range") {
    const range = value as { from: string; to: string };
    return { label, value: `${inputDate(range.from, definition.granularity)} — ${inputDate(range.to, definition.granularity)}` };
  }
  const selected = value as string[];
  return { label, value: selected.length === 0 ? "Все" : selected.length > 2 ? `${selected.slice(0, 2).join(", ")} +${selected.length - 2}` : selected.join(", ") };
}

function PageFilterToolbar({
  toolbarRef,
  page,
  dataset,
  state,
  onChange,
  onRemoveFilter,
  onAddFilter,
  rolling,
  onFilterScope,
  splitDate,
  splitDateError,
  onSplitDate,
  editable,
  filterOptions,
}: {
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  page: BuilderPage;
  dataset: (typeof DATASETS)[DatasetId];
  state: PageFilterState;
  onChange: (field: string, value: PageFilterValue) => void;
  onRemoveFilter: (fieldId: string) => void;
  onAddFilter: (anchor: HTMLElement) => void;
  rolling: boolean;
  onFilterScope: (fieldId: string, scope: "forecast" | "actual" | "both") => void;
  splitDate: string | null;
  splitDateError: boolean;
  onSplitDate: (value: string) => void;
  editable: boolean;
  filterOptions?: Record<string, string[]>;
}) {
  return (
    <div ref={toolbarRef} className="page-filter-toolbar-shell">
      <div {...ui(UI_IDS.pageFilters.toolbar)} className="page-filter-toolbar">
        <div className="page-filter-toolbar-trigger" aria-hidden="true"><Filter /><span>Фильтры</span><em>{page.pageFilters.length + 1}</em></div>
        <PageFilters variant="toolbar" page={page} dataset={dataset} state={state} onChange={onChange} onRemoveFilter={editable ? onRemoveFilter : undefined} rolling={rolling} onFilterScope={onFilterScope} splitDate={splitDate} splitDateError={splitDateError} onSplitDate={onSplitDate} filterOptions={filterOptions} />
        <button {...ui(UI_IDS.mapping.pageFiltersAdd)} type="button" className="page-filter-toolbar-add" aria-label="Добавить фильтр" title="Добавить фильтр" onClick={(event) => onAddFilter(event.currentTarget)}><Plus /></button>
      </div>
    </div>
  );
}

function NavigationRail({
  catalogOpen,
  onToggleCatalog,
  onOpenBuilder,
  builderOpen,
}: {
  catalogOpen: boolean;
  onToggleCatalog: () => void;
  onOpenBuilder: () => void;
  builderOpen: boolean;
}) {
  const items = [
    { id: UI_IDS.navigation.home, label: "Главная", icon: House },
    { id: UI_IDS.navigation.files, label: "Файлы", icon: Folder },
    { id: UI_IDS.navigation.data, label: "Данные", icon: Database, active: true },
    { id: UI_IDS.navigation.builder, label: "Конструктор", icon: Package },
    { id: UI_IDS.navigation.processes, label: "Процессы", icon: Rocket },
  ];
  return <aside {...ui(UI_IDS.navigation.rail)} className="builder-rail" aria-label="Основная навигация">
    <div {...ui(UI_IDS.topbar.brand)} className="builder-rail-brand" title="EPM Chart Builder"><BarChart3 aria-hidden="true" /></div>
    <nav>
      {items.map(({ id, label, icon: Icon, active }) => { const isActive = active || (id === UI_IDS.navigation.builder && builderOpen); return <button key={id} {...ui(id)} type="button" className={isActive ? "active" : ""} aria-label={label} aria-current={isActive ? "page" : undefined} aria-pressed={id === UI_IDS.navigation.data ? catalogOpen : id === UI_IDS.navigation.builder ? builderOpen : undefined} title={label} onClick={id === UI_IDS.navigation.data ? onToggleCatalog : id === UI_IDS.navigation.builder ? onOpenBuilder : undefined}><Icon aria-hidden="true" /></button>; })}
    </nav>
  </aside>;
}

const DASHBOARD_STORAGE_KEY = "epm-builder-dashboard";
const BUILD_VERSION = "waterfall-labels-20260721";
function MappingFieldDialog({
  dataset,
  kind,
  title,
  selectedIds,
  anchor,
  onClose,
  onConfirm,
}: {
  dataset: (typeof DATASETS)[DatasetId];
  kind: "dimension" | "measure";
  title?: string;
  selectedIds: string[];
  anchor: HTMLElement;
  onClose: () => void;
  onConfirm: (fields: FieldMeta[]) => void;
}) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect(), width = 360, gap = 8;
      const left = rect.right + gap + width <= window.innerWidth
        ? rect.right + gap
        : Math.max(8, rect.left - width - gap);
      setPosition({ top: Math.min(Math.max(8, rect.top - 8), window.innerHeight - 520), left });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => { window.removeEventListener("resize", updatePosition); window.removeEventListener("scroll", updatePosition, true); };
  }, [anchor]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const fields = dataset.fields.filter((field) => field.kind === kind),
    filtered = fields.filter((field) => [field.label, field.id, field.semantic?.role, field.unit, field.semantic?.granularity].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()));
  return createPortal((
    <div className="mapping-field-popover" style={{ top: position.top, left: position.left }} role="dialog" aria-label={title || (kind === "dimension" ? "Добавить измерение" : "Добавить показатель")}>
      <header><div><b>{title || `Добавить ${kind === "dimension" ? "измерение" : "показатель"}`}</b><small>{dataset.label}</small></div><button type="button" onClick={onClose} aria-label="Закрыть"><X /></button></header>
      <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Найти ${kind === "dimension" ? "измерение" : "показатель"}…`} />
      <div className="mapping-field-options">
        {filtered.length ? filtered.map((field) => { const active = selected.includes(field.id); return <button type="button" key={field.id} className={active ? "selected" : ""} aria-pressed={active} onClick={() => setSelected((current) => active ? current.filter((id) => id !== field.id) : [...current, field.id])}><i>{active ? "✓" : ""}</i><span><b>{field.label}</b><small>{field.semantic?.role || field.id} · {field.semantic?.dataType === "date" ? `${field.semantic.granularity === "month" ? "Месяц" : "День"} · ${field.semantic.outputFormat || field.semantic.inputFormats?.[0] || "date"}` : field.unit}</small></span></button>; }) : <p>Поля не найдены</p>}
      </div>
      <footer><span>{selected.length} выбрано</span><button type="button" onClick={() => onConfirm(fields.filter((field) => selected.includes(field.id)))}>Готово</button></footer>
    </div>
  ), document.body);
}
const loadDashboard = (): BuilderDashboard => {
  try {
    const saved = localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (saved) return migrateDashboard(JSON.parse(saved), DEFAULT_PAGES);
    const legacy = localStorage.getItem("epm-builder-pages");
    if (legacy) return migrateDashboard(JSON.parse(legacy), DEFAULT_PAGES);
  } catch {}
  return makeDashboard(DEFAULT_PAGES);
};
function PivotVisualDialog({ kind, config, aggregationId, onClose, onChange }: { kind: "conditional" | "bars" | "formatting"; config: PivotTableConfig; aggregationId: string | null; onClose: () => void; onChange: (config: PivotTableConfig) => void }) {
  const aggregation = config.aggregations.find((item) => item.id === aggregationId) || config.aggregations[0];
  const [mode, setMode] = useState<"single" | "scale">("single");
  const [scale, setScale] = useState({ min: { value: 0, color: "#FEF3C7" }, mid: { value: "" as number | "", color: "#BAE6FD" }, max: { value: 1, color: "#15803D" } });
  const [rules, setRules] = useState([{ id: `rule-${Date.now()}`, operator: ">=" as const, value: 0, valueTo: "" as const, textColor: "#166534", backgroundColor: "#DCFCE7", highlightEntireRow: false, enabled: true }]);
  const [bar, setBar] = useState<PivotDataBar>({ id: `bar-${Date.now()}`, type: "bar", target: { scope: "aggregation", aggregationId: aggregation?.id || "", columnPath: [] }, style: "normal", showTrack: true, colors: { mode: "sign", positive: "#8bb8d8", negative: "#c44536", track: "#eef1f4", categoryValues: {} }, range: { mode: "auto", min: null, max: null }, applyTo: { detail: true, subtotal: false, grandTotal: false } });
  const [format, setFormat] = useState(config.formatting[aggregation?.id || ""] || { decimals: 2, unit: aggregation?.format?.unit || "", scale: "raw" });
  const [applyTo, setApplyTo] = useState({ detail: true, subtotal: false, grandTotal: false });
  useEffect(() => {
    if (!aggregation) return;
    if (kind === "conditional") {
      const existing = config.conditionalFormatting.find((item) => item.target.aggregationId === aggregation.id);
      if (existing) { setMode(existing.mode); setRules(existing.rules as typeof rules); setApplyTo(existing.applyTo); setScale(existing.scale as typeof scale); }
    } else if (kind === "bars") {
      const existing = config.dataBars.find((item) => item.target.aggregationId === aggregation.id);
      if (existing) setBar(existing);
    }
  }, [aggregation?.id, kind]);
  if (!aggregation) return null;
  const applyConditional = () => {
    const item: PivotConditionalFormatting = { id: `cf-${aggregation.id}`, target: { aggregationId: aggregation.id, columnPath: [] }, mode, applyTo, rules, scale };
    onChange({ ...config, conditionalFormatting: [...config.conditionalFormatting.filter((entry) => entry.target.aggregationId !== aggregation.id), item] }); onClose();
  };
  const applyBars = () => { onChange({ ...config, dataBars: [...config.dataBars.filter((entry) => entry.target.aggregationId !== aggregation.id), bar] }); onClose(); };
  const applyFormat = () => { onChange({ ...config, formatting: { ...config.formatting, [aggregation.id]: format }, aggregations: config.aggregations.map((item) => item.id === aggregation.id ? { ...item, format: { ...(item.format || {}), ...format } } : item) }); onClose(); };
  const updateRule = (index: number, patch: Partial<(typeof rules)[number]>) => setRules((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  return <div className="pivot-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pivot-dialog" role="dialog" aria-modal="true" aria-label={kind === "conditional" ? "Условное форматирование" : kind === "bars" ? "Show as bar chart" : "Формат показателя"}>
      <header><div><b>{kind === "conditional" ? "Условное форматирование" : kind === "bars" ? "Визуализация значений" : "Формат показателя"}</b><small>{aggregation.label} · generated column</small></div><button data-ui-id={`mapping.pivot.${kind}.close`} type="button" onClick={onClose} aria-label="Закрыть"><X /></button></header>
      {kind === "conditional" ? <div className="pivot-dialog-body">
        <label>Применить к колонке<select data-ui-id="mapping.pivot.conditional.target" value={aggregation.id} disabled><option value={aggregation.id}>{aggregation.label}</option></select></label>
        <div className="pivot-segmented"><button data-ui-id="mapping.pivot.conditional.mode.single" type="button" className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>Один цвет</button><button data-ui-id="mapping.pivot.conditional.mode.scale" type="button" className={mode === "scale" ? "active" : ""} onClick={() => setMode("scale")}>Цветовая шкала</button></div>
        {mode === "single" ? <div className="pivot-rule-list">{rules.map((rule, index) => <div className="pivot-rule-row" key={rule.id}><select data-ui-id={`mapping.pivot.conditional.rule.${index}.operator`} value={rule.operator} onChange={(event) => updateRule(index, { operator: event.target.value as typeof rule.operator })}><option value=">=">≥</option><option value=">">&gt;</option><option value="=">=</option><option value="between">between</option></select><input data-ui-id={`mapping.pivot.conditional.rule.${index}.value`} type="number" value={rule.value} onChange={(event) => updateRule(index, { value: Number(event.target.value) })} /><input data-ui-id={`mapping.pivot.conditional.rule.${index}.background`} type="color" value={rule.backgroundColor} onChange={(event) => updateRule(index, { backgroundColor: event.target.value })} /><input data-ui-id={`mapping.pivot.conditional.rule.${index}.text`} type="color" value={rule.textColor} onChange={(event) => updateRule(index, { textColor: event.target.value })} /><button data-ui-id={`mapping.pivot.conditional.rule.${index}.remove`} type="button" onClick={() => setRules((items) => items.filter((_, i) => i !== index))}><Trash2 /></button><label><input type="checkbox" checked={rule.highlightEntireRow} onChange={(event) => updateRule(index, { highlightEntireRow: event.target.checked })} /> Вся строка</label></div>)}<button data-ui-id="mapping.pivot.conditional.add-rule" type="button" onClick={() => setRules((items) => [...items, { ...items[0], id: `rule-${Date.now()}` }])}><Plus /> Добавить правило</button></div> : <div className="pivot-scale-grid"><label>Min<input data-ui-id="mapping.pivot.conditional.scale.min" type="number" value={scale.min.value} onChange={(event) => setScale({ ...scale, min: { ...scale.min, value: Number(event.target.value) } })} /><input type="color" value={scale.min.color} onChange={(event) => setScale({ ...scale, min: { ...scale.min, color: event.target.value } })} /></label><label>Mid<input data-ui-id="mapping.pivot.conditional.scale.mid" type="number" placeholder="Необязательно" value={scale.mid.value} onChange={(event) => setScale({ ...scale, mid: { ...scale.mid, value: event.target.value === "" ? "" : Number(event.target.value) } })} /><input type="color" value={scale.mid.color} onChange={(event) => setScale({ ...scale, mid: { ...scale.mid, color: event.target.value } })} /></label><label>Max<input data-ui-id="mapping.pivot.conditional.scale.max" type="number" value={scale.max.value} onChange={(event) => setScale({ ...scale, max: { ...scale.max, value: Number(event.target.value) } })} /><input type="color" value={scale.max.color} onChange={(event) => setScale({ ...scale, max: { ...scale.max, color: event.target.value } })} /></label></div>}
        <div className="pivot-scope"><b>Применять к</b>{(["detail", "subtotal", "grandTotal"] as const).map((scope) => <label key={scope}><input type="checkbox" checked={applyTo[scope]} onChange={(event) => setApplyTo({ ...applyTo, [scope]: event.target.checked })} />{scope === "detail" ? "Детальные строки" : scope === "subtotal" ? "Промежуточные итоги" : "Grand total"}</label>)}</div><div className="pivot-preview"><span>Preview</span><strong style={{ background: rules[0]?.backgroundColor, color: rules[0]?.textColor }}>123 456</strong></div>
      </div> : kind === "bars" ? <div className="pivot-dialog-body">
        <label>Числовая колонка<select data-ui-id="mapping.pivot.bars.target" value={aggregation.id} disabled><option value={aggregation.id}>{aggregation.label}</option></select></label><div className="pivot-segmented"><button data-ui-id="mapping.pivot.bars.style.normal" type="button" className={bar.style === "normal" ? "active" : ""} onClick={() => setBar({ ...bar, style: "normal" })}>Normal</button><button data-ui-id="mapping.pivot.bars.style.slim" type="button" className={bar.style === "slim" ? "active" : ""} onClick={() => setBar({ ...bar, style: "slim" })}>Slim</button></div><div className="pivot-segmented"><button data-ui-id="mapping.pivot.bars.color.sign" type="button" className={bar.colors.mode === "sign" ? "active" : ""} onClick={() => setBar({ ...bar, colors: { ...bar.colors, mode: "sign" } })}>По знаку</button><button data-ui-id="mapping.pivot.bars.color.category" type="button" className={bar.colors.mode === "category" ? "active" : ""} onClick={() => setBar({ ...bar, colors: { ...bar.colors, mode: "category" } })}>По категории</button></div><div className="pivot-color-row"><label>Positive<input data-ui-id="mapping.pivot.bars.color.positive" type="color" value={bar.colors.positive} onChange={(event) => setBar({ ...bar, colors: { ...bar.colors, positive: event.target.value } })} /></label><label>Negative<input data-ui-id="mapping.pivot.bars.color.negative" type="color" value={bar.colors.negative} onChange={(event) => setBar({ ...bar, colors: { ...bar.colors, negative: event.target.value } })} /></label><label>Track<input data-ui-id="mapping.pivot.bars.color.track" type="color" value={bar.colors.track} onChange={(event) => setBar({ ...bar, colors: { ...bar.colors, track: event.target.value } })} /></label></div><label className="pivot-check"><input type="checkbox" checked={bar.showTrack} onChange={(event) => setBar({ ...bar, showTrack: event.target.checked })} /> Показывать фоновый трек</label><div className="pivot-segmented"><button data-ui-id="mapping.pivot.bars.range.auto" type="button" className={bar.range.mode === "auto" ? "active" : ""} onClick={() => setBar({ ...bar, range: { ...bar.range, mode: "auto" } })}>Auto</button><button data-ui-id="mapping.pivot.bars.range.manual" type="button" className={bar.range.mode === "manual" ? "active" : ""} onClick={() => setBar({ ...bar, range: { ...bar.range, mode: "manual" } })}>Ручной</button></div>{bar.range.mode === "manual" && <div className="pivot-range-row"><input data-ui-id="mapping.pivot.bars.range.min" type="number" placeholder="Min" value={bar.range.min ?? ""} onChange={(event) => setBar({ ...bar, range: { ...bar.range, min: Number(event.target.value) } })} /><input data-ui-id="mapping.pivot.bars.range.max" type="number" placeholder="Max" value={bar.range.max ?? ""} onChange={(event) => setBar({ ...bar, range: { ...bar.range, max: Number(event.target.value) } })} /></div>}<div className="pivot-scope"><b>Применять к</b>{(["detail", "subtotal", "grandTotal"] as const).map((scope) => <label key={scope}><input type="checkbox" checked={bar.applyTo[scope]} onChange={(event) => setBar({ ...bar, applyTo: { ...bar.applyTo, [scope]: event.target.checked } })} />{scope === "detail" ? "Детальные строки" : scope === "subtotal" ? "Промежуточные итоги" : "Grand total"}</label>)}</div><div className="pivot-preview"><span>Preview</span><strong className={bar.style === "slim" ? "slim" : ""} style={{ width: "70%", background: bar.colors.positive }}>123 456</strong></div>
      </div> : <div className="pivot-dialog-body"><label>Знаков после запятой<input data-ui-id="mapping.pivot.formatting.decimals" type="number" min="0" max="6" value={format.decimals ?? 2} onChange={(event) => setFormat({ ...format, decimals: Number(event.target.value) })} /></label><label>Масштаб<select data-ui-id="mapping.pivot.formatting.scale" value={format.scale || "raw"} onChange={(event) => setFormat({ ...format, scale: event.target.value })}><option value="raw">raw</option><option value="thousand">тыс.</option><option value="million">млн</option></select></label><label>Единица<input data-ui-id="mapping.pivot.formatting.unit" value={format.unit || ""} onChange={(event) => setFormat({ ...format, unit: event.target.value })} placeholder="RUB, %, шт." /></label><div className="pivot-preview"><span>Preview</span><strong>123 456,78</strong></div></div>}
      <footer><button data-ui-id={`mapping.pivot.${kind}.delete`} type="button" onClick={() => { onChange({ ...config, ...(kind === "conditional" ? { conditionalFormatting: config.conditionalFormatting.filter((item) => item.target.aggregationId !== aggregation.id) } : kind === "bars" ? { dataBars: config.dataBars.filter((item) => item.target.aggregationId !== aggregation.id) } : { formatting: Object.fromEntries(Object.entries(config.formatting).filter(([id]) => id !== aggregation.id)) }) }); onClose(); }}>Удалить</button><span /><button data-ui-id={`mapping.pivot.${kind}.cancel`} type="button" onClick={onClose}>Отмена</button><button data-ui-id={`mapping.pivot.${kind}.apply`} type="button" onClick={kind === "conditional" ? applyConditional : kind === "bars" ? applyBars : applyFormat}>Применить</button></footer>
    </section>
  </div>;
}

function PivotHeatmapDialog({ config, aggregationId, model, onClose, onChange }: { config: PivotTableConfig; aggregationId: string; model: PivotTableModel; onClose: () => void; onChange: (config: PivotTableConfig) => void }) {
  const aggregation = config.aggregations.find((item) => item.id === aggregationId);
  const existing = config.heatmapModes.find((item) => item.aggregationId === aggregationId);
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [palette, setPalette] = useState(existing?.palette ?? { min: "#F1FAFC", max: "#0A8FB4" });
  const [applyTo, setApplyTo] = useState(existing?.applyTo ?? { detail: true, subtotal: true, grandTotal: true });
  if (!aggregation) return null;
  const range = pivotHeatmapRange(model, aggregationId);
  const apply = () => {
    if (enabled && (config.conditionalFormatting.some((item) => item.target.aggregationId === aggregationId) || config.dataBars.some((item) => item.target.aggregationId === aggregationId))) {
      if (!window.confirm("Heatmap заменит условное форматирование и Data bars для этого показателя. Продолжить?")) return;
    }
    const item: PivotHeatmapConfig = { id: existing?.id || `heatmap-${aggregationId}`, aggregationId, enabled, palette, range: { mode: "auto" }, applyTo };
    onChange({ ...config, heatmapModes: [...config.heatmapModes.filter((entry) => entry.aggregationId !== aggregationId), item], conditionalFormatting: enabled ? config.conditionalFormatting.filter((entry) => entry.target.aggregationId !== aggregationId) : config.conditionalFormatting, dataBars: enabled ? config.dataBars.filter((entry) => entry.target.aggregationId !== aggregationId) : config.dataBars });
    onClose();
  };
  const remove = () => { onChange({ ...config, heatmapModes: config.heatmapModes.filter((entry) => entry.aggregationId !== aggregationId) }); onClose(); };
  const samples = [range.min, (range.min + range.max) / 2, range.max];
  return <div className="pivot-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="pivot-dialog pivot-heatmap-dialog" role="dialog" aria-modal="true" aria-label="Heatmap mode"><header><div><b>Heatmap mode</b><small>{aggregation.label} · Auto range</small></div><button data-ui-id="mapping.pivot.heatmap.close" type="button" onClick={onClose} aria-label="Закрыть"><X /></button></header><div className="pivot-dialog-body"><label className="pivot-check"><input data-ui-id="mapping.pivot.heatmap.enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Включить heatmap</label><div className="pivot-color-row"><label>Минимум<input data-ui-id="mapping.pivot.heatmap.palette.min" type="color" value={palette.min} onChange={(event) => setPalette({ ...palette, min: event.target.value })} /></label><label>Максимум<input data-ui-id="mapping.pivot.heatmap.palette.max" type="color" value={palette.max} onChange={(event) => setPalette({ ...palette, max: event.target.value })} /></label></div><div className="pivot-heatmap-context"><b>Диапазон: Auto</b><span>{range.min.toLocaleString("ru-RU")} — {range.max.toLocaleString("ru-RU")}</span></div><div className="pivot-scope"><b>Применять к</b>{(["detail", "subtotal", "grandTotal"] as const).map((scope) => <label key={scope}><input data-ui-id={`mapping.pivot.heatmap.apply-to.${scope}`} type="checkbox" checked={applyTo[scope]} onChange={(event) => setApplyTo({ ...applyTo, [scope]: event.target.checked })} />{scope === "detail" ? "Детальные строки" : scope === "subtotal" ? "Промежуточные итоги" : "Grand total"}</label>)}</div><div className="pivot-heatmap-preview" aria-label="Предпросмотр heatmap">{samples.map((value, index) => <span key={value} style={{ background: `linear-gradient(90deg, ${palette.min}, ${palette.max})`, opacity: 0.35 + index * 0.3 }}>{value.toLocaleString("ru-RU")}</span>)}</div><small className="pivot-dialog-hint">Heatmap имеет приоритет над условным форматированием и Data bars.</small></div><footer><button data-ui-id="mapping.pivot.heatmap.delete" type="button" onClick={remove}>Удалить</button><span /><button data-ui-id="mapping.pivot.heatmap.cancel" type="button" onClick={onClose}>Отмена</button><button data-ui-id="mapping.pivot.heatmap.apply" type="button" onClick={apply}>Применить</button></footer></section></div>;
}

function PivotMappingPanel({ config, dataset, model, page, pageRuntime, onChange, onFilterChange, onResetFilters, onTogglePageFilter, onRemovePageFilter }: { config: PivotTableConfig; dataset: (typeof DATASETS)[DatasetId]; model: PivotTableModel; page: BuilderPage; pageRuntime: PageFilterState; onChange: (config: PivotTableConfig) => void; onFilterChange: (field: string, value: PageFilterValue) => void; onResetFilters: () => void; onTogglePageFilter: (fieldId: string) => void; onRemovePageFilter: (fieldId: string) => void }) {
  const { t } = useTranslation("common");
  const [mappingDialog, setMappingDialog] = useState<{ bucket: "viewBy" | "stackBy" | "metrics" | "pageFilters"; anchor: HTMLElement } | null>(null);
  const [visualDialog, setVisualDialog] = useState<{ kind: "conditional" | "bars" | "formatting" | "heatmap"; aggregationId: string } | null>(null);
  const fieldById = (id: string) => dataset.fields.find((field) => field.id === id);
  const addFields = (bucket: "viewBy" | "stackBy" | "metrics" | "pageFilters", fields: FieldMeta[]) => {
    if (bucket === "pageFilters") {
      fields.forEach((field) => { if (!page.pageFilters.some((item) => item.fieldId === field.id)) onTogglePageFilter(field.id); });
      return;
    }
    if (bucket === "metrics") {
      const existing = new Set(config.aggregations.map((item) => item.measureField));
      onChange({ ...config, aggregations: [...config.aggregations, ...fields.filter((field) => field.kind === "measure" && !existing.has(field.id)).map((field) => ({ id: `pivot-${field.id}-${Date.now()}`, measureField: field.id, operation: "SUM" as const, label: field.label, visible: true }))] });
      return;
    }
    const key = bucket === "viewBy" ? "rows" : "columns";
    const other = bucket === "viewBy" ? config.columns : config.rows;
    const existing = new Set(config[key]);
    onChange({ ...config, [key]: [...config[key], ...fields.filter((field) => field.kind === "dimension" && !existing.has(field.id) && !other.includes(field.id)).map((field) => field.id)] });
  };
  const remove = (bucket: "viewBy" | "stackBy" | "metrics", id: string) => bucket === "metrics" ? onChange({ ...config, aggregations: config.aggregations.filter((item) => item.id !== id), conditionalFormatting: config.conditionalFormatting.filter((item) => item.target.aggregationId !== id), dataBars: config.dataBars.filter((item) => item.target.aggregationId !== id), heatmapModes: config.heatmapModes.filter((item) => item.aggregationId !== id), formatting: Object.fromEntries(Object.entries(config.formatting).filter(([key]) => key !== id)) }) : onChange({ ...config, [bucket === "viewBy" ? "rows" : "columns"]: config[bucket === "viewBy" ? "rows" : "columns"].filter((item) => item !== id) });
  const toggleAxis = (fieldId: string, from: "viewBy" | "stackBy") => {
    const fromKey = from === "viewBy" ? "rows" : "columns", toKey = from === "viewBy" ? "columns" : "rows";
    onChange({ ...config, [fromKey]: config[fromKey].filter((item) => item !== fieldId), [toKey]: [...config[toKey], fieldId] });
  };
  const toggleSort = (fieldId: string, axis: "rows" | "columns") => {
    const key = axis === "rows" ? "rowSorts" : "columnSorts";
    const current = config[key].find((rule) => rule.field === fieldId);
    const next = current ? (current.direction === "asc" ? "desc" : null) : "asc";
    onChange({ ...config, [key]: next ? [...config[key].filter((rule) => rule.field !== fieldId), { field: fieldId, target: "key", direction: next }] : config[key].filter((rule) => rule.field !== fieldId) });
  };
  const setAggregationFormat = (aggregationId: string, patch: { decimals?: number; scale?: string; unit?: string }) => onChange({ ...config, formatting: { ...config.formatting, [aggregationId]: { ...(config.formatting[aggregationId] || {}), ...patch } }, aggregations: config.aggregations.map((item) => item.id === aggregationId ? { ...item, format: { ...(item.format || {}), ...patch } } : item) });
  const bucket = (id: "viewBy" | "stackBy" | "metrics", title: string) => <Bucket id={id} title={title} items={id === "viewBy" ? config.rows.map((fieldId) => ({ id: fieldId, label: fieldById(fieldId)?.label || fieldId, isFilter: page.pageFilters.some((filter) => filter.fieldId === fieldId) })) : id === "stackBy" ? config.columns.map((fieldId) => ({ id: fieldId, label: fieldById(fieldId)?.label || fieldId, isFilter: page.pageFilters.some((filter) => filter.fieldId === fieldId) })) : config.aggregations.map((aggregation) => ({ id: aggregation.id, label: aggregation.label, agg: aggregation.operation, formattingStatus: config.formatting[aggregation.id] ? `${config.formatting[aggregation.id].decimals ?? 2} знака` : "Настроить формат", conditionalCount: config.conditionalFormatting.filter((item) => item.target.aggregationId === aggregation.id).reduce((sum, item) => sum + item.rules.length, 0), barsStatus: config.dataBars.some((item) => item.target.aggregationId === aggregation.id) ? (config.dataBars.find((item) => item.target.aggregationId === aggregation.id)?.style === "slim" ? "Slim" : "Normal") : "Не настроено", heatmapStatus: config.heatmapModes.some((item) => item.aggregationId === aggregation.id && item.enabled) ? "Включено · Auto range" : "Не настроено" }))} onRemove={(fieldId) => remove(id, fieldId)} onFilterToggle={id === "metrics" ? undefined : onTogglePageFilter} onAgg={id === "metrics" ? (aggregationId) => onChange({ ...config, aggregations: config.aggregations.map((item) => item.id === aggregationId ? { ...item, operation: item.operation === "SUM" ? "AVG" : "SUM" } : item) }) : undefined} onMetricFormatting={id === "metrics" ? (aggregationId) => setVisualDialog({ kind: "formatting", aggregationId }) : undefined} onMetricConditional={id === "metrics" ? (aggregationId) => setVisualDialog({ kind: "conditional", aggregationId }) : undefined} onMetricBars={id === "metrics" ? (aggregationId) => setVisualDialog({ kind: "bars", aggregationId }) : undefined} onMetricHeatmap={id === "metrics" ? (aggregationId) => setVisualDialog({ kind: "heatmap", aggregationId }) : undefined} onAdd={(anchor) => setMappingDialog({ bucket: id, anchor })} />;
  return <div className="bucket-list pivot-mapping-panel" data-ui-id="mapping.pivot.settings">
    <section className="settings-dataset-binding"><header><b>Dataset графика</b><small>Источник для mapping и query</small></header><BuilderSelector uiId="mapping.pivot.dataset" label="Источник данных" value={config.datasetId} ariaLabel="Dataset Pivot Table" options={datasetList.map((item) => ({ id: item.id, label: item.label, meta: datasetSemanticMeta(item.id).cube || item.id, count: `${item.fields.length} полей` }))} onChange={(value) => onChange(createDefaultPivotConfig(DATASETS[value as DatasetId]))} /><p>{dataset.description}</p></section>
    {bucket("viewBy", t("buckets.viewBy"))}{bucket("stackBy", t("buckets.stackBy"))}{bucket("metrics", t("buckets.metrics"))}
    <section className="pivot-editor-section" data-ui-id="mapping.pivot.sorting"><header><b>{t("pivot.sorting")}</b><small>Сортировка строк и столбцов</small></header><div className="pivot-sort-grid">{config.rows.map((id) => { const rule = config.rowSorts.find((item) => item.field === id); return <button data-ui-id={`mapping.pivot.sort.rows.${id}`} type="button" key={`row-${id}`} onClick={() => toggleSort(id, "rows")}>{fieldById(id)?.label || id} {rule ? (rule.direction === "asc" ? "↑" : "↓") : "·"}</button>; })}{config.columns.map((id) => { const rule = config.columnSorts.find((item) => item.field === id); return <button data-ui-id={`mapping.pivot.sort.columns.${id}`} type="button" key={`col-${id}`} onClick={() => toggleSort(id, "columns")}>{fieldById(id)?.label || id} {rule ? (rule.direction === "asc" ? "↑" : "↓") : "·"}</button>; })}</div></section>
    <section className="pivot-editor-section" data-ui-id="mapping.pivot.expansion"><header><b>{t("pivot.expansion")}</b><small>Состояние раскрытия и layout строк</small></header><div className="pivot-expansion-actions"><button data-ui-id="mapping.pivot.expansion.expand" type="button" onClick={() => onChange({ ...config, expansion: { rows: ["root", "*"], columns: ["root", "*"] } })}>{t("pivot.expandAll")}</button><button data-ui-id="mapping.pivot.expansion.collapse" type="button" onClick={() => onChange({ ...config, expansion: { rows: ["root"], columns: ["root"] } })}>{t("pivot.collapseAll")}</button><select data-ui-id="mapping.pivot.row-layout" value={config.rowLayout || "compact"} onChange={(event) => onChange({ ...config, rowLayout: event.target.value as "compact" | "tabular" })}><option value="compact">Compact rows</option><option value="tabular">Tabular rows</option></select></div></section>
    <PageFilters page={page} dataset={dataset} state={pageRuntime} onChange={onFilterChange} onReset={onResetFilters} onAddFilter={(anchor) => setMappingDialog({ bucket: "pageFilters", anchor })} onRemoveFilter={onRemovePageFilter} defaults />
    {mappingDialog && <MappingFieldDialog dataset={dataset} kind={mappingDialog.bucket === "metrics" ? "measure" : "dimension"} title={mappingDialog.bucket === "pageFilters" ? "Добавить фильтр" : undefined} selectedIds={mappingDialog.bucket === "viewBy" ? config.rows : mappingDialog.bucket === "stackBy" ? config.columns : mappingDialog.bucket === "metrics" ? config.aggregations.map((item) => item.measureField) : page.pageFilters.map((item) => item.fieldId)} anchor={mappingDialog.anchor} onClose={() => setMappingDialog(null)} onConfirm={(fields) => { addFields(mappingDialog.bucket, fields); setMappingDialog(null); }} />}
    {visualDialog?.kind === "heatmap" ? <PivotHeatmapDialog config={config} aggregationId={visualDialog.aggregationId} model={model} onClose={() => setVisualDialog(null)} onChange={onChange} /> : visualDialog && <PivotVisualDialog kind={visualDialog.kind} config={config} aggregationId={visualDialog.aggregationId} onClose={() => setVisualDialog(null)} onChange={onChange} />}
  </div>;
}

function App() {
  const { t } = useTranslation("common");
  const initial = useMemo(loadDashboard, []);
  const [pages, setPages] = useState<BuilderPage[]>(() =>
    structuredClone(initial.pages),
  );
  const [savedPages, setSavedPages] = useState<BuilderPage[]>(() =>
    structuredClone(initial.pages),
  );
  const [parameters, setParameters] = useState<DashboardParameters>(() =>
    structuredClone(initial.parameters),
  );
  const [savedParameters, setSavedParameters] = useState<DashboardParameters>(
    () => structuredClone(initial.parameters),
  );
  const [activePageId, setActivePageId] = useState(
    initial.pages[0]?.id || DEFAULT_PAGES[0].id,
  );
  const [runtimeFilters, setRuntimeFilters] = useState<
    Record<string, PageFilterState>
  >({});
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"mapping" | "design">("mapping");
  const [showIds, setShowIds] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<"view" | "edit">("view");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogWorkspaceOpen, setCatalogWorkspaceOpen] = useState(false);
  const [catalogDetailRequest, setCatalogDetailRequest] = useState<CatalogEntityRef | null>(null);
  const filterToolbarRef = useRef<HTMLDivElement>(null);
  const analyticalRuntimeRef = useRef<ApplicationAnalyticalClient | null>(null);
  const analyticalRegistryRef = useRef<DatasetRegistry | null>(null);
  const analyticalMetadataRef = useRef<DatasetMetadataService | null>(null);
  const analyticalControllersRef = useRef<Map<string, QueryController>>(new Map());
  const [analyticalChartModels, setAnalyticalChartModels] = useState<Map<string, ChartModel>>(new Map());
  const [analyticalPivotModels, setAnalyticalPivotModels] = useState<Map<string, PivotTableModel>>(new Map());
  const [analyticalFilterOptions, setAnalyticalFilterOptions] = useState<Record<string, string[]>>({});
  const [analyticalState, setAnalyticalState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [analyticalError, setAnalyticalError] = useState<string | null>(null);
  useEffect(() => {
    const start = () => {
      const registry = analyticalRegistryRef.current || new DatasetRegistry();
      const runtime = analyticalRuntimeRef.current || new ApplicationAnalyticalClient(registry);
      analyticalRegistryRef.current = registry;
      analyticalRuntimeRef.current = runtime;
      void runtime.initialize().catch(() => undefined);
    };
    const idle = typeof window !== "undefined" && "requestIdleCallback" in window
      ? window.requestIdleCallback(start, { timeout: 500 })
      : setTimeout(start, 0);
    return () => { if (typeof idle === "number") window.clearTimeout(idle); };
  }, []);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [catalogDatasetId, setCatalogDatasetId] = useState<DatasetId>(
    initial.pages[0]?.config.datasetId || "credit_lifecycle",
  );
  const [mappingDialog, setMappingDialog] = useState<{ bucket: "viewBy" | "stackBy" | "metrics" | "pageFilters"; anchor: HTMLElement } | null>(null);
  const catalogDataset = DATASETS[catalogDatasetId] || DATASETS.credit_lifecycle;
  const page = pages.find((p) => p.id === activePageId) || pages[0];
  const activeWidget = page.widgets.find((widget) => widget.id === activeWidgetId)
    || page.widgets.find((widget) => isConfigurableWidget(widget) && widget.visible)
    || page.widgets[0];
  const chartWidget: DashboardWidget = isConfigurableWidget(activeWidget) ? activeWidget : (page.widgets.find((widget) => isConfigurableWidget(widget)) || {
    id: `${page.id}-chart`, type: "chart", title: page.label, description: page.description,
    chartConfig: page.config, datasetId: page.config.datasetId, visible: true,
  });
  useEffect(() => { setActiveWidgetId(null); }, [activePageId]);
  useEffect(() => {
    if (dashboardMode === "view") {
      setMappingDialog(null);
      setCatalogOpen(false);
    } else {
      setCatalogOpen(true);
    }
  }, [dashboardMode]);
  useEffect(() => {
    const selectedDatasetId = isConfigurableWidget(activeWidget)
      ? (activeWidget.chartConfig?.datasetId || activeWidget.datasetId)
      : activeWidget?.type === "pivot-table"
        ? (activeWidget.pivotConfig?.datasetId || activeWidget.datasetId)
      : page?.config.datasetId;
    if (selectedDatasetId && DATASETS[selectedDatasetId]) setCatalogDatasetId(selectedDatasetId);
  }, [activeWidgetId, activePageId]);
  const config = chartWidget.chartConfig || page.config,
    dataset = DATASETS[config.datasetId],
    rollingForecastDataset = config.rollingForecast?.forecastDatasetId && DATASETS[config.rollingForecast.forecastDatasetId] ? DATASETS[config.rollingForecast.forecastDatasetId] : (config.chartType === "rolling-forecast" ? DATASETS.key_rate_forecast : dataset),
    rollingActualDataset = config.rollingForecast?.actualDatasetId && DATASETS[config.rollingForecast.actualDatasetId] ? DATASETS[config.rollingForecast.actualDatasetId] : (config.chartType === "rolling-forecast" ? DATASETS.key_rate_actual : dataset),
    rollingFilterDataset = config.chartType === "rolling-forecast" ? { ...rollingForecastDataset, id: rollingForecastDataset.id, label: "Forecast + Actual", description: "Dimensions Forecast и Actual кубов", fields: [...rollingForecastDataset.fields, ...rollingActualDataset.fields.filter((field) => !rollingForecastDataset.fields.some((item) => item.id === field.id))], rows: [...rollingForecastDataset.rows, ...rollingActualDataset.rows] } : dataset,
    pageRuntime =
      runtimeFilters[activePageId] ||
      Object.fromEntries(
        page.pageFilters.map((f) => [f.fieldId, f.defaultValue]),
      );
  const pageRuntimeKey = JSON.stringify(pageRuntime);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const eligibleCharts = page.widgets.filter((widget) => isConfigurableWidget(widget) && isDuckDbChart(widget.chartConfig?.chartType));
      const eligiblePivots = page.widgets.filter((widget) => widget.type === "pivot-table");
      if (!eligibleCharts.length && !eligiblePivots.length) return;
      setAnalyticalState("loading");
      setAnalyticalError(null);
      try {
        const registry = analyticalRegistryRef.current || new DatasetRegistry();
        const runtime = analyticalRuntimeRef.current || new ApplicationAnalyticalClient(registry);
        analyticalRegistryRef.current = registry;
        analyticalRuntimeRef.current = runtime;
        analyticalMetadataRef.current = analyticalMetadataRef.current || new DatasetMetadataService(runtime, registry, DATASETS);
        await runtime.initialize();
        const registered = new Set<string>();
        const ensureDataset = async (datasetId: DatasetId) => {
          if (registered.has(datasetId) || registry.state(datasetId)?.state === "ready") return;
          const pending = registry.pending(datasetId);
          if (pending) { await pending; registered.add(datasetId); return; }
          const definition = datasetDefinition(datasetId);
          if (!definition) throw new Error(`Dataset ${datasetId} не имеет CSV definition`);
          const registration = (async () => {
          if (definition.source.type === "composed") {
            const composedDefinition = definition as ComposedDatasetDefinition;
            if (!runtime.registerComposedDataset) throw new Error("Analytical runtime does not support composed datasets");
            const texts: Record<string, string> = {};
            for (const source of composedDefinition.source.sources) {
              const cached = registry.text(source.definition.source.url);
              if (cached !== undefined) texts[source.datasetId] = validateAndNormalizeCsv(cached, DATASETS[source.datasetId], source.definition);
              else {
                const response = await fetch(source.definition.source.url);
                if (!response.ok) throw new Error(`Не удалось загрузить ${source.definition.source.url}`);
                texts[source.datasetId] = validateAndNormalizeCsv(await response.text(), DATASETS[source.datasetId], source.definition);
                registry.setText(source.definition.source.url, texts[source.datasetId]);
              }
            }
            await runtime.registerComposedDataset(composedDefinition, texts);
          } else {
            const csvDefinition = definition as CsvDatasetDefinition;
            const cached = registry.text(csvDefinition.source.url);
            const text = cached !== undefined ? validateAndNormalizeCsv(cached, DATASETS[datasetId], csvDefinition) : await (async () => { const response = await fetch(csvDefinition.source.url); if (!response.ok) throw new Error(`Не удалось загрузить ${csvDefinition.source.url}`); const value = validateAndNormalizeCsv(await response.text(), DATASETS[datasetId], csvDefinition); registry.setText(csvDefinition.source.url, value); return value; })();
            if (!runtime.registerDataset) throw new Error("Analytical runtime does not support CSV datasets");
            await runtime.registerDataset(csvDefinition, text);
          }
          registered.add(datasetId);
          })();
          registry.setPending(datasetId, registration);
          await registration;
        };
        const nextCharts = new Map<string, ChartModel>();
        const nextPivots = new Map<string, PivotTableModel>();
        const nextFilterOptions: Record<string, string[]> = {};
        // Resolve every dictionary against the physical dataset that owns the
        // field.  This is important for composed/multi-source widgets: a
        // synthetic concatenated Dataset is a UI convenience, not a DuckDB
        // table and must never be used for DISTINCT queries.
        const dictionaryDatasets: Dataset[] = [];
        const addDictionaryDataset = (source: Dataset | undefined) => {
          if (source && !dictionaryDatasets.some((item) => item.id === source.id)) dictionaryDatasets.push(source);
        };
        addDictionaryDataset(DATASETS[config.datasetId] || DATASETS.credit_lifecycle);
        eligibleCharts.forEach((widget) => addDictionaryDataset(DATASETS[(widget.chartConfig?.datasetId || page.config.datasetId) as DatasetId] || DATASETS.credit_lifecycle));
        if (config.chartType === "rolling-forecast") {
          addDictionaryDataset(rollingForecastDataset);
          addDictionaryDataset(rollingActualDataset);
        }
        for (const definition of page.pageFilters.filter((item) => item.kind === "categorical")) {
          const owner = dictionaryDatasets.find((source) => source.fields.some((field) => field.id === definition.fieldId));
          if (!owner) continue;
          try {
            await ensureDataset(owner.id);
            const filters = queryFilters(config, page.pageFilters.filter((item) => item.fieldId !== definition.fieldId), pageRuntime, owner);
            nextFilterOptions[definition.fieldId] = await runtime.distinct({ datasetId: owner.id, fieldId: definition.fieldId, filters });
          } catch {
            // A field without a registered CSV definition remains unavailable;
            // do not silently copy values from another physical dataset.
          }
        }
        for (const widget of eligibleCharts) {
          if (!isConfigurableWidget(widget)) continue;
          const widgetConfig = widget.chartConfig || page.config;
          const widgetDataset = DATASETS[widgetConfig.datasetId] || DATASETS.credit_lifecycle;
          if (widgetConfig.chartType === "waterfall") {
            const waterfallConfig = widgetConfig.waterfall;
            const setWaterfallDiagnostic = (message: string) => nextCharts.set(widget.id, {
              data: [], series: [], categories: [], events: [], eventCategories: [],
              diagnostics: [message], warnings: [],
            });
            if (!waterfallConfig) {
              setWaterfallDiagnostic(`Waterfall не настроен для dataset «${widgetDataset.id}»`);
              continue;
            }
            const query = waterfallAnalyticalQuery(widgetDataset, waterfallConfig, page.pageFilters, pageRuntime, widgetConfig);
            if (!query) {
              const missing = [
                !waterfallConfig.dimensionKey ? "аналитику статей" : null,
                !waterfallConfig.items.some((item) => item.enabled && item.action !== "exclude" && item.measureKey) ? "показатель и sequence" : null,
              ].filter((item): item is string => Boolean(item));
              setWaterfallDiagnostic(`Waterfall не может построить запрос: выберите ${missing.join(" и ") || "валидную настройку"}`);
              continue;
            }
            if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") {
              console.info("[browser-analytical] waterfall query", {
                widgetId: widget.id,
                datasetId: widgetDataset.id,
                dimensionKey: waterfallConfig.dimensionKey,
                items: waterfallConfig.items.filter((item) => item.enabled && item.action !== "exclude").map((item) => ({ memberKey: item.memberKey, measureKey: item.measureKey, action: item.action })),
                filters: query.filters,
              });
            }
            try {
              await ensureDataset(widgetDataset.id);
              const controller = analyticalControllersRef.current.get(widget.id) || new QueryController(runtime);
              analyticalControllersRef.current.set(widget.id, controller);
              const snapshot = await controller.execute(query);
              if (snapshot.error) {
                setWaterfallDiagnostic(`Waterfall query: ${snapshot.error.message}`);
                continue;
              }
              if (!snapshot.result || snapshot.result.rowCount === 0) {
                const filters = query.filters.map((filter) => `${filter.fieldId} ${filter.operator}`).join(", ") || "без фильтров";
                setWaterfallDiagnostic(`После фильтрации dataset «${widgetDataset.id}» нет данных (${filters})`);
                continue;
              }
              const fields = [...new Set(waterfallConfig.items.filter((item) => item.enabled && item.action !== "exclude").map((item) => item.measureKey))];
              const rows = normalizeWaterfallQueryResult(snapshot.result, waterfallConfig.dimensionKey || "", fields);
              if (typeof window !== "undefined" && window.localStorage.getItem("waterfall.debug") === "true") {
                console.info("[waterfall:result]", {
                  datasetId: widgetDataset.id,
                  columns: snapshot.result.columns.map((column) => column.name),
                  sampleRow: Object.fromEntries(Object.entries(snapshot.result.rows[0] || {}).map(([key, value]) => [key, serializeQueryValue(value)])),
                  normalizedSampleRow: Object.fromEntries(Object.entries(rows[0] || {}).map(([key, value]) => [key, serializeQueryValue(value)])),
                  measureFields: fields,
                });
              }
              const waterfall = buildWaterfall(widgetDataset, rows, waterfallConfig);
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], waterfall: waterfall.model, diagnostics: waterfall.diagnostics, warnings: waterfall.warnings });
            } catch (error) {
              setWaterfallDiagnostic(`Waterfall query: ${error instanceof Error ? error.message : String(error)}`);
            }
            continue;
          }
          if (widgetConfig.chartType === "rolling-forecast" && widgetConfig.rollingForecast) {
            const settings = {
              ...structuredClone(DEFAULT_ROLLING_SETTINGS),
              ...widgetConfig.rollingForecast,
              bindings: { ...DEFAULT_ROLLING_SETTINGS.bindings, ...(widgetConfig.rollingForecast.bindings || {}) },
            };
            const forecastDataset = settings.forecastDatasetId && DATASETS[settings.forecastDatasetId] ? DATASETS[settings.forecastDatasetId] : DATASETS.key_rate_forecast;
            const actualDataset = settings.actualDatasetId && DATASETS[settings.actualDatasetId] ? DATASETS[settings.actualDatasetId] : DATASETS.key_rate_actual;
            const rollingDebugEnabled = typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true";
            let forecastQuery: ReturnType<typeof rollingAnalyticalQuery>, actualQuery: ReturnType<typeof rollingAnalyticalQuery>;
            try {
              forecastQuery = rollingAnalyticalQuery(forecastDataset, settings, page.pageFilters, pageRuntime, "forecast");
              actualQuery = rollingAnalyticalQuery(actualDataset, settings, page.pageFilters, pageRuntime, "actual");
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (rollingDebugEnabled) console.error("[rolling-forecast] query build failed", { widgetId: widget.id, message, settings, forecastDataset: forecastDataset.id, actualDataset: actualDataset.id });
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], diagnostics: [`Не удалось построить Rolling Forecast query: ${message}`], warnings: [] });
              continue;
            }
            if (!forecastQuery || !actualQuery) {
              const missing = [
                !settings.bindings.targetDateField ? "Target Date" : null,
                !settings.bindings.forecastValueField ? "Forecast" : null,
                !settings.bindings.observationDateField ? "Observation Date" : null,
                !settings.bindings.actualValueField ? "Actual" : null,
              ].filter((item): item is string => Boolean(item));
              if (rollingDebugEnabled) console.error("[rolling-forecast] query not built", { widgetId: widget.id, missing, settings, forecastDataset: forecastDataset.id, actualDataset: actualDataset.id });
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], diagnostics: [`Не настроены поля Rolling Forecast: ${missing.join(", ") || "проверьте source dataset"}`], warnings: [] });
              continue;
            }
            if (rollingDebugEnabled) console.info("[rolling-forecast] query", { widgetId: widget.id, role: "forecast", datasetId: forecastQuery.datasetId, dimensions: forecastQuery.dimensions, measures: forecastQuery.measures, filters: forecastQuery.filters });
            if (rollingDebugEnabled) console.info("[rolling-forecast] query", { widgetId: widget.id, role: "actual", datasetId: actualQuery.datasetId, dimensions: actualQuery.dimensions, measures: actualQuery.measures, filters: actualQuery.filters });
            try {
              await ensureDataset(forecastDataset.id);
              await ensureDataset(actualDataset.id);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (rollingDebugEnabled) console.error("[rolling-forecast] dataset registration failed", { widgetId: widget.id, forecastDataset: forecastDataset.id, actualDataset: actualDataset.id, message });
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], diagnostics: [`Не удалось зарегистрировать источник Rolling Forecast: ${message}`], warnings: [] });
              continue;
            }
            const forecastController = analyticalControllersRef.current.get(`${widget.id}:forecast`) || new QueryController(runtime);
            const actualController = analyticalControllersRef.current.get(`${widget.id}:actual`) || new QueryController(runtime);
            analyticalControllersRef.current.set(`${widget.id}:forecast`, forecastController);
            analyticalControllersRef.current.set(`${widget.id}:actual`, actualController);
            const [forecastSnapshot, actualSnapshot] = await Promise.all([forecastController.execute(forecastQuery), actualController.execute(actualQuery)]);
            if (rollingDebugEnabled) {
              console.info("[rolling-forecast] query result", { widgetId: widget.id, role: "forecast", state: forecastSnapshot.state, rowCount: forecastSnapshot.result?.rowCount ?? 0, error: forecastSnapshot.error?.message || null });
              console.info("[rolling-forecast] query result", { widgetId: widget.id, role: "actual", state: actualSnapshot.state, rowCount: actualSnapshot.result?.rowCount ?? 0, error: actualSnapshot.error?.message || null });
            }
            if (forecastSnapshot.error || actualSnapshot.error) {
              const diagnostics = [
                forecastSnapshot.error ? `Forecast query: ${forecastSnapshot.error.message}` : null,
                actualSnapshot.error ? `Actual query: ${actualSnapshot.error.message}` : null,
              ].filter((item): item is string => Boolean(item));
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], diagnostics, warnings: [] });
              continue;
            }
            if (forecastSnapshot.result && actualSnapshot.result) {
              const normalize = (result: QueryResult, fields: string[]) => result.rows.map((row) => fields.reduce((next, field) => ({ ...next, [field]: row[`${field}__SUM`] ?? row[field] }), { ...row } as Record<string, unknown>) as DataRow);
              const bindings = settings.bindings;
              const forecastFields = [bindings.forecastValueField, bindings.lowerBoundField, bindings.upperBoundField].filter((field): field is string => Boolean(field));
              const actualFields = [bindings.actualValueField].filter((field): field is string => Boolean(field));
              const rolling = buildRollingForecast(forecastDataset, normalize(forecastSnapshot.result, forecastFields), settings, actualDataset, normalize(actualSnapshot.result, actualFields));
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], rollingForecast: rolling.model, diagnostics: rolling.diagnostics, warnings: rolling.warnings });
            } else {
              const emptySources = [
                forecastSnapshot.result ? null : "Forecast",
                actualSnapshot.result ? null : "Actual",
              ].filter((item): item is string => Boolean(item));
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], diagnostics: [], warnings: [`Нет результата DuckDB-запроса для: ${emptySources.join(", ")}`] });
            }
            continue;
          }
          await ensureDataset(widgetDataset.id);
          const controller = analyticalControllersRef.current.get(widget.id) || new QueryController(runtime);
          analyticalControllersRef.current.set(widget.id, controller);
          const thresholdQuery = widgetConfig.chartType === "threshold-comparison" ? thresholdAnalyticalQuery(widgetDataset, widgetConfig, page.pageFilters, pageRuntime) : null;
          const query = widgetConfig.chartType === "kpi" ? kpiAnalyticalQuery(widgetDataset, widgetConfig, page.pageFilters, pageRuntime) : thresholdQuery || chartAnalyticalQuery(widgetDataset, widgetConfig, page.pageFilters, pageRuntime);
          if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") {
            console.info("[browser-analytical] query filters", {
              widgetId: widget.id,
              datasetId: widgetDataset.id,
              filters: query.filters,
              splitDate: parameters.splitDate,
              splitDateInQuery: query.filters.some((filter) => filter.fieldId === "splitDate" || filter.fieldId === "split-date"),
            });
          }
          let snapshot: Awaited<ReturnType<QueryController["execute"]>>;
          try {
            snapshot = await controller.execute(query);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            nextCharts.set(widget.id, { ...emptyChartModel("Не удалось выполнить аналитический запрос"), diagnostics: [message] });
            if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") console.error("[browser-analytical] widget query failed", { widgetId: widget.id, message });
            continue;
          }
          if (!snapshot.result) {
            const message = snapshot.error?.message || "Нет результата аналитического запроса";
            nextCharts.set(widget.id, { ...emptyChartModel("Не удалось получить данные"), diagnostics: [message] });
            if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") console.error("[browser-analytical] widget query returned no result", { widgetId: widget.id, message });
            continue;
          }
          if (snapshot.result) {
            if (widgetConfig.chartType === "kpi") nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], kpi: kpiModelFromQueryResult(widgetDataset, widgetConfig, snapshot.result), diagnostics: [], warnings: [] });
            else if (widgetConfig.chartType === "threshold-comparison" && widgetConfig.thresholdComparison?.measureField && widgetConfig.thresholdComparison.differentiator?.fieldId) {
              const settings = widgetConfig.thresholdComparison;
              const measure = settings.measureField;
              if (!measure) continue;
              const rows = snapshot.result.rows.map((row) => ({ ...row, [measure]: row[`${measure}__SUM`] } as DataRow));
              const threshold = buildThresholdComparison(widgetDataset, rows, settings, page.pageFilters);
              nextCharts.set(widget.id, { data: [], series: [], categories: [], events: [], eventCategories: [], thresholdComparison: threshold.model, diagnostics: threshold.diagnostics, warnings: threshold.warnings });
            } else {
              const chartModel = chartModelFromQueryResult(widgetDataset, widgetConfig, snapshot.result);
              const resolvedSplit = resolveActualForecast(widgetDataset, widgetConfig, chartModel, parameters.splitDate || undefined);
              if (resolvedSplit) chartModel.actualForecast = resolvedSplit;
              nextCharts.set(widget.id, chartModel);
            }
          }
        }
        for (const widget of eligiblePivots) {
          if (widget.type !== "pivot-table") continue;
          const pivotConfig = widget.pivotConfig || createDefaultPivotConfig(DATASETS[widget.datasetId || page.config.datasetId] || DATASETS.credit_lifecycle);
          const pivotDataset = DATASETS[pivotConfig.datasetId] || DATASETS.credit_lifecycle;
          await ensureDataset(pivotDataset.id);
          const pivotPlan = planPivotQueries(pivotDataset, pivotConfig, page.pageFilters, pageRuntime);
          const detailQuery = pivotPlan.scopes[0].query;
          const detailControllers = pivotPlan.scopes.map((scope) => {
            const suffix = scope.axis === "root" ? "detail" : `detail:${scope.key}`;
            const controller = analyticalControllersRef.current.get(`${widget.id}:${suffix}`) || new QueryController(runtime);
            analyticalControllersRef.current.set(`${widget.id}:${suffix}`, controller);
            return { scope, controller };
          });
          const totalController = analyticalControllersRef.current.get(`${widget.id}:total`) || new QueryController(runtime);
          analyticalControllersRef.current.set(`${widget.id}:total`, totalController);
          try {
            const subtotalControllers = pivotPlan.subtotalScopes.map((scope) => {
              const key = `${widget.id}:subtotal:${scope.rowDepth}`;
              const controller = analyticalControllersRef.current.get(key) || new QueryController(runtime);
              analyticalControllersRef.current.set(key, controller);
              return { scope, controller };
            });
            const totalQuery = pivotPlan.totalScope.query;
            if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") {
              console.info("[browser-analytical] pivot queries", {
                widgetId: widget.id,
                detail: { dimensions: detailQuery.dimensions, orderBy: detailQuery.orderBy, filters: detailQuery.filters },
                subtotals: pivotPlan.subtotalScopes.map((scope) => ({ rowDepth: scope.rowDepth, dimensions: scope.query.dimensions, orderBy: scope.query.orderBy, filters: scope.query.filters })),
                total: { dimensions: totalQuery.dimensions, orderBy: totalQuery.orderBy, filters: totalQuery.filters },
              });
            }
            const [detailSnapshot, totalSnapshot, ...subtotalSnapshots] = await Promise.all([
              Promise.all(detailControllers.map(({ scope, controller }) => controller.execute(scope.query))).then((snapshots) => {
                const first = snapshots[0];
                if (!first.result || snapshots.length === 1) return first;
                const rows = [...new Map(snapshots.flatMap((snapshot) => snapshot.result?.rows || []).map((row) => [transportKey(row), row] as const)).values()];
                return { ...first, result: { ...first.result, rows, rowCount: rows.length } };
              }),
              totalController.execute(totalQuery),
              ...subtotalControllers.map(({ scope, controller }) => controller.execute(scope.query)),
            ]);
            if (detailSnapshot.result && totalSnapshot.result && subtotalSnapshots.every((snapshot) => snapshot.result)) {
              nextPivots.set(widget.id, pivotModelFromQueryResults(pivotConfig, {
                detail: detailSnapshot.result,
                total: totalSnapshot.result,
                subtotals: subtotalSnapshots.flatMap((snapshot, index) => snapshot.result ? [{ rowDepth: subtotalControllers[index].scope.rowDepth, result: snapshot.result }] : []),
              }));
            }
            else nextPivots.set(widget.id, { rows: [], columns: [], cells: [], diagnostics: [detailSnapshot.error?.message || totalSnapshot.error?.message || "Нет результата Pivot query"], warnings: [] });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            nextPivots.set(widget.id, { rows: [], columns: [], cells: [], diagnostics: [message], warnings: [] });
            if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") console.error("[browser-analytical] pivot query failed", { widgetId: widget.id, message });
          }
        }
        if (cancelled) return;
        setAnalyticalChartModels(nextCharts);
        setAnalyticalPivotModels(nextPivots);
        setAnalyticalFilterOptions(nextFilterOptions);
        setAnalyticalState("ready");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (typeof window !== "undefined" && window.localStorage.getItem("browser-analytical.debug") === "true") {
          console.error("[browser-analytical] dashboard query failed", error);
        }
        if (!cancelled) {
          setAnalyticalState("error");
          setAnalyticalError(message);
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [page.id, page.widgets, page.pageFilters, page.config.datasetId, config.datasetId, pageRuntimeKey]);
  const widgetRenderStates = useMemo(() => {
    const states = new Map<string, { config: ChartConfig; dataset: Dataset; model: ChartModel }>();
    page.widgets.forEach((widget) => {
      if (!isConfigurableWidget(widget)) return;
      const widgetConfig = widget.chartConfig || page.config;
      const widgetDataset = DATASETS[widgetConfig.datasetId] || DATASETS.credit_lifecycle;
      states.set(widget.id, {
        config: widgetConfig,
        dataset: widgetDataset,
        model: analyticalChartModels.get(widget.id) || emptyChartModel(analyticalState === "loading" ? "Выполняется аналитический запрос…" : "Нет результата DuckDB-запроса"),
      });
    });
    return states;
  }, [page, pageRuntime, parameters, analyticalChartModels]);
  const pivotRenderStates = useMemo(() => {
    const states = new Map<string, { config: PivotTableConfig; dataset: (typeof DATASETS)[DatasetId]; model: PivotTableModel }>();
    page.widgets.forEach((widget) => {
      if (widget.type !== "pivot-table") return;
      const pivotConfig = widget.pivotConfig || createDefaultPivotConfig(DATASETS[widget.datasetId || config.datasetId] || DATASETS.credit_lifecycle);
      const pivotDataset = DATASETS[pivotConfig.datasetId] || DATASETS.credit_lifecycle;
      const model = analyticalPivotModels.get(widget.id);
      if (model) states.set(widget.id, { config: pivotConfig, dataset: pivotDataset, model });
    });
    return states;
  }, [page, pageRuntime, config.datasetId, analyticalPivotModels]);
  const activePivotState = activeWidget?.type === "pivot-table" ? pivotRenderStates.get(activeWidget.id) : undefined;
  const markdownSources = page.widgets.filter((widget) => widget.type === "table" || widget.type === "pivot-table");
  const markdownSource = activeWidget?.type === "markdown" ? markdownSources.find((widget) => widget.id === activeWidget.markdownConfig?.sourceWidgetId) : undefined;
  const markdownContext = activeWidget?.type === "markdown" && markdownSource ? markdownSource.type === "pivot-table" ? (() => { const state = pivotRenderStates.get(markdownSource.id); return state ? markdownContextFromPivot(state.model, state.config) : { rows: [], columns: [], values: [], col_totals: {}, grand_totals: {} }; })() : (() => { const state = widgetRenderStates.get(markdownSource.id); return state ? markdownContextFromChart(state.model, markdownSource.chartConfig?.viewBy[0]) : { rows: [], columns: [], values: [], col_totals: {}, grand_totals: {} }; })() : { rows: [], columns: [], values: [], col_totals: {}, grand_totals: {} };
  const dispatchForWidget = (widgetId: string | null, action: Action) =>
    setPages((current) =>
      current.map((item) =>
        item.id === activePageId
          ? (() => {
              const target = item.widgets.find((widget) => widget.id === widgetId)
                || item.widgets.find((widget) => isConfigurableWidget(widget) && widget.visible)
                || item.widgets.find((widget) => isConfigurableWidget(widget));
              if (!isConfigurableWidget(target)) return item;
              const nextConfig = reducer(target.chartConfig || item.config, action);
              return {
                ...item,
                config: target.id === item.widgets.find((widget) => isConfigurableWidget(widget))?.id
                  ? nextConfig
                  : item.config,
                widgets: item.widgets.map((widget) =>
                  widget.id === target.id ? { ...widget, chartConfig: nextConfig, datasetId: nextConfig.datasetId } : widget,
                ),
              };
            })()
          : item,
      ),
    );
  const dispatch: React.Dispatch<Action> = (action) => dispatchForWidget(activeWidgetId, action);
  const updatePage = (fn: (page: BuilderPage) => BuilderPage) =>
    setPages((current) =>
      current.map((item) => (item.id === activePageId ? fn(item) : item)),
    );
  const updateWidgetContent = (widgetId: string, content: string) =>
    updatePage((item) => ({
      ...item,
      widgets: item.widgets.map((widget) =>
        widget.id === widgetId ? { ...widget, textContent: content } : widget,
      ),
    }));
  const updateWidgetTitle = (widgetId: string, title: string) =>
    updatePage((item) => ({
      ...item,
      widgets: item.widgets.map((widget) =>
        widget.id === widgetId ? { ...widget, title } : widget,
      ),
    }));
  const updatePageHeader = (header: PageHeaderConfig) =>
    updatePage((item) => ({ ...item, header }));
  const updateMarkdownConfig = (widgetId: string, markdownConfig: MarkdownWidgetConfig) => updatePage((item) => ({ ...item, widgets: item.widgets.map((widget) => widget.id === widgetId ? { ...widget, markdownConfig } : widget) }));
  const updatePivotConfig = (widgetId: string, pivotConfig: PivotTableConfig) =>
    updatePage((item) => ({
      ...item,
      widgets: item.widgets.map((widget) => widget.id === widgetId ? { ...widget, pivotConfig, datasetId: pivotConfig.datasetId } : widget),
    }));
  const updateLayouts = (next: ResponsiveLayouts) => updatePage((item) => ({ ...item, layouts: next }));
  const handleWidgetAction = (action: string, widget: DashboardWidget) => {
    if (action === "delete" && page.widgets.length > 1) {
      updatePage((item) => ({ ...item, widgets: item.widgets.filter((candidate) => candidate.id !== widget.id) }));
      setActiveWidgetId(null);
    }
    if (action === "duplicate") {
      const id = `${widget.id}-copy-${Date.now()}`;
      updatePage((item) => ({
        ...item,
        widgets: [...item.widgets, { ...structuredClone(widget), id, title: `${widget.title} (копия)` }],
        layouts: Object.fromEntries(Object.entries(item.layouts).map(([breakpoint, items]) => [breakpoint, [...items, { ...(items.find((layout) => layout.i === widget.id) || { i: id, x: 0, y: 99, w: 6, h: 12 }), i: id, y: 99 }]])) as ResponsiveLayouts,
      }));
    }
  };
  const addWidget = (type: DashboardWidget["type"]) => {
    const id = `${page.id}-${type}-${Date.now()}`;
    const labels: Record<DashboardWidget["type"], string> = { chart: "График", kpi: "KPI", table: "Таблица", "pivot-table": "Pivot Table", text: "Текст", markdown: "Markdown visualization" };
    updatePage((item) => ({
      ...item,
      widgets: [...item.widgets, { id, type, title: type === "chart" ? `${chartTypes.find((candidate) => candidate.id === config.chartType)?.label || "График"} · новый` : `${labels[type]} · новый`, description: "Новый виджет", ...(type === "text" ? { textContent: DEFAULT_TEXT_CONTENT } : {}), ...(type === "markdown" ? { markdownConfig: { sourceWidgetId: item.widgets.find((candidate) => candidate.type === "table" || candidate.type === "pivot-table")?.id || null, template: "# Markdown\n\n{% map(rows) %}\n- {{ `Category`.formatted }}\n{% end %}", enabled: true, maxRows: 100, allowHtml: true, allowCss: true } } : {}), ...(type === "pivot-table" ? { pivotConfig: createDefaultPivotConfig(dataset), datasetId: dataset.id } : {}), ...((type === "chart" || type === "kpi" || type === "table") ? { chartConfig: { ...structuredClone(config), chartType: type === "kpi" ? "kpi" : type === "table" ? "table" : config.chartType }, datasetId: config.datasetId } : {}), visible: true }],
      layouts: Object.fromEntries(Object.entries(item.layouts).map(([breakpoint, items]) => [breakpoint, [...items, { i: id, x: 0, y: 999, w: 6, h: 14, minW: 3, minH: 8 }]])) as ResponsiveLayouts,
    }));
    setActiveWidgetId(id);
  };
  const changeDataset = (id: DatasetId) => {
    const nextDataset = DATASETS[id];
    const available = new Set(nextDataset.fields.map((field) => field.id));
    dispatch({
      type: "set",
      config: {
        ...config,
        datasetId: id,
        viewBy: config.viewBy.filter((field) => available.has(field)),
        stackBy: config.stackBy.filter((field) => available.has(field)),
        metrics: config.metrics.filter((metric) => available.has(metric.fieldId)),
        eventFields: config.eventFields.filter((field) => available.has(field)),
        filters: Object.fromEntries(
          Object.entries(config.filters).filter(([field]) => available.has(field)),
        ),
        waterfall: config.waterfall
          ? {
              ...config.waterfall,
              dimensionKey:
                config.waterfall.dimensionKey && available.has(config.waterfall.dimensionKey)
                  ? config.waterfall.dimensionKey
                  : null,
            }
          : config.waterfall,
      },
    });
    updatePage((item) => ({
      ...item,
      pageFilters: item.pageFilters.filter((filter) => available.has(filter.fieldId) || (filter.kind === "date-range" && resolveTemporalField(nextDataset, filter) !== undefined)),
    }));
    setRuntimeFilters((current) => ({ ...current, [activePageId]: {} }));
    setQuery("");
  };
  const setFilter = (fieldId: string, value: PageFilterValue) =>
    setRuntimeFilters((current) => ({
      ...current,
      [activePageId]: { ...pageRuntime, [fieldId]: value },
    }));
  const handleMarkdownDrill = (sourceWidget: DashboardWidget, fieldId: string, value: string) => {
    const sourceDataset = DATASETS[sourceWidget.datasetId || sourceWidget.pivotConfig?.datasetId || config.datasetId] || dataset;
    if (!page.pageFilters.some((filter) => filter.fieldId === fieldId)) togglePageFilter(fieldId, sourceDataset);
    setRuntimeFilters((current) => ({ ...current, [activePageId]: { ...pageRuntime, [fieldId]: [value] } }));
  };
  const resetFilters = () => {
    setRuntimeFilters((current) => ({
      ...current,
      [activePageId]: Object.fromEntries(
        page.pageFilters.map((filter) => [filter.fieldId, filter.defaultValue]),
      ),
    }));
    setParameters(structuredClone(savedParameters));
  };
  const togglePageFilter = (fieldId: string, sourceDataset = dataset, scope?: "forecast" | "actual" | "both") => {
    const sourceMeta = sourceDataset.fields.find((field) => field.id === fieldId);
    const temporalKey = sourceMeta?.semantic?.dataType === "date" ? (sourceMeta.semantic.temporalKey || "calendar") : undefined;
    const existing = page.pageFilters.find(
      (filter) => filter.fieldId === fieldId || Boolean(temporalKey && filter.kind === "date-range" && (filter.temporalKey || "calendar") === temporalKey),
    );
    if (existing) {
      const existingFieldId = existing.fieldId;
      updatePage((item) => ({
        ...item,
        pageFilters: item.pageFilters.filter(
          (filter) => filter.fieldId !== existingFieldId,
        ),
      }));
      setRuntimeFilters((current) => ({
        ...current,
        [activePageId]: Object.fromEntries(
          Object.entries(pageRuntime).filter(([id]) => id !== existingFieldId),
        ),
      }));
      return;
    }
    const meta = sourceMeta,
      source = meta ? {
        datasetId: sourceDataset.id,
        fieldId,
        semanticRole: meta.semantic?.role,
        dataType: meta.semantic?.dataType,
        temporalKey: meta.semantic?.temporalKey,
        granularity: meta.semantic?.granularity,
      } : undefined,
      next: PageFilterDefinition =
        meta?.semantic?.dataType === "date" && meta.semantic.granularity
          ? {
              fieldId,
              kind: "date-range",
              granularity: meta.semantic.granularity,
              temporalKey,
              source,
              defaultValue: { from: "", to: "" },
              ...(config.chartType === "rolling-forecast" ? { scope: { type: scope || "forecast" as const, fieldId } } : {}),
            }
          : { fieldId, kind: "categorical", source, defaultValue: [], ...(config.chartType === "rolling-forecast" ? { scope: { type: scope || "forecast" as const, fieldId } } : {}) };
    updatePage((item) => ({
      ...item,
      pageFilters: [...item.pageFilters, next],
    }));
  };
  const removePageFilter = (fieldId: string) => {
    updatePage((item) => ({ ...item, pageFilters: item.pageFilters.filter((filter) => filter.fieldId !== fieldId) }));
    setRuntimeFilters((current) => {
      const next = { ...(current[activePageId] || pageRuntime) };
      delete next[fieldId];
      return { ...current, [activePageId]: next };
    });
  };
  const setRollingFilterScope = (fieldId: string, scope: "forecast" | "actual" | "both") => updatePage((item) => ({ ...item, pageFilters: item.pageFilters.map((filter) => filter.fieldId === fieldId ? { ...filter, scope: { type: scope } } : filter) }));
  const setDefaultFilter = (fieldId: string, value: PageFilterValue) => {
    updatePage((item) => ({
      ...item,
      pageFilters: item.pageFilters.map((filter) =>
        filter.fieldId === fieldId
          ? ({ ...filter, defaultValue: value } as PageFilterDefinition)
          : filter,
      ),
    }));
    setFilter(fieldId, value);
  };
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor),
  );
  const model = widgetRenderStates.get(chartWidget.id)?.model
    || emptyChartModel(analyticalState === "loading" ? "Выполняется аналитический запрос…" : "Нет результата DuckDB-запроса");
  const errors = useMemo(
    () => validateConfig(dataset, config, DATASETS),
    [dataset, config],
  );
  const parameterError = !isValidSplitDate(parameters.splitDate),
    bridgeSaveError = config.chartType === "waterfall" && errors.length > 0,
    dirty =
      JSON.stringify(pages) !== JSON.stringify(savedPages) ||
      JSON.stringify(parameters) !== JSON.stringify(savedParameters);
  const field = (id: string) => dataset.fields.find((item) => item.id === id);
  const addField = (
    item: FieldMeta,
    bucket?: "viewBy" | "stackBy" | "metrics",
  ) =>
    dispatch({
      type: "add",
      bucket: bucket || (item.kind === "measure" ? "metrics" : "viewBy"),
      field: item,
    });
  const dragEnd = (event: DragEndEvent) => {
    const item = event.active.data.current?.field as FieldMeta | undefined,
      over = String(event.over?.id || "");
    if (item && over.startsWith("special-bucket:")) {
      const bucket = over.replace("special-bucket:", "") as SpecializedBucketId;
      if (!bucketAcceptsSpecialized(bucket, item)) return;
      dispatch({ type: "set", config: bindSpecializedField(config, bucket, item) });
      return;
    }
    if (!item || !over.startsWith("bucket:")) return;
    const bucket = over.replace("bucket:", "") as
      "viewBy" | "stackBy" | "metrics";
    if ((bucket === "metrics") !== (item.kind === "measure")) return;
    addField(item, bucket);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={dragEnd}>
      <div
        {...ui(UI_IDS.app)}
        className="builder-app"
        data-ui-inspector={showIds}
      >
        <header {...ui(UI_IDS.topbar.root)} className="builder-top">
          <div {...ui(UI_IDS.topbar.breadcrumbs)} className="builder-breadcrumbs" aria-label="Навигация по контексту">
            <span>Визуализация кредитного портфеля</span><i>/</i><span>{dataset.label}</span><i>/</i>
            <BuilderSelector
              uiId={UI_IDS.builder.pageSelector}
              label="Страница"
              value={activePageId}
              ariaLabel="Выбор страницы dashboard"
              portalMenu
              options={pages.map((item) => ({ id: item.id, label: item.label, meta: item.description }))}
              onChange={setActivePageId}
            />
          </div>
          <div className="builder-actions">
            <LanguageSwitcher />
            <button
              type="button"
              data-ui-id="dashboard.mode-toggle"
              aria-pressed={dashboardMode === "edit"}
              className="builder-icon-action"
              aria-label={dashboardMode === "edit" ? "Переключить в режим просмотра" : "Переключить в режим редактирования"}
              title={dashboardMode === "edit" ? "Готово" : "Редактировать"}
              onClick={() => setDashboardMode((mode) => mode === "edit" ? "view" : "edit")}
            >
              {dashboardMode === "edit" ? <Presentation /> : <Pencil />}
              <span className="sr-only">{dashboardMode === "edit" ? "Готово" : "Редактировать"}</span>
            </button>
            <span {...ui(UI_IDS.topbar.saveStatus)} className={`builder-save-status ${dirty ? "dirty" : ""}`}>
              <i aria-hidden="true" />
              {dirty ? "Не сохранено" : "Сохранено"}
            </span>
            <button
              {...ui(UI_IDS.topbar.inspector)}
              className="builder-icon-action"
              onClick={() => setShowIds((value) => !value)}
              aria-pressed={showIds}
              aria-label="Показать UI IDs"
              title="UI IDs"
            >
              <Settings2 />
              <span className="sr-only">UI IDs</span>
            </button>
            <button
              {...ui(UI_IDS.topbar.discard)}
              className="builder-icon-action"
              onClick={() => {
                setPages(structuredClone(savedPages));
                setParameters(structuredClone(savedParameters));
                setRuntimeFilters({});
              }}
              aria-label="Сбросить изменения"
              title="Сбросить"
            >
              <Undo2 />
              <span className="sr-only">Сбросить</span>
            </button>
            <button
              {...ui(UI_IDS.topbar.save)}
              className="save"
              disabled={parameterError || bridgeSaveError}
              title={
                parameterError
                  ? "Укажите дату разделения"
                  : bridgeSaveError
                    ? "Исправьте структуру Bridge / Waterfall"
                    : undefined
              }
              onClick={() => {
                const dashboard: BuilderDashboard = {
                  version: 2,
                  pages: structuredClone(pages),
                  parameters: structuredClone(parameters),
                };
                setSavedPages(structuredClone(pages));
                setSavedParameters(structuredClone(parameters));
                localStorage.setItem(
                  DASHBOARD_STORAGE_KEY,
                  JSON.stringify(dashboard),
                );
              }}
              aria-label="Сохранить"
            >
              <Save />
              <span className="sr-only">Сохранить</span>
            </button>
          </div>
        </header>
        <NavigationRail catalogOpen={catalogOpen} builderOpen={catalogWorkspaceOpen} onToggleCatalog={() => { setCatalogWorkspaceOpen(false); setCatalogDetailRequest(null); if (dashboardMode === "edit") setCatalogOpen((value) => !value); }} onOpenBuilder={() => { setCatalogOpen(false); setCatalogDetailRequest(null); setCatalogWorkspaceOpen(true); }} />
        {catalogWorkspaceOpen ? <CatalogWorkspace initialEntity={catalogDetailRequest} /> : <>
        <PageFilterToolbar toolbarRef={filterToolbarRef} page={page} dataset={config.chartType === "rolling-forecast" ? rollingFilterDataset : dataset} state={pageRuntime} onChange={setFilter} onRemoveFilter={removePageFilter} onAddFilter={(anchor) => setMappingDialog({ bucket: "pageFilters", anchor })} rolling={config.chartType === "rolling-forecast"} onFilterScope={setRollingFilterScope} splitDate={parameters.splitDate} splitDateError={parameterError} onSplitDate={(value) => setParameters({ splitDate: normalizeSplitDateInput(value) })} editable={dashboardMode === "edit"} filterOptions={analyticalFilterOptions} />
        <main className={`builder-workspace ${dashboardMode}-mode`}>
          {dashboardMode === "edit" && <aside {...ui(UI_IDS.catalog.root)} className={`builder-catalog catalog-drawer ${catalogOpen ? "is-open" : ""}`}>
            <div className="catalog-drawer-header"><b>Данные</b><button {...ui(UI_IDS.catalog.toggle)} type="button" aria-label="Закрыть каталог данных" title="Закрыть" onClick={() => setCatalogOpen(false)}><X /></button></div>
            <BuilderSelector
              uiId={UI_IDS.catalog.source}
              label="Источник catalog"
              value={catalogDatasetId}
              ariaLabel="Источники catalog"
              options={datasetList.map((item) => ({ id: item.id, label: item.label, meta: datasetSemanticMeta(item.id).cube || item.id, count: `${item.fields.length} полей` }))}
              onOpenDetail={() => { setCatalogOpen(false); setCatalogDetailRequest({ kind: "dataset", id: catalogDatasetId }); setCatalogWorkspaceOpen(true); }}
              detailUiId={UI_IDS.catalog.sourceDetail}
              onChange={(value) => { setCatalogDatasetId(value as DatasetId); setQuery(""); }}
            />
            <div {...ui(UI_IDS.catalog.meta)} className="catalog-dataset-meta">
              <p>{catalogDataset.description}</p>
              <small>{datasetSemanticMeta(catalogDatasetId).businessObject || "Semantic dataset"}{datasetSemanticMeta(catalogDatasetId).cube ? ` · ${datasetSemanticMeta(catalogDatasetId).cube}` : ""}</small>
            </div>
            <div className="builder-search">
              <Search />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти поле"
              />
            </div>
            <div {...ui(UI_IDS.catalog.structure)} className="catalog-structure">
            {(["dimension", "measure"] as const).map((kind) => (
              <section key={kind}>
                <h3>
                  {kind === "dimension" ? "Время / Измерения" : catalogGroups[kind]}{" "}
                  <span data-ui-id="browser-analytical.status">
                    {catalogDataset.fields.filter((f) => f.kind === kind).length}
                  </span>
                </h3>
                {catalogDataset.fields
                  .filter(
                    (f) =>
                      f.kind === kind &&
                      [f.label, f.id, f.semantic?.role, f.semantic?.granularity, ...(f.semantic?.inputFormats || [])].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((f) => (
                    <DraggableField
                      key={f.id}
                      field={f}
                      readOnly
                      isFilter={false}
                    />
                  ))}
              </section>
            ))}
            </div>
          </aside>
          }
          <section {...ui(UI_IDS.canvas.root)} className="builder-canvas">
            <header {...ui(UI_IDS.canvas.header)} className="builder-canvas-header" style={{ ["--canvas-header-sticky-bg" as string]: page.header?.backgroundColor && page.header.backgroundColor !== "transparent" ? page.header.backgroundColor : "#f7f9fb" }}>
              <PageHeader
                page={page}
                chartTitle={chartTypes.find((item) => item.id === config.chartType)?.label || "График"}
                chartHint={chartTypes.find((item) => item.id === config.chartType)?.hint || "Визуализация данных"}
                datasetLabel={dataset.label}
                editable={dashboardMode === "edit"}
                onChange={updatePageHeader}
              />
              {dashboardMode === "edit" && <div className="dashboard-widget-add" data-ui-id="dashboard.widget-add" aria-label="Добавить виджет">
                <button {...ui(UI_IDS.builder.widgetAdd("chart"))} type="button" onClick={() => addWidget("chart")} aria-label="Добавить график" title="График"><ChartLine /></button>
                <button {...ui(UI_IDS.builder.widgetAdd("kpi"))} type="button" onClick={() => addWidget("kpi")} aria-label="Добавить KPI" title="KPI"><Gauge /></button>
                <button {...ui(UI_IDS.builder.widgetAdd("table"))} type="button" onClick={() => addWidget("table")} aria-label="Добавить таблицу" title="Таблица"><Table2 /></button>
                <button {...ui(UI_IDS.builder.widgetAdd("pivot-table"))} type="button" onClick={() => addWidget("pivot-table")} aria-label="Добавить Pivot Table" title="Pivot Table"><Grid2X2 /></button>
                <button {...ui(UI_IDS.builder.widgetAdd("text"))} type="button" onClick={() => addWidget("text")} aria-label="Добавить текст" title="Текст"><FileText /></button>
                <button {...ui(UI_IDS.builder.widgetAdd("markdown"))} type="button" onClick={() => addWidget("markdown")} aria-label="Добавить Markdown" title="Markdown"><Hash /></button>
              </div>}
            </header>
            {parameterError ? (
              <div
                {...ui(UI_IDS.builder.validation)}
                className="dashboard-parameter-block"
                role="status"
              >
                <Info />
                <b>Для работы с Dashboard укажите дату разделения</b>
                <span>Параметр обязателен для всех страниц.</span>
              </div>
            ) : (
              <>
                {errors.length > 0 && (
                  <div
                    {...ui(UI_IDS.builder.validation)}
                    className="validation"
                  >
                    <Info />
                    {errors.join(" · ")}
                  </div>
                )}
                {analyticalError && (
                  <div
                    data-ui-id="browser-analytical.error"
                    className="validation"
                    role="alert"
                  >
                    <Info />
                    {analyticalError}
                  </div>
                )}
                <DashboardCanvas
                  widgets={page.widgets}
                  layouts={page.layouts}
                  editMode={dashboardMode === "edit"}
                  activeWidgetId={activeWidgetId}
                  onActivate={setActiveWidgetId}
                  onLayoutsChange={updateLayouts}
                  onAction={handleWidgetAction}
                  onRender={(widget) => {
                    if (widget.type === "text") {
                      return <TextWidget widget={widget} editable={dashboardMode === "edit"} onChangeTitle={(title) => updateWidgetTitle(widget.id, title)} onChangeContent={(content) => updateWidgetContent(widget.id, content)} />;
                    }
                    if (widget.type === "markdown") {
                      const source = page.widgets.find((candidate) => candidate.id === widget.markdownConfig?.sourceWidgetId);
                      const context = source?.type === "pivot-table" ? (() => { const state = pivotRenderStates.get(source.id); return state ? markdownContextFromPivot(state.model, state.config) : { rows: [], columns: [], values: [], col_totals: {}, grand_totals: {} }; })() : source ? (() => { const state = widgetRenderStates.get(source.id); return state ? markdownContextFromChart(state.model, source.chartConfig?.viewBy[0]) : { rows: [], columns: [], values: [], col_totals: {}, grand_totals: {} }; })() : { rows: [], columns: [], values: [], col_totals: {}, grand_totals: {} };
                      return <DynamicMarkdownWidget widget={widget} context={context} fields={source?.type === "table" ? DATASETS[source.datasetId || config.datasetId]?.fields || [] : []} editable={dashboardMode === "edit"} onChangeTitle={(title) => updateWidgetTitle(widget.id, title)} onChangeConfig={(next) => updateMarkdownConfig(widget.id, next)} onDrill={(row, raw) => { const fieldId = Object.entries(row.fields).find(([id, value]) => id !== "Category" && id !== "category" && String(value.raw) === raw)?.[0] || Object.entries(row.fields).find(([, value]) => String(value.raw) === raw)?.[0]; if (fieldId && source) handleMarkdownDrill(source, fieldId, raw); }} />;
                    }
                    if (widget.type === "pivot-table") {
                      const state = pivotRenderStates.get(widget.id);
                      if (!state) return <div className="dashboard-widget-placeholder"><b>{widget.title}</b><span>Нет данных для Pivot Table</span></div>;
                      return <PivotTableWidget dataset={state.dataset} config={state.config} model={state.model} onChange={(next) => updatePivotConfig(widget.id, next)} />;
                    }
                    if (!isConfigurableWidget(widget)) {
                      return <div className="dashboard-widget-placeholder"><b>{widget.title}</b><span>Виджет будет настроен в следующем шаге</span></div>;
                    }
                    const state = widgetRenderStates.get(widget.id);
                    if (!state) return <div className="dashboard-widget-placeholder"><b>{widget.title}</b><span>Нет данных для визуализации</span></div>;
                    const widgetDispatch: React.Dispatch<Action> = (action) => dispatchForWidget(widget.id, action);
                    return <div {...ui(UI_IDS.builder.chart)} className={`builder-chart${state.config.chartType === "time-series-events" ? " builder-chart--time-series-events" : ""}`}>
                      <TimeHierarchySwitcher config={state.config} dataset={state.dataset} dispatch={widgetDispatch} />
                      <ChartRenderer model={state.model} config={state.config} dataset={state.dataset} onSelectRollingVintage={(selectedObservationDate) => state.config.rollingForecast && widgetDispatch({ type: "set", config: { ...state.config, rollingForecast: { ...state.config.rollingForecast, observationDateMode: "selected", selectedObservationDate } } })} />
                    </div>;
                  }}
                />
                <footer
                  {...ui(UI_IDS.builder.localEngineStatus)}
                  aria-live="polite"
                >
                  <span>
                    {analyticalState === "loading" ? "DuckDB-Wasm · загрузка" : analyticalState === "ready" ? "DuckDB-Wasm · готов" : analyticalState === "error" ? "DuckDB-Wasm · ошибка" : "DuckDB-Wasm"}
                  </span>
                  <span>
                    {model.series.filter((series) => series.visible).length} из{" "}
                    {model.series.length} серий · {model.categories.length}{" "}
                    категорий
                  </span>
                  <span {...ui("app.build-version")} title="Версия frontend bundle">
                    build {BUILD_VERSION}
                  </span>
                </footer>
              </>
            )}
          </section>
          {dashboardMode === "edit" && <aside {...ui(UI_IDS.settings.root)} className="builder-settings">
            <div className="builder-tabs">
              <button
                className={tab === "mapping" ? "active" : ""}
                onClick={() => setTab("mapping")}
              >
                Маппинг
              </button>
              <button
                className={tab === "design" ? "active" : ""}
                onClick={() => setTab("design")}
              >
                Дизайн
              </button>
            </div>
            {activeWidget?.type === "markdown" ? (
              <section className="markdown-settings" data-ui-id="settings.markdown"><header><b>Markdown visualization</b><small>Динамический контент из табличного виджета</small></header><label>Источник данных<select data-ui-id="settings.markdown.source-widget" value={activeWidget.markdownConfig?.sourceWidgetId || ""} onChange={(event) => updateMarkdownConfig(activeWidget.id, { ...(activeWidget.markdownConfig || { template: "", enabled: true, maxRows: 100, allowHtml: true, allowCss: true }), sourceWidgetId: event.target.value || null })}><option value="">Выберите Table или Pivot Table</option>{markdownSources.map((source) => <option key={source.id} value={source.id}>{source.title} · {source.type === "pivot-table" ? "Pivot Table" : "Table"}</option>)}</select></label><label>Шаблон Markdown<textarea data-ui-id="settings.markdown.template" rows={18} value={activeWidget.markdownConfig?.template || ""} onChange={(event) => updateMarkdownConfig(activeWidget.id, { ...(activeWidget.markdownConfig || { sourceWidgetId: null, enabled: true, maxRows: 100, allowHtml: true, allowCss: true }), template: event.target.value })} /></label><label>Максимум строк<input data-ui-id="settings.markdown.max-rows" type="number" min="1" max="1000" value={activeWidget.markdownConfig?.maxRows || 100} onChange={(event) => updateMarkdownConfig(activeWidget.id, { ...(activeWidget.markdownConfig as MarkdownWidgetConfig), maxRows: Number(event.target.value) || 100 })} /></label><small data-ui-id="settings.markdown.syntax-hint">{"Доступны {{ `Field`.formatted }}, {{ values.`Measure`.raw }} и {% map(rows) %} ... {% end %}. JavaScript запрещён."}</small></section>
            ) : activeWidget?.type === "text" ? (
              <div className="text-widget-settings" data-ui-id="settings.text-widget">
                <b>Текстовый виджет</b>
                <span>Редактирование Markdown выполняется непосредственно внутри виджета.</span>
              </div>
            ) : activeWidget?.type === "pivot-table" && activePivotState ? (
              <PivotMappingPanel config={activePivotState.config} dataset={activePivotState.dataset} model={activePivotState.model} page={page} pageRuntime={pageRuntime} onChange={(next) => updatePivotConfig(activeWidget.id, next)} onFilterChange={setFilter} onResetFilters={resetFilters} onTogglePageFilter={(fieldId) => togglePageFilter(fieldId, activePivotState.dataset)} onRemovePageFilter={removePageFilter} />
            ) : tab === "mapping" ? (
                <div className="bucket-list">
                {!specializedChart(config.chartType) && <section className="settings-dataset-binding">
                  <header><b>Dataset графика</b><small>Источник для mapping и query</small></header>
                  <BuilderSelector uiId={UI_IDS.settings.datasetSelector} label="Источник данных" value={config.datasetId} ariaLabel="Dataset графика" options={datasetList.map((item) => ({ id: item.id, label: item.label, meta: datasetSemanticMeta(item.id).cube || item.id, count: `${item.fields.length} полей` }))} onChange={(value) => changeDataset(value as DatasetId)} />
                  <p {...ui(UI_IDS.settings.datasetMeta)}>{dataset.description}</p>
                </section>}
                {specializedChart(config.chartType) ? (
                  <>
                    {config.chartType === "waterfall" && <section className="settings-dataset-binding waterfall-dataset-binding">
                      <header><b>Dataset графика</b><small>Источник для mapping и query</small></header>
                      <BuilderSelector uiId={UI_IDS.settings.datasetSelector} label="Источник данных" value={config.datasetId} ariaLabel="Dataset графика" options={datasetList.map((item) => ({ id: item.id, label: item.label, meta: datasetSemanticMeta(item.id).cube || item.id, count: `${item.fields.length} полей` }))} onChange={(value) => changeDataset(value as DatasetId)} />
                      <p {...ui("settings.datasetMeta")}>{dataset.description}</p>
                    </section>}
                    <SpecializedMapping
                      dataset={dataset}
                      datasets={DATASETS}
                      metadataService={analyticalMetadataRef.current || undefined}
                      config={config}
                      pageFilters={page.pageFilters}
                      onChange={(next) => dispatch({ type: "set", config: next })}
                    />
                  </>
                ) : (
                  <>
                <Bucket
                  id="viewBy"
                  title={t("buckets.viewBy")}
                  items={config.viewBy.map((id) => ({
                    id,
                    label: field(id)?.label || id,
                    isFilter: page.pageFilters.some(
                      (filter) => filter.fieldId === id,
                    ),
                    time: field(id)?.semantic?.dataType === "date" && field(id)?.semantic?.hierarchies?.length ? { hierarchies: field(id)!.semantic!.hierarchies!, presentation: config.viewByPresentation?.[id] || { mode: "flat", activeHierarchyId: null, selectedLevelKey: null } } : undefined,
                  }))}
                  onFilterToggle={togglePageFilter}
                  onAdd={(anchor) => setMappingDialog({ bucket: "viewBy", anchor })}
                  onRemove={(id) =>
                    dispatch({ type: "remove", bucket: "viewBy", id })
                  }
                  onTimePresentation={(fieldId, presentation) => dispatch({ type: "set", config: { ...config, viewByPresentation: { ...(config.viewByPresentation || {}), [fieldId]: presentation } } })}
                  onTimeToggle={(fieldId) => { const current = config.viewByPresentation?.[fieldId]; const fieldMeta = field(fieldId); const hierarchy = fieldMeta?.semantic?.hierarchies?.[0]; const enabled = current?.mode === "hierarchy"; dispatch({ type: "set", config: { ...config, viewByPresentation: { ...(config.viewByPresentation || {}), [fieldId]: enabled ? { mode: "flat", activeHierarchyId: null, selectedLevelKey: null } : { mode: "hierarchy", activeHierarchyId: current?.activeHierarchyId ?? hierarchy?.hierarchyId ?? null, selectedLevelKey: current?.selectedLevelKey ?? hierarchy?.defaultLevelKey ?? hierarchy?.levels[0]?.levelKey ?? null } } } }); }}
                />
                <Bucket
                  id="stackBy"
                  title={t("buckets.stackBy")}
                  items={config.stackBy.map((id) => ({
                    id,
                    label: field(id)?.label || id,
                  }))}
                  onRemove={(id) =>
                    dispatch({ type: "remove", bucket: "stackBy", id })
                  }
                  onAdd={(anchor) => setMappingDialog({ bucket: "stackBy", anchor })}
                />
                <Bucket
                  id="metrics"
                  title={t("buckets.metrics")}
                  items={config.metrics.map((metric) => ({
                    id: metric.fieldId,
                    label: field(metric.fieldId)?.label || metric.fieldId,
                    agg: metric.aggregation,
                  }))}
                  onAgg={(id) => dispatch({ type: "agg", id })}
                  onRemove={(id) =>
                    dispatch({ type: "remove", bucket: "metrics", id })
                  }
                  onAdd={(anchor) => setMappingDialog({ bucket: "metrics", anchor })}
                />
                <SeriesCustomization
                  config={config}
                  model={model}
                  field={field}
                  dispatch={dispatch}
                />
                <PieSettingsPanel config={config} dispatch={dispatch} />
                <KpiSettingsPanel config={config} dataset={dataset} dispatch={dispatch} />
                  </>
                )}
                <ActualForecastPanel
                  dataset={config.chartType === "rolling-forecast" ? rollingFilterDataset : dataset}
                  config={config}
                  dispatch={dispatch}
                  metadataService={analyticalMetadataRef.current || undefined}
                />
                <PageFilters
                  page={page}
                  dataset={dataset}
                  state={Object.fromEntries(
                    page.pageFilters.map((filter) => [
                      filter.fieldId,
                      filter.defaultValue,
                    ]),
                  )}
                  onChange={setDefaultFilter}
                  onAddFilter={(anchor) => setMappingDialog({ bucket: "pageFilters", anchor })}
                  onRemoveFilter={removePageFilter}
                  rolling={config.chartType === "rolling-forecast"}
                  onFilterScope={setRollingFilterScope}
                  filterOptions={analyticalFilterOptions}
                  defaults
                />
                {!specializedChart(config.chartType) && (
                  <EventsMapping
                    dataset={dataset}
                    config={config}
                    model={model}
                    dispatch={dispatch}
                  />
                )}
                {mappingDialog && (
                  <MappingFieldDialog
                    dataset={mappingDialog.bucket === "pageFilters" && config.chartType === "rolling-forecast" ? rollingFilterDataset : dataset}
                    anchor={mappingDialog.anchor}
                    kind={mappingDialog.bucket === "metrics" ? "measure" : "dimension"}
                    title={mappingDialog.bucket === "pageFilters" ? "Добавить фильтр" : undefined}
                    selectedIds={mappingDialog.bucket === "viewBy" ? config.viewBy : mappingDialog.bucket === "stackBy" ? config.stackBy : mappingDialog.bucket === "metrics" ? config.metrics.map((metric) => metric.fieldId) : page.pageFilters.map((filter) => filter.fieldId)}
                    onClose={() => setMappingDialog(null)}
                    onConfirm={(fields) => {
                      if (mappingDialog.bucket === "pageFilters") {
                        const existing = new Set(page.pageFilters.map((filter) => filter.fieldId));
                        fields.forEach((field) => { if (!existing.has(field.id)) { const inForecast = rollingForecastDataset.fields.some((item) => item.id === field.id); const source = config.chartType === "rolling-forecast" ? (inForecast ? rollingForecastDataset : rollingActualDataset) : dataset; const scope = config.chartType === "rolling-forecast" ? (inForecast ? "forecast" : "actual") : undefined; togglePageFilter(field.id, source, scope); } });
                      } else fields.forEach((field) => addField(field, mappingDialog.bucket as "viewBy" | "stackBy" | "metrics"));
                      setMappingDialog(null);
                    }}
                  />
                )}
              </div>
            ) : (
              <div className="chart-type-list">
                {chartTypes.map((type) => {
                  if (type.id === "markdown") {
                    const active = activeWidget?.type === "markdown";
                    return <button {...ui("builder.chart-type.markdown")} key={type.id} className={active ? "active" : ""} aria-current={active ? "true" : undefined} title={type.hint} onClick={() => { if (!active) addWidget("markdown"); }}><span className="material-symbols-outlined chart-type-icon">markdown</span><span><b>{type.label}</b><small>{type.hint}</small></span>{active && <Eye />}</button>;
                  }
                  if (type.id === "pivot-table") {
                    const active = activeWidget?.type === "pivot-table";
                    return <button
                      {...ui("builder.chart-type.pivot-table")}
                      key={type.id}
                      className={active ? "active" : ""}
                      aria-current={active ? "true" : undefined}
                      title={type.hint}
                      onClick={() => {
                        if (!active) addWidget("pivot-table");
                      }}
                    >
                      <Table2 className="chart-type-icon" aria-hidden="true" focusable="false" />
                      <span><b>{type.label}</b><small>{type.hint}</small></span>
                      {active && <Eye />}
                    </button>;
                  }
                  const chartType = type.id as ChartType;
                  const candidate = { ...config, chartType },
                    disabled = specializedChart(chartType)
                      ? !chartTypeCompatible(dataset, config, chartType)
                      : validateConfig(dataset, candidate, DATASETS).length > 0;
                  return (
                    <button
                      {...ui(UI_IDS.builder.chartType(type.id))}
                      key={type.id}
                      className={config.chartType === type.id ? "active" : ""}
                      aria-disabled={disabled}
                      title={
                        disabled
                          ? validateConfig(dataset, candidate, DATASETS).join("; ")
                          : type.hint
                      }
                      onClick={() =>
                        !disabled &&
                        dispatch({ type: "chart", chartType })
                      }
                    >
                      <ChartTypeIcon type={chartType} />
                      <span>
                        <b>{type.label}</b>
                        <small>
                          {disabled ? "Недоступно для mapping" : type.hint}
                        </small>
                      </span>
                      {config.chartType === type.id && <Eye />}
                    </button>
                  );
                })}
              </div>
            )}
          </aside>}
        </main>
        </>}
      </div>
    </DndContext>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
