export type DatasetId =
  | "credit_lifecycle"
  | "contract_terms"
  | "key_rate_actual"
  | "key_rate_forecast"
  | "key_rate_scenarios"
  | "product_macro"
  | "financial_reporting"
  | "threshold_finance"
  | "rolling_key_rate"
  | "multi_mapping_demo"
  | "pnl_waterfall"
  | "writecube_fin_reports";
export type ChartType =
  | "column"
  | "line"
  | "pie"
  | "time-series-events"
  | "stacked-column"
  | "combo"
  | "waterfall"
  | "threshold-comparison"
  | "rolling-forecast"
  | "bullet"
  | "kpi"
  | "heatmap"
  | "table"
  | "small-multiples";
export type HierarchyAggregation = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNT_DISTINCT" | "FIRST_NON_NULL" | "LAST_NON_NULL";
export type Aggregation = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNT_DISTINCT" | "FIRST" | "LAST";
export type SeriesRenderType = "column" | "line";
export type FieldKind = "dimension" | "measure" | "event";
export type Unit = "currency" | "percent" | "count" | "date" | "text" | "ratio";
export type TimeGranularity = "day" | "month";
export type SeriesTimeRole =
  "actual" | "forecast" | "plan" | "scenario" | "unknown";
export interface DimensionMemberMeta {
  label: string;
  timeRole?: SeriesTimeRole;
}
export interface FieldSemantic {
  businessObject: string;
  role: string;
  dataType: "string" | "number" | "date";
  temporalKey?: string;
  granularity?: TimeGranularity;
  inputFormats?: string[];
  outputFormat?: string;
  referenceId?: string;
  members?: Record<string, DimensionMemberMeta>;
  hierarchies?: TimeHierarchyDefinition[];
}
export interface TimeHierarchyLevel {
  levelKey: string;
  levelLabel: string;
  depth: number;
  parentLevelKey?: string | null;
  childLevelKey?: string | null;
  ordinal?: number;
}
export interface TimeHierarchyDefinition {
  hierarchyId: string | number;
  hierarchyName: string;
  displayLabel: string;
  levels: TimeHierarchyLevel[];
  defaultLevelKey?: string | null;
  leafLevelKey: string;
  supportsDrill: boolean;
}
export interface TimeHierarchyPresentation {
  mode: "flat" | "hierarchy";
  activeHierarchyId: string | number | null;
  selectedLevelKey: string | null;
}
export interface FieldCatalogMeta {
  kind: FieldKind;
  label: string;
  unit: Unit;
  aggregations?: Aggregation[];
  semantic?: FieldSemantic;
  diagnostic?: string;
}
export interface DatasetPresentation {
  label: string;
  description: string;
  badge?: string;
}
export interface DatasetSemanticMeta extends DatasetPresentation {
  datasetId: DatasetId;
  businessObject?: string;
  cube?: string;
}
export type EventRule = "nonzero" | "change";
export interface EventProjectionCategory {
  key: string;
  sourceField: string;
  label: string;
  color: string;
  unit: Unit;
  rule: EventRule;
  order: number;
}
export interface EventProjectionConfig {
  dateField: string;
  partitionBy: string[];
  commentSource: string;
  categories: EventProjectionCategory[];
}
export interface EventComment {
  fin_version: string;
  fin_scenario: string;
  fin_doc_num: string;
  event_date: string;
  event_type: string;
  event_title: string;
  event_comment: string;
}
export interface DataRow {
  [key: string]: string | number | null;
}
export interface FieldMeta {
  id: string;
  label: string;
  kind: FieldKind;
  unit: Unit;
  aggregations?: Aggregation[];
  description?: string;
  semantic?: FieldSemantic;
  semanticDiagnostic?: string;
}
export interface Dataset {
  id: DatasetId;
  label: string;
  description: string;
  badge?: string;
  fields: FieldMeta[];
  rows: DataRow[];
  eventProjection?: EventProjectionConfig;
  eventComments?: EventComment[];
}
export interface MetricBinding {
  fieldId: string;
  aggregation: Aggregation;
  yAxisId: "left" | "right";
  seriesType?: SeriesRenderType;
  hierarchyAggregation?: HierarchyAggregation;
  hierarchyOrderLevel?: string | null;
  hierarchyNullPolicy?: "ignore" | "respect";
}
export interface ActualForecastSettings {
  enabled: boolean;
  splitMode: "date" | "field" | "series";
  statusField?: string | null;
  actualValues?: string[];
  forecastValues?: string[];
  showDivider: boolean;
  showPeriodLabels: boolean;
  forecastBackground: boolean;
  forecastLineStyle: "solid" | "dashed";
  actualLabel?: string;
  forecastLabel?: string;
}
export interface ValueBinding {
  source: "metric" | "manual";
  fieldId?: string | null;
  aggregation: Aggregation;
  manualValue?: number | null;
}
export type ThresholdDirection = "higher_is_better" | "lower_is_better";
export type ArticleDisplayField = "key" | "text" | "acc_type";
export type ThresholdSemantic = "good" | "warning" | "bad" | "neutral";
export interface ThresholdZone {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
  semantic: ThresholdSemantic;
  displayColor: "green" | "yellow" | "red" | "gray";
  description?: string | null;
}
export interface ThresholdComparisonSettings {
  datasetId?: DatasetId;
  mode?: "periods" | "versions";
  measureField?: string | null;
  accountField?: string | null;
  accountValue?: string | null;
  leftSlice?: ThresholdComparisonSlice;
  rightSlice?: ThresholdComparisonSlice;
  leftLabel?: string;
  rightLabel?: string;
  actual: ValueBinding;
  reference: ValueBinding;
  referenceType:
    "forecast" | "plan" | "target" | "benchmark" | "fair_value" | "model_value";
  percentageBase: "actual" | "reference";
  direction: ThresholdDirection;
  thresholdsMode: "percentage";
  thresholds: ThresholdZone[];
  showActualLabel: boolean;
  showReferenceLabel: boolean;
  showDeviation: boolean;
  showZoneLabels: boolean;
  showExplanation: boolean;
  showArticleLabel: boolean;
  articleFieldId?: string | null;
  articleDisplayField?: ArticleDisplayField;
  markerColors?: {
    actual: string;
    reference: string;
  };
  commonFilters?: Array<{ fieldId: string; value: string | null }>;
  differentiator?: { fieldId: string | null; valueA: string | null; valueB: string | null; labelA?: string; labelB?: string };
}
export interface ThresholdComparisonSlice {
  period: string | null;
  version: string | null;
  scenario: string | null;
}
export type ForecastHorizonUnit = "day" | "week" | "month" | "quarter" | "year";
export interface RollingForecastBindings {
  observationDateField?: string | null;
  actualValueField?: string | null;
  targetDateField?: string | null;
  forecastValueField?: string | null;
  lowerBoundField?: string | null;
  upperBoundField?: string | null;
  forecastVersionField?: string | null;
}
export interface RollingForecastFilter {
  id: string;
  source: "forecast" | "actual" | "both";
  fieldId: string;
  kind: "categorical" | "date-range";
  granularity?: TimeGranularity;
  value: PageFilterValue;
}
export interface RollingForecastSettings {
  bindings: RollingForecastBindings;
  forecastDatasetId: DatasetId | null;
  actualDatasetId: DatasetId | null;
  filters: RollingForecastFilter[];
  horizonValue: number;
  horizonUnit: ForecastHorizonUnit;
  observationDateMode: "hover" | "latest" | "selected";
  selectedObservationDate?: string | null;
  showLagConnector: boolean;
  showForecastBand: boolean;
  showForecastCenterLine: boolean;
  showObservationMarker: boolean;
  showTargetMarker: boolean;
  showSummaryCard: boolean;
  showPastForecastSplit: boolean;
  actualLabel?: string;
  forecastLabel?: string;
  pastLabel?: string;
  futureLabel?: string;
  timeHierarchy?: TimeHierarchyPresentation;
}
export type BridgeSequenceAction =
  | "opening"
  | "add"
  | "subtract"
  | "checkpoint"
  | "exclude";
export interface BridgeSequenceItemConfig {
  id: string;
  memberKey: string;
  memberPath?: string[];
  displayLabel: string;
  measureKey: string;
  measureLabel: string;
  action: BridgeSequenceAction;
  order: number;
  enabled: boolean;
}
export interface BridgeSequenceConfig {
  version: 2;
  dimensionKey: string | null;
  availableMeasureKeys: string[];
  defaultMeasureKey?: string | null;
  items: BridgeSequenceItemConfig[];
  memberReference?: {
    referenceId: string | null;
    attributeField: string | null;
    attributeValue: string | null;
  };
  valueInterpretation: "absolute_by_operator";
  validateCheckpoints: boolean;
  toleranceType: "absolute" | "percentage";
  toleranceValue: number;
  showConnectors: boolean;
  showValueLabels: boolean;
  showRunningBalance: boolean;
  showReconciliation: boolean;
  showReconciliationSummary: boolean;
  showWarnings: boolean;
  showDebug: boolean;
}
export interface SeriesSetting {
  visible: boolean;
  color?: string;
  order: number;
  yAxisId?: "left" | "right";
  timeRole?: SeriesTimeRole;
}
export interface ChartConfig {
  version: 1;
  datasetId: DatasetId;
  chartType: ChartType;
  viewBy: string[];
  viewByPresentation?: Record<string, TimeHierarchyPresentation>;
  stackBy: string[];
  metrics: MetricBinding[];
  eventFields: string[];
  eventCategoryVisibility: Record<string, boolean>;
  filters: Record<string, string[]>;
  dualAxisEnabled?: boolean;
  smallMultiplesSyncCursor?: boolean;
  seriesSettings: Record<string, SeriesSetting>;
  actualForecast?: ActualForecastSettings;
  thresholdComparison?: ThresholdComparisonSettings;
  rollingForecast?: RollingForecastSettings;
  waterfall?: BridgeSequenceConfig;
  pie?: PieSettings;
  kpi?: KpiSettings;
}
export interface ChartPoint {
  categoryKey: string;
  categoryLabel: string;
  timestamp?: number;
  [key: string]: string | number | null | undefined;
}
export interface ChartSeries {
  id: string;
  dataKey: string;
  label: string;
  fullLabel: string;
  measureId: string;
  measureKey: string;
  measureLabel: string;
  columnPath: Array<{ dimensionKey: string; value: string; label: string }>;
  order: number;
  color: string;
  visible: boolean;
  unit: Unit;
  seriesType: SeriesRenderType;
  yAxisId: "left" | "right";
  timeRole?: SeriesTimeRole;
  valueFormat?: { precision?: number; unit?: string };
}
export interface PieSettings {
  donut: boolean;
  innerRadiusPercent: number;
  labelPosition: "inside" | "legend" | "callout";
  showLabels: boolean;
  showLegend: boolean;
  legendPosition: "right" | "bottom";
  legendValueMode: "value" | "percent" | "value-percent";
  showTotal: boolean;
  totalLabel?: string;
  sliceLimit: number | null;
  groupRemainingAsOther: boolean;
  otherLabel: string;
  palette: string[];
  paddingAngle: number;
}
export interface KpiSettings {
  timeFieldId?: string | null;
  comparisonSource: "none" | "previous-period";
  comparisonOffset?: number;
  comparisonType: "none" | "absolute" | "percent";
  showPeriodLabel: boolean;
  showComparisonLabel: boolean;
  showTrendIndicator: boolean;
  showSparkline: boolean;
  layout: "auto" | "horizontal" | "vertical";
  alignment: "left" | "center" | "right";
  labelFontSize: "small" | "medium" | "large";
  valueFontSize: "medium" | "large" | "xlarge";
  positiveColor: string;
  negativeColor: string;
  neutralColor: string;
  reverseComparisonColor: boolean;
  title?: string;
  note?: string;
}
export interface KpiCardModel {
  id: string;
  label: string;
  unit: Unit;
  currentValue: number | null;
  currentPeriodLabel?: string;
  comparisonValue: number | null;
  comparisonPeriodLabel?: string;
  absoluteDelta: number | null;
  percentDelta: number | null;
  trend: "up" | "down" | "flat" | "unknown";
  sparkline: Array<{ timestamp?: number; label: string; value: number | null }>;
}
export interface KpiModel {
  cards: KpiCardModel[];
  settings: KpiSettings;
  title?: string;
  note?: string;
}
export interface PointSeriesContext {
  timeRole: SeriesTimeRole;
  statusValues: string[];
  scenarioValues: string[];
  versionValues: string[];
  conflict?: boolean;
}
export interface ResolvedActualForecast {
  enabled: boolean;
  splitTimestamp: number;
  splitDate: string;
  settings: ActualForecastSettings;
  contexts: Record<string, Record<string, PointSeriesContext>>;
}
export interface ThresholdComparisonModel {
  metricLabel: string;
  unit: Unit;
  actualValue: number;
  referenceValue: number;
  referenceType: ThresholdComparisonSettings["referenceType"];
  absoluteDeviation: number;
  percentageDeviation: number | null;
  percentageBase: ThresholdComparisonSettings["percentageBase"];
  direction: ThresholdDirection;
  thresholds: ThresholdZone[];
  currentZoneKey: string | null;
  statusLabel: string;
  explanation: string;
  scaleMin: number;
  scaleMax: number;
  thresholdValueRanges: Array<ThresholdZone & { valueFrom: number; valueTo: number }>;
  markerColors: {
    actual: string;
    reference: string;
  };
  accountKey?: string | null;
  accountLabel?: string | null;
  leftValue?: number;
  rightValue?: number;
  leftSlice?: ThresholdComparisonSlice;
  rightSlice?: ThresholdComparisonSlice;
  leftLabel?: string;
  rightLabel?: string;
  comparisonLabel?: string;
  articleLabel?: string | null;
  articleFieldLabel?: string | null;
  showArticleLabel?: boolean;
}
export interface RollingForecastActualPoint {
  date: string;
  timestamp: number;
  value: number;
}
export interface RollingForecastVintage {
  observationDate: string;
  observationTimestamp: number;
  actualValue: number;
  targetDate: string;
  targetTimestamp: number;
  forecastValue: number;
  lowerBound: number | null;
  upperBound: number | null;
  forecastVersion: string | null;
}
export interface RollingForecastModel {
  actualSeries: RollingForecastActualPoint[];
  vintages: RollingForecastVintage[];
  selected: RollingForecastVintage;
  unit: Unit;
  horizonLabel: string;
  absoluteDelta: number;
  percentageDelta: number | null;
  settings: RollingForecastSettings;
}
export type BridgeRenderRole =
  | "opening"
  | "positive_movement"
  | "negative_movement"
  | "checkpoint";
export interface BridgeRenderItem {
  id: string;
  waterfallItemId: string;
  memberKey: string;
  measureKey: string;
  label: string;
  measureLabel: string;
  role: BridgeRenderRole;
  signedValue: number;
  displayValue: number;
  order: number;
  base: number;
  height: number;
  runningBefore: number;
  runningAfter: number;
  isTerminalCheckpoint: boolean;
  reportedValue?: number | null;
  calculatedValue?: number | null;
  difference?: number | null;
  reconciliationStatus?: "ok" | "warning" | null;
  valueSource?: "transaction" | "calculated" | "missing";
  unit: Unit;
}
export interface BridgeModel {
  items: BridgeRenderItem[];
  unit: Unit;
  settings: BridgeSequenceConfig;
  availableMemberKeys: string[];
  availableMeasureKeys: string[];
  unresolvedItemIds: string[];
  newMemberKeys: string[];
  newMeasureKeys: string[];
}
export interface ChartEvent {
  id: string;
  date: string;
  timestamp: number;
  title: string;
  comment: string;
  categoryKey: string;
  categoryLabel: string;
  color: string;
  unit: Unit;
  importance: "medium";
  relatedValue: number;
  documentId: string;
  version: string;
  scenario: string;
  sourceType: "lifecycle-projection";
  sourceId: string;
}
export interface ChartEventCategory {
  key: string;
  label: string;
  color: string;
  order: number;
  visible: boolean;
}
export interface ChartModel {
  data: ChartPoint[];
  series: ChartSeries[];
  categories: string[];
  events: ChartEvent[];
  eventCategories: ChartEventCategory[];
  timeDomain?: [number, number];
  actualForecast?: ResolvedActualForecast;
  thresholdComparison?: ThresholdComparisonModel;
  rollingForecast?: RollingForecastModel;
  waterfall?: BridgeModel;
  kpi?: KpiModel;
  diagnostics: string[];
  warnings: string[];
}
export type PageFilterDefinition =
  | { fieldId: string; kind: "categorical"; defaultValue: string[]; temporalKey?: string; source?: PageFilterSource; scope?: { type: "page" | "forecast" | "actual" | "both"; fieldId?: string; forecastFieldId?: string; actualFieldId?: string } }
  | {
      fieldId: string;
      kind: "date-range";
      granularity: TimeGranularity;
      defaultValue: { from: string; to: string };
      temporalKey?: string;
      source?: PageFilterSource;
      scope?: { type: "page" | "forecast" | "actual" | "both"; fieldId?: string; forecastFieldId?: string; actualFieldId?: string };
    };
export interface PageFilterSource {
  datasetId: DatasetId;
  fieldId: string;
  semanticRole?: string;
  dataType?: FieldSemantic["dataType"];
  temporalKey?: string;
  granularity?: TimeGranularity;
}
export type PageFilterValue = string[] | { from: string; to: string };
export type PageFilterState = Record<string, PageFilterValue>;
export type WidgetType = "chart" | "kpi" | "table" | "pivot-table" | "text" | "markdown";
export interface MarkdownWidgetConfig {
  sourceWidgetId: string | null;
  template: string;
  enabled: boolean;
  maxRows: number;
  allowHtml: boolean;
  allowCss: boolean;
}
export type PivotAggregationOperation = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNT_DISTINCT";
export interface PivotAggregation {
  id: string;
  measureField: string;
  operation: PivotAggregationOperation;
  label: string;
  format?: { unit?: string; scale?: string; decimals?: number };
  visible: boolean;
}
export interface PivotSortRule {
  field: string;
  target: "key" | string;
  direction: "asc" | "desc";
}
export interface PivotConditionalRule {
  id: string;
  operator: "=" | "!=" | ">" | ">=" | "<" | "<=" | "between" | "not between";
  value: number | "";
  valueTo?: number | "";
  textColor: string;
  backgroundColor: string;
  highlightEntireRow: boolean;
  enabled: boolean;
}
export interface PivotConditionalFormatting {
  id: string;
  target: { aggregationId: string; columnPath: Array<{ field: string; key: string }> };
  mode: "single" | "scale";
  applyTo: { detail: boolean; subtotal: boolean; grandTotal: boolean };
  rules: PivotConditionalRule[];
  scale: { min: { value: number | ""; color: string }; mid?: { value: number | ""; color: string }; max: { value: number | ""; color: string } };
}
export interface PivotDataBar {
  id: string;
  type: "bar";
  target: { scope: "column" | "aggregation"; aggregationId: string; columnPath: Array<{ field: string; key: string }> };
  style: "normal" | "slim";
  showTrack: boolean;
  colors: { mode: "sign" | "category"; positive: string; negative: string; track: string; categoryField?: string | null; categoryValues: Record<string, string> };
  range: { mode: "auto" | "manual"; min?: number | null; max?: number | null };
  applyTo: { detail: boolean; subtotal: boolean; grandTotal: boolean };
}
export interface PivotHeatmapConfig {
  id: string;
  aggregationId: string;
  enabled: boolean;
  palette: { min: string; max: string };
  range: { mode: "auto" };
  applyTo: { detail: boolean; subtotal: boolean; grandTotal: boolean };
}
export interface PivotTableConfig {
  datasetId: DatasetId;
  rows: string[];
  columns: string[];
  aggregations: PivotAggregation[];
  rowSorts: PivotSortRule[];
  columnSorts: PivotSortRule[];
  expansion: { rows: string[]; columns: string[] };
  formatting: Record<string, { decimals?: number; unit?: string; scale?: string }>;
  conditionalFormatting: PivotConditionalFormatting[];
  dataBars: PivotDataBar[];
  heatmapModes: PivotHeatmapConfig[];
  sourceRevision: number;
  rowLayout?: "compact" | "tabular";
}
export type DashboardBreakpoint = "lg" | "md" | "sm" | "xs" | "xxs";
export interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}
export type ResponsiveLayouts = Record<DashboardBreakpoint, GridLayoutItem[]>;
export interface DashboardWidget {
  id: string;
  type: WidgetType;
  title: string;
  description?: string;
  chartConfig?: ChartConfig;
  pivotConfig?: PivotTableConfig;
  datasetId?: DatasetId;
  textContent?: string;
  markdownConfig?: MarkdownWidgetConfig;
  visible: boolean;
  minW?: number;
  minH?: number;
}
export interface PageHeaderConfig {
  markdown: string;
  color: string;
  backgroundColor: string;
}
export interface BuilderPage {
  id: string;
  label: string;
  description: string;
  header?: PageHeaderConfig;
  config: ChartConfig;
  widgets: DashboardWidget[];
  layouts: ResponsiveLayouts;
  pageFilters: PageFilterDefinition[];
}
export interface DashboardParameters {
  splitDate: string | null;
}
export interface BuilderDashboard {
  version: 2;
  pages: BuilderPage[];
  parameters: DashboardParameters;
}
