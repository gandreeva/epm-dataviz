import type { ChartConfig, MetricBinding } from "../../types";

export const temporalHierarchyActive = (config: ChartConfig) => config.viewBy.some((fieldId) => config.viewByPresentation?.[fieldId]?.mode === "hierarchy");

export const effectiveMetricAggregation = (metric: MetricBinding, config: ChartConfig) => (
  temporalHierarchyActive(config) ? metric.hierarchyAggregation || metric.aggregation : metric.aggregation
);
