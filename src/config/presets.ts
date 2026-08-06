import type {
  ActualForecastSettings,
  BridgeSequenceAction,
  BuilderPage,
  ChartConfig,
  ChartType,
  DatasetId,
  KpiSettings,
  PieSettings,
  SeriesRenderType,
} from "../types";
import {
  DEFAULT_ROLLING_SETTINGS,
  DEFAULT_THRESHOLD_SETTINGS,
  DEFAULT_WATERFALL_SETTINGS,
} from "../query/specializedCharts";
export const DEFAULT_PIE_SETTINGS: PieSettings = {
  donut: true,
  innerRadiusPercent: 58,
  labelPosition: "legend",
  showLabels: true,
  showLegend: true,
  legendPosition: "right",
  legendValueMode: "value-percent",
  showTotal: true,
  totalLabel: "Итого",
  sliceLimit: 5,
  groupRemainingAsOther: true,
  otherLabel: "Прочие",
  palette: ["#6bd8cb", "#b9c7e0", "#ffb59a", "#d27956", "#3c4a5e"],
  paddingAngle: 2,
};
export const DEFAULT_KPI_SETTINGS: KpiSettings = {
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
  title: "KPI кредитного портфеля",
  note: "Сравнение с предыдущим доступным периодом",
};
const actualForecast = (
  patch: Partial<ActualForecastSettings> = {},
): ActualForecastSettings => ({
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
  ...patch,
});
const base = (
  datasetId: DatasetId,
  chartType: ChartType,
  viewBy: string[],
  metrics: string[],
  stackBy: string[] = [],
): ChartConfig => ({
  version: 1,
  datasetId,
  chartType,
  viewBy,
  viewByPresentation: Object.fromEntries(viewBy.map((id) => [id, { mode: "flat", activeHierarchyId: null, selectedLevelKey: null }])),
  stackBy,
  metrics: metrics.map((fieldId, i) => ({
    fieldId,
    aggregation: "SUM",
    yAxisId: i === 1 ? "right" : "left",
    seriesType:
      chartType === "combo" ? (i === 0 ? "column" : "line") : undefined,
    hierarchyAggregation: "SUM",
    hierarchyNullPolicy: "ignore",
  })),
  eventFields: [],
  eventCategoryVisibility: {},
  filters: {},
  dualAxisEnabled: chartType === "combo",
  seriesSettings: {},
  actualForecast: actualForecast(),
  pie: structuredClone(DEFAULT_PIE_SETTINGS),
});
const combo = (
  datasetId: DatasetId,
  viewBy: string[],
  metrics: Array<[string, SeriesRenderType, "left" | "right"]>,
): ChartConfig => ({
  ...base(
    datasetId,
    "combo",
    viewBy,
    metrics.map(([fieldId]) => fieldId),
  ),
  metrics: metrics.map(([fieldId, seriesType, yAxisId]) => ({
    fieldId,
    aggregation: "SUM",
    seriesType,
    yAxisId,
  })),
});
const bridgeItem = (
  memberKey: string,
  displayLabel: string,
  action: BridgeSequenceAction,
  order: number,
) => ({
  id: `pnl-${memberKey}`,
  memberKey,
  displayLabel,
  measureKey: "amount",
  measureLabel: "Сумма",
  action,
  order,
  enabled: true,
});
type PresetPage = Omit<BuilderPage, "pageFilters" | "widgets" | "layouts"> & {
  pageFilters?: BuilderPage["pageFilters"];
};
export const PRESETS: PresetPage[] = [
  {
    id: "lifecycle",
    label: "Lifecycle: долг, движения и ставка",
    description: "Выдачи и погашения объясняют динамику остатка",
    config: combo(
      "credit_lifecycle",
      ["0date"],
      [
        ["loan", "column", "left"],
        ["payment", "column", "left"],
        ["balance_at_date", "line", "left"],
        ["rate", "line", "right"],
      ],
    ),
  },
  {
    id: "rates",
    label: "Ключевая ставка: факт / BASE / OPTM",
    description: "Сценарная траектория ставки",
    config: {
      ...base(
        "key_rate_scenarios",
        "line",
        ["period"],
        ["key_rate"],
        ["scenario_series"],
      ),
      actualForecast: actualForecast({ enabled: true, splitMode: "series" }),
    },
  },
  {
    id: "reserves",
    label: "Структура резервов",
    description: "Резерв ссуды по договорам",
    config: base(
      "credit_lifecycle",
      "stacked-column",
      ["0date"],
      ["loan_reserve"],
      ["fin_doc_num"],
    ),
  },
  {
    id: "exposure",
    label: "Экспозиция по договорам",
    description: "IFRS scope в структуре портфеля",
    config: base("credit_lifecycle", "pie", ["fin_doc_num"], ["ifrs_scope"]),
  },
  {
    id: "risk",
    label: "RWA и финансовый рычаг",
    description: "Синхронные риск-показатели",
    config: {
      ...base(
        "credit_lifecycle",
        "small-multiples",
        ["0date"],
        [
          "rwa_loan",
          "rwa_norev_credit_line",
          "fin_leverage_loan",
          "fin_leverage_norev_credit_line",
        ],
      ),
      smallMultiplesSyncCursor: true,
    },
  },
  {
    id: "threshold",
    label: "Расходы: Fact / Plan",
    description: "Отклонение и статус относительно порогов",
    config: {
      ...base("threshold_finance", "threshold-comparison", [], []),
      thresholdComparison: {
        ...DEFAULT_THRESHOLD_SETTINGS,
        actual: {
          source: "metric",
          fieldId: "actual_value",
          aggregation: "SUM",
        },
        reference: {
          source: "metric",
          fieldId: "reference_value",
          aggregation: "SUM",
        },
        referenceType: "plan",
        direction: "lower_is_better",
      },
    },
    pageFilters: [
      {
        fieldId: "period",
        kind: "date-range" as const,
        granularity: "month" as const,
        defaultValue: { from: "202604", to: "202604" },
      },
    ],
  },
  {
    id: "rolling-forecast",
    label: "Ключевая ставка: analyst target",
    description: "12-месячный rolling forecast и диапазон оценок",
    config: {
      ...base("rolling_key_rate", "rolling-forecast", [], []),
      rollingForecast: {
        ...DEFAULT_ROLLING_SETTINGS,
        forecastDatasetId: "key_rate_forecast",
        actualDatasetId: "key_rate_actual",
        bindings: {
          observationDateField: "0date",
          actualValueField: "key_rate",
          targetDateField: "0calmonth",
          forecastValueField: "key_rate",
          lowerBoundField: "low_rate",
          upperBoundField: "upper_rate",
          forecastVersionField: "fin_version",
        },
      },
    },
    pageFilters: [
      {
        fieldId: "fin_scenario",
        kind: "categorical" as const,
        defaultValue: ["BASE"],
        scope: { type: "forecast" as const },
      },
    ],
  },
  {
    id: "pnl-waterfall",
    label: "Bridge / Waterfall: P&L",
    description: "От выручки к чистой прибыли",
    config: {
      ...base("writecube_fin_reports", "waterfall", [], []),
      waterfall: {
        ...DEFAULT_WATERFALL_SETTINGS,
        dimensionKey: "fin_acc",
        availableMeasureKeys: ["value"],
        defaultMeasureKey: "value",
        items: [
          bridgeItem("A3", "Кредиты, предоставленные НКО", "opening", 1),
          bridgeItem("A3.1", "Резервы по кредитам", "subtract", 2),
          bridgeItem("L12", "Прочие кредитные требования", "checkpoint", 3),
        ],
      },
    },
    pageFilters: [
      { fieldId: "fin_version", kind: "categorical" as const, defaultValue: ["FRC"] },
      { fieldId: "fin_scenario", kind: "categorical" as const, defaultValue: ["BASE"] },
      { fieldId: "0calmonth", kind: "date-range" as const, granularity: "month" as const, defaultValue: { from: "202607", to: "202607" } },
    ],
  },
  {
    id: "waterfall-custom",
    label: "Настраиваемый Bridge / Waterfall",
    description: "Пустая последовательность для настройки собственного движения показателя",
    config: {
      ...base("writecube_fin_reports", "waterfall", [], []),
      waterfall: {
        ...DEFAULT_WATERFALL_SETTINGS,
        dimensionKey: null,
        availableMeasureKeys: [],
        defaultMeasureKey: null,
        items: [],
      },
    },
    pageFilters: [
      { fieldId: "fin_version", kind: "categorical" as const, defaultValue: ["FRC"] },
      { fieldId: "fin_scenario", kind: "categorical" as const, defaultValue: ["BASE"] },
      { fieldId: "0calmonth", kind: "date-range" as const, granularity: "month" as const, defaultValue: { from: "202607", to: "202607" } },
    ],
  },
  {
    id: "bullet",
    label: "Факт ставки к прогнозу",
    description: "Actual относительно target",
    config: base(
      "key_rate_scenarios",
      "bullet",
      ["period"],
      ["key_rate", "loan_rate"],
    ),
  },
  {
    id: "kpi",
    label: "KPI кредитного портфеля",
    description: "Экспозиция, резервы, RWA и процент",
    config: {
      ...base(
        "credit_lifecycle",
        "kpi",
        [],
        ["ifrs_scope", "loan_reserve", "rwa_loan", "interest_accrued"],
      ),
      kpi: structuredClone(DEFAULT_KPI_SETTINGS),
    },
  },
  {
    id: "heatmap",
    label: "Концентрация экспозиции",
    description: "Договор × версия",
    config: base(
      "credit_lifecycle",
      "heatmap",
      ["fin_doc_num", "fin_version"],
      ["ifrs_scope"],
    ),
  },
  {
    id: "reporting",
    label: "Витрина fin_acc",
    description: "Derived mock финансовой отчетности",
    config: base(
      "financial_reporting",
      "column",
      ["fin_acc"],
      ["value"],
      ["fin_version"],
    ),
  },
  {
    id: "details",
    label: "Детальный расчет",
    description: "Точная таблица lifecycle",
    config: base(
      "credit_lifecycle",
      "table",
      ["fin_doc_num", "0date"],
      ["balance_at_date", "ifrs_scope", "loan_reserve"],
    ),
  },
];
export const DEFAULT_CONFIG = PRESETS[0].config;
const defaultLayouts = (id: string) => ({
  lg: [{ i: id, x: 0, y: 0, w: 12, h: 18, minW: 3, minH: 8 }],
  md: [{ i: id, x: 0, y: 0, w: 10, h: 18, minW: 3, minH: 8 }],
  sm: [{ i: id, x: 0, y: 0, w: 6, h: 18, minW: 2, minH: 8 }],
  xs: [{ i: id, x: 0, y: 0, w: 4, h: 18, minW: 2, minH: 8 }],
  xxs: [{ i: id, x: 0, y: 0, w: 2, h: 18, minW: 2, minH: 8 }],
});
export const DEFAULT_PAGES: BuilderPage[] = PRESETS.map((p) => ({
  ...p,
  config: structuredClone(p.config),
  widgets: [{ id: `${p.id}-chart`, type: "chart", title: p.label, description: p.description, chartConfig: structuredClone(p.config), datasetId: p.config.datasetId, visible: true }],
  layouts: defaultLayouts(`${p.id}-chart`),
  pageFilters: p.pageFilters ? structuredClone(p.pageFilters) : [],
}));
