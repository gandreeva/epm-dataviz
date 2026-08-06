import type { BuilderDashboard, BuilderPage, ResponsiveLayouts, PivotConditionalFormatting, PivotDataBar, PivotHeatmapConfig, PivotTableConfig } from "../types";
import { DEFAULT_WATERFALL_SETTINGS } from "../query/specializedCharts";
import { FIN_ACCOUNT_DISPLAY } from "../data/datasets";

export const isValidSplitDate = (
  value: string | null | undefined,
): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number),
    date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};
export const normalizeSplitDateInput = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  if (/^\d{8}$/.test(value))
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
  return value;
};
export const makeDashboard = (pages: BuilderPage[]): BuilderDashboard => ({
  version: 2,
  pages: structuredClone(pages),
  parameters: { splitDate: null },
});
const defaultLayouts = (id: string): ResponsiveLayouts => ({
  lg: [{ i: id, x: 0, y: 0, w: 12, h: 18, minW: 3, minH: 8 }],
  md: [{ i: id, x: 0, y: 0, w: 10, h: 18, minW: 3, minH: 8 }],
  sm: [{ i: id, x: 0, y: 0, w: 6, h: 18, minW: 2, minH: 8 }],
  xs: [{ i: id, x: 0, y: 0, w: 4, h: 18, minW: 2, minH: 8 }],
  xxs: [{ i: id, x: 0, y: 0, w: 2, h: 18, minW: 2, minH: 8 }],
});
const DEFAULT_TEXT_CONTENT = `# Новый комментарий

Добавьте описание, выводы или формулу.

$E = mc^2$`;
const normalizePivotConfig = (value: unknown): PivotTableConfig | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<PivotTableConfig> & { keyFilters?: unknown; sourceFilters?: unknown };
  const conditionalFormatting: PivotConditionalFormatting[] = Array.isArray(raw.conditionalFormatting)
    ? raw.conditionalFormatting.map((item: any, index) => item.target ? item : ({ id: item.id || `cf-migrated-${index}`, target: { aggregationId: item.aggregationId, columnPath: [] }, mode: "single", applyTo: { detail: true, subtotal: false, grandTotal: false }, rules: [{ id: `rule-migrated-${index}`, operator: item.operator === "gt" ? ">" : item.operator === "lt" ? "<" : item.operator === "lte" ? "<=" : item.operator === "eq" ? "=" : ">=", value: item.value ?? 0, textColor: "#166534", backgroundColor: item.color || "#DCFCE7", highlightEntireRow: false, enabled: true }], scale: { min: { value: 0, color: "#FEF3C7" }, mid: { value: "", color: "#BAE6FD" }, max: { value: 1, color: "#15803D" } } }))
    : [];
  const dataBars: PivotDataBar[] = Array.isArray(raw.dataBars)
    ? raw.dataBars.map((item: any, index) => item.target ? item : ({ id: item.id || `bar-migrated-${index}`, type: "bar", target: { scope: item.scope === "column" ? "column" : "aggregation", aggregationId: item.aggregationId, columnPath: [] }, style: "normal", showTrack: true, colors: { mode: "sign", positive: item.color || "#8bb8d8", negative: "#c44536", track: "#eef1f4", categoryValues: {} }, range: { mode: "auto", min: null, max: null }, applyTo: { detail: true, subtotal: false, grandTotal: false } }))
    : [];
  const heatmapModes: PivotHeatmapConfig[] = Array.isArray(raw.heatmapModes)
    ? raw.heatmapModes.map((item: any, index) => ({ id: item.id || `heatmap-${index}`, aggregationId: item.aggregationId, enabled: item.enabled !== false, palette: { min: item.palette?.min || "#F1FAFC", max: item.palette?.max || "#0A8FB4" }, range: { mode: "auto" }, applyTo: { detail: item.applyTo?.detail !== false, subtotal: item.applyTo?.subtotal !== false, grandTotal: item.applyTo?.grandTotal !== false } }))
    : [];
  const { keyFilters: _keyFilters, sourceFilters: _sourceFilters, ...rest } = raw;
  return { ...rest, conditionalFormatting, dataBars, heatmapModes, rowLayout: raw.rowLayout || "compact" } as PivotTableConfig;
};
const normalizePage = (page: BuilderPage): BuilderPage => {
  const config = page.config;
  const widgetId = `${page.id}-chart`;
  const widgets = Array.isArray(page.widgets) && page.widgets.length
    ? page.widgets.map((widget) => {
        const normalizedText = widget.type === "text" && widget.textContent === undefined
          ? { ...widget, textContent: DEFAULT_TEXT_CONTENT }
          : widget;
        const normalizedMarkdown = widget.type === "markdown" && widget.markdownConfig === undefined
          ? { ...normalizedText, markdownConfig: { sourceWidgetId: null, template: "# Markdown\n\nВыберите табличный источник.", enabled: true, maxRows: 100, allowHtml: true, allowCss: true } }
          : normalizedText;
        if (widget.type === "pivot-table" && widget.pivotConfig) return { ...normalizedMarkdown, pivotConfig: normalizePivotConfig(widget.pivotConfig) };
        if ((widget.type !== "kpi" && widget.type !== "table") || widget.chartConfig) return normalizedMarkdown;
        return {
          ...normalizedMarkdown,
          chartConfig: { ...structuredClone(config), chartType: widget.type === "table" ? "table" as const : "kpi" as const },
          datasetId: widget.datasetId || config.datasetId,
        };
      })
    : [{ id: widgetId, type: "chart" as const, title: page.label, description: page.description, chartConfig: structuredClone(config), datasetId: config.datasetId, visible: true }];
  return {
    ...page,
    header: page.header
      ? {
          markdown: page.header.markdown || "",
          color: page.header.color || "#1f2933",
          backgroundColor: page.header.backgroundColor || "transparent",
        }
      : undefined,
    widgets,
    layouts: page.layouts || defaultLayouts(widgetId),
  };
};
export const migrateDashboard = (
  value: unknown,
  fallbackPages: BuilderPage[],
): BuilderDashboard => {
  const migrateWaterfall = (pages: BuilderPage[]) => pages.map(normalizePage).map((page) => {
    if (page.config.chartType !== "waterfall") return page;
    const waterfall = page.config.waterfall?.version === 2
      ? page.config.waterfall
      : structuredClone(DEFAULT_WATERFALL_SETTINGS);
    if (waterfall.dimensionKey === "fin_acc") {
      waterfall.items = waterfall.items.map((item) => ({
        ...item,
        displayLabel: FIN_ACCOUNT_DISPLAY[item.memberKey]?.text
          ? `${FIN_ACCOUNT_DISPLAY[item.memberKey].text} (${item.memberKey})`
          : item.displayLabel,
      }));
    }
    return { ...page, config: { ...page.config, waterfall } };
  });
  const withNewSpecializedPages = (pages: BuilderPage[]) => {
    const newPresetIds = new Set([
      "threshold",
      "rolling-forecast",
      "pnl-waterfall",
      "waterfall-custom",
    ]);
    return migrateWaterfall([
      ...pages,
      ...fallbackPages.filter(
        (page) =>
          newPresetIds.has(page.id) &&
          !pages.some((existing) => existing.id === page.id),
      ),
    ]);
  };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Partial<BuilderDashboard>;
    if (Array.isArray(candidate.pages))
      return {
        version: 2,
        pages: withNewSpecializedPages(candidate.pages),
        parameters: { splitDate: normalizeSplitDateInput(candidate.parameters?.splitDate) },
      };
  }
  if (Array.isArray(value))
    return {
      version: 2,
      pages: withNewSpecializedPages(value as BuilderPage[]),
      parameters: { splitDate: null },
    };
  return makeDashboard(fallbackPages);
};
