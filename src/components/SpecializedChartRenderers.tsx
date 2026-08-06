import React, { type CSSProperties } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  BridgeModel,
  BridgeRenderItem,
  RollingForecastModel,
  ThresholdComparisonModel,
  ThresholdZone,
  Unit,
} from "../types";
import { UI_IDS, ui } from "../uiIds";
import { useTranslation } from "react-i18next";
const ROLLING_DEBUG = import.meta.env?.DEV !== false && (typeof window === "undefined" || window.localStorage.getItem("rolling-forecast.debug") !== "false");
const WATERFALL_LABEL_DEBUG = import.meta.env?.DEV !== false && (typeof window === "undefined" || window.localStorage.getItem("waterfall-label.debug") === "true");
const WATERFALL_DEBUG = import.meta.env?.DEV !== false && (typeof window === "undefined" || window.localStorage.getItem("waterfall.debug") === "true");
const rollingDebug = (...args: unknown[]) => { if (ROLLING_DEBUG) console.info("[rolling-forecast]", ...args); };
const rollingWarn = (...args: unknown[]) => console.warn("[rolling-forecast]", ...args);

const formatValue = (
  value: number | null | undefined,
  unit: Unit,
  compact = true,
) => {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "percent" || unit === "ratio")
    return new Intl.NumberFormat("ru-RU", {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value);
  const formatted = new Intl.NumberFormat("ru-RU", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
  return unit === "currency" ? `${formatted} ₽` : formatted;
};
const formatPercent = (value: number | null) =>
  value === null
    ? "—"
    : `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)}%`;
const thresholdZoneColor = (color: ThresholdZone["displayColor"]) =>
  ({ green: "#248b61", yellow: "#e2aa18", red: "#6b3b3b", gray: "#879398" })[color];
const dateLabel = (value: string) =>
  value.length === 8
    ? `${value.slice(6, 8)}.${value.slice(4, 6)}.${value.slice(0, 4)}`
    : value;
const timestampLabel = (value: unknown) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Number(value)));
const hierarchyTimestampLabel = (value: unknown, level?: string | null) => {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "—";
  const year = date.getUTCFullYear();
  if (level === "YEAR") return String(year);
  if (level === "HALF_YEAR") return `${year} H${date.getUTCMonth() < 6 ? 1 : 2}`;
  if (level === "QUARTER") return `${year} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  if (level === "MONTH") return new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return timestampLabel(value);
};

export function ThresholdComparisonChart({
  model,
}: {
  model: ThresholdComparisonModel;
}) {
  const { t } = useTranslation("threshold");
  const span = model.scaleMax - model.scaleMin || 1,
    position = (value: number) =>
      Math.max(0, Math.min(100, ((value - model.scaleMin) / span) * 100)),
    referencePosition = position(model.referenceValue),
    actualPosition = position(model.actualValue),
    left = Math.min(referencePosition, actualPosition),
    width = Math.abs(referencePosition - actualPosition),
    zone = model.thresholds.find((item) => item.key === model.currentZoneKey),
    semantic = zone?.semantic || "neutral";
  return (
    <section
      {...ui(UI_IDS.threshold.chart)}
      className="threshold-chart"
      aria-label={`${model.metricLabel}: ${model.statusLabel}`}
    >
      <div className="threshold-visual">
        <div className="threshold-zone-labels">
          {model.thresholdValueRanges.map((item) => {
            return (
              <span
                key={item.key}
                style={{
                  width: `${Math.max(0, position(item.valueTo) - position(item.valueFrom))}%`,
                }}
              >
                {t(`zones.${item.semantic}`, { defaultValue: item.label })}
              </span>
            );
          })}
        </div>
        <div className="threshold-scale">
          {model.thresholdValueRanges.map((item) => {
            return (
              <span
                key={item.key}
                className={item.semantic}
                style={{
                  width: `${Math.max(0, position(item.valueTo) - position(item.valueFrom))}%`,
                  backgroundColor: thresholdZoneColor(item.displayColor),
                }}
              />
            );
          })}
          <button
            {...ui(UI_IDS.threshold.marker("actual"))}
            className="threshold-marker actual"
            style={{ left: 0, width: `${actualPosition}%`, "--threshold-marker-fill": model.markerColors.actual } as CSSProperties}
            aria-label={`${model.leftLabel || model.comparisonLabel || t("actual")} ${model.articleLabel ? `${model.articleLabel} ` : ""}${formatValue(model.actualValue, model.unit)}`}
          >
            <span className="threshold-marker-content">
              <b>{model.leftLabel || model.comparisonLabel || t("actual")}</b>
              {model.showArticleLabel && model.articleLabel && <small>{model.articleLabel}</small>}
              <small>{formatValue(model.actualValue, model.unit)}</small>
            </span>
          </button>
          <button
            {...ui(UI_IDS.threshold.marker("reference"))}
            className="threshold-marker reference"
            style={{ left: 0, width: `${referencePosition}%`, "--threshold-marker-fill": model.markerColors.reference } as CSSProperties}
            aria-label={`${model.rightLabel || model.comparisonLabel || model.referenceType} ${model.articleLabel ? `${model.articleLabel} ` : ""}${formatValue(model.referenceValue, model.unit)}`}
          >
            <span className="threshold-marker-content">
              <small>{model.rightLabel || model.comparisonLabel || t(`referenceTypes.${model.referenceType}`, { defaultValue: model.referenceType })}</small>
              {model.showArticleLabel && model.articleLabel && <small>{model.articleLabel}</small>}
              <b>{formatValue(model.referenceValue, model.unit)}</b>
            </span>
          </button>
          {model.percentageDeviation !== null && (
            <span
              {...ui(UI_IDS.threshold.bracket)}
              className="threshold-bracket"
              style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
            >
              <b>{formatPercent(model.percentageDeviation)}</b>
              <small>{t(`status.${semantic}`, { defaultValue: model.statusLabel })}</small>
            </span>
          )}
        </div>
      </div>
      <aside {...ui(UI_IDS.threshold.summary)} className="threshold-summary">
        <small>{t("title")}</small>
        <h3>{model.showArticleLabel && model.articleLabel ? model.articleLabel : model.metricLabel}</h3>
        <dl>
          <dt>{model.leftLabel || model.comparisonLabel || t("actual")}</dt>
          <dd>{formatValue(model.actualValue, model.unit)}</dd>
          <dt>{model.rightLabel || model.comparisonLabel || t(`referenceTypes.${model.referenceType}`, { defaultValue: model.referenceType })}</dt>
          <dd>{formatValue(model.referenceValue, model.unit)}</dd>
          <dt>{t("absoluteDeviation")}</dt>
          <dd>{formatValue(model.absoluteDeviation, model.unit)}</dd>
          <dt>{t("percentageDeviation")}</dt>
          <dd>{formatPercent(model.percentageDeviation)}</dd>
        </dl>
        <div className={`threshold-status ${semantic}`}>
          <b>{t(`status.${semantic}`, { defaultValue: model.statusLabel })}</b>
        </div>
        <p>{model.explanation}</p>
      </aside>
      <table className="specialized-data-table">
        <caption>{model.metricLabel}</caption>
        <thead>
          <tr>
            <th>{model.leftLabel || model.comparisonLabel || t("actual")}</th>
            <th>{model.rightLabel || model.comparisonLabel || t("reference")}</th>
            <th>{t("percentageDeviation")}</th>
            <th>{t("statusLabel")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{model.actualValue}</td>
            <td>{model.referenceValue}</td>
            <td>{model.percentageDeviation ?? "Недоступно"}</td>
            <td>{model.statusLabel}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function RollingObservationTooltip({ actual, model }: { actual: RollingForecastModel["actualSeries"][number]; model: RollingForecastModel }) {
  return <div className="builder-tooltip rolling-forecast-tooltip-card"><b>{dateLabel(actual.date)}</b><span>Факт: {formatValue(actual.value, model.unit)}</span></div>;
}
function RollingForecastTooltipCard({ vintage, model }: { vintage: RollingForecastModel["selected"]; model: RollingForecastModel }) {
  return <div className="builder-tooltip rolling-forecast-tooltip-card"><b>{dateLabel(vintage.targetDate)}</b><span>Прогноз: {formatValue(vintage.forecastValue, model.unit)}</span>{vintage.lowerBound !== null && <span>Нижняя граница: {formatValue(vintage.lowerBound, model.unit)}</span>}{vintage.upperBound !== null && <span>Верхняя граница: {formatValue(vintage.upperBound, model.unit)}</span>}{vintage.forecastVersion && <span>Версия: {vintage.forecastVersion}</span>}</div>;
}

function RollingTooltip({ active, payload, model }: any) {
  if (!active || !payload?.length) return null;
  const point = payload.find((entry: any) => entry?.payload?.vintage || entry?.payload?.forecastTarget)?.payload || payload[0]?.payload,
    timestamp = Number(point?.timestamp),
    vintage = point?.vintage as RollingForecastModel["selected"] | undefined,
    selected = vintage || (model.selected as RollingForecastModel["selected"]);
  if (point?.forecastTarget || timestamp === selected.targetTimestamp)
    return <RollingForecastTooltipCard vintage={selected} model={model} />;
  const actual = model.actualSeries.find(
    (item: any) => item.timestamp === timestamp,
  );
  return actual ? <RollingObservationTooltip actual={actual} model={model} /> : null;
}

export function RollingForecastChart({
  model,
  onSelectVintage,
}: {
  model: RollingForecastModel;
  onSelectVintage?: (date: string) => void;
}) {
  const renderCount = React.useRef(0);
  renderCount.current += 1;
  React.useEffect(() => { rollingDebug("RollingForecastChart mounted", { vintages: model.vintages.length, actualSeries: model.actualSeries.length }); return () => rollingDebug("RollingForecastChart unmounted"); }, []);
  React.useEffect(() => { if (!model.vintages.length) rollingWarn("model has no vintages"); if (!model.selected) rollingWarn("model has no selected vintage"); }, [model.vintages.length, model.selected]);
  const [clickedObservationDate, setClickedObservationDate] = React.useState<string | null>(null);
  const [connectedObservationDate, setConnectedObservationDate] = React.useState<string | null>(null);
  const [changedSummary, setChangedSummary] = React.useState<Set<string>>(new Set());
  const previousVintage = React.useRef<string | null>(null);
  const vintageByObservationDate = React.useMemo(() => new Map(model.vintages.map((item) => [item.observationDate, item])), [model.vintages]);
  const vintageByObservationTimestamp = React.useMemo(() => new Map(model.vintages.map((item) => [item.observationTimestamp, item])), [model.vintages]);
  React.useEffect(() => {
    if (connectedObservationDate && !vintageByObservationDate.has(connectedObservationDate)) setConnectedObservationDate(null);
    if (clickedObservationDate && !vintageByObservationDate.has(clickedObservationDate)) setClickedObservationDate(null);
  }, [clickedObservationDate, connectedObservationDate, vintageByObservationDate]);
  React.useEffect(() => {
    rollingDebug("render", { render: renderCount.current, vintages: model.vintages.length, actualSeries: model.actualSeries.length, selected: model.selected?.observationDate, clicked: clickedObservationDate });
  });
  const selected = model.selected,
    hoverEnabled = model.settings.observationDateMode === "hover",
    activeVintage = (clickedObservationDate ? vintageByObservationDate.get(clickedObservationDate) : undefined) || selected,
    connectedVintage = (connectedObservationDate ? vintageByObservationDate.get(connectedObservationDate) : undefined),
    displayVintage = activeVintage,
    displayDelta = displayVintage.forecastValue - displayVintage.actualValue,
    displayPercentageDelta = displayVintage.actualValue === 0
      ? null
      : (displayDelta / Math.abs(displayVintage.actualValue)) * 100,
    points = React.useMemo(() => {
      const next = new Map<number, any>();
      for (const item of model.actualSeries) {
        next.set(item.timestamp, { timestamp: item.timestamp, date: item.date, vintageActual: item.value, actual: item.value, vintage: vintageByObservationDate.get(item.date) });
      }
      for (const vintage of model.vintages) {
        const target = next.get(vintage.targetTimestamp) || { timestamp: vintage.targetTimestamp, date: vintage.targetDate };
        Object.assign(target, { forecastTarget: vintage.forecastValue, forecastLower: vintage.lowerBound, forecastUpper: vintage.upperBound, forecast: vintage.forecastValue, band: [vintage.lowerBound ?? vintage.forecastValue, vintage.upperBound ?? vintage.forecastValue], vintage });
        next.set(vintage.targetTimestamp, target);
      }
      return next;
    }, [model.actualSeries, model.vintages, vintageByObservationDate]);
  React.useEffect(() => {
    const key = `${displayVintage.observationDate}|${displayVintage.targetDate}`;
    if (previousVintage.current !== null && previousVintage.current !== key) {
      const previous = model.vintages.find((item) => `${item.observationDate}|${item.targetDate}` === previousVintage.current);
      const changed = new Set<string>();
      if (previous?.observationDate !== displayVintage.observationDate) changed.add("observation-date");
      if (previous?.actualValue !== displayVintage.actualValue) changed.add("actual");
      if (previous?.forecastValue !== displayVintage.forecastValue) changed.add("forecast");
      if (previous?.targetDate !== displayVintage.targetDate) changed.add("target-date");
      const previousDelta = previous ? previous.forecastValue - previous.actualValue : null;
      if (previousDelta !== displayDelta) changed.add("absolute-deviation");
      const previousPercent = previous && previous.actualValue !== 0 ? ((previous.forecastValue - previous.actualValue) / Math.abs(previous.actualValue)) * 100 : null;
      if (previousPercent !== displayPercentageDelta) changed.add("percentage-deviation");
      setChangedSummary(changed);
      const timer = window.setTimeout(() => setChangedSummary(new Set()), 2000);
      previousVintage.current = key;
      return () => window.clearTimeout(timer);
    }
    previousVintage.current = key;
  }, [displayVintage, displayDelta, displayPercentageDelta, model.vintages]);
  React.useEffect(() => {
    rollingDebug("active vintage", { observationDate: activeVintage.observationDate, targetDate: activeVintage.targetDate, forecast: activeVintage.forecastValue, actual: activeVintage.actualValue });
  }, [activeVintage]);
  const deviationIndicator = (value: number | null) => value === null
    ? { symbol: "—", label: "значение недоступно" }
    : value > 0 ? { symbol: "↑", label: "больше нуля" }
      : value < 0 ? { symbol: "↓", label: "меньше нуля" }
        : { symbol: "→", label: "равно нулю" };
  const deviation = (field: string, value: number | null, text: string) => {
    const indicator = deviationIndicator(value);
    return <dd {...ui(UI_IDS.rolling.summaryField(field))} data-changed={changedSummary.has(field) ? "true" : undefined}><span className="rolling-deviation-value">{text}</span> <span className="rolling-deviation-indicator" aria-label={indicator.label}>{indicator.symbol}</span></dd>;
  };
  const data = React.useMemo(() => {
    const started = performance.now();
    const next = [...points.values()].map((point) => ({ ...point, connector: undefined }));
    const observation = next.find((point) => point.timestamp === activeVintage.observationTimestamp) || { timestamp: activeVintage.observationTimestamp, date: activeVintage.observationDate, vintageActual: activeVintage.actualValue, actual: activeVintage.actualValue };
    Object.assign(observation, { connector: activeVintage.actualValue, vintage: activeVintage });
    const target = next.find((point) => point.timestamp === activeVintage.targetTimestamp);
    if (target) target.connector = activeVintage.forecastValue;
    if (!next.includes(observation)) next.push(observation);
    const result = next.sort((a, b) => a.timestamp - b.timestamp);
    rollingDebug("chart data built", { points: result.length, ms: Number((performance.now() - started).toFixed(2)) });
    return result;
  }, [points, activeVintage]);
  const domain: [number, number] = [data[0].timestamp, data.at(-1).timestamp];
  const nearestVintage = (date: string | undefined, timestamp?: number) => {
    if (!model.vintages.length) return undefined;
    const exact = date ? vintageByObservationDate.get(date) : undefined;
    if (exact) return exact;
    const value = Number.isFinite(timestamp) ? Number(timestamp) : Date.parse(date || "");
    if (!Number.isFinite(value)) return undefined;
    return model.vintages.reduce((closest, item) =>
      Math.abs(item.observationTimestamp - value) < Math.abs(closest.observationTimestamp - value) ? item : closest,
    model.vintages[0]);
  };
  const selectVintage = (date: string) => {
    setClickedObservationDate(date);
    setConnectedObservationDate(date);
    onSelectVintage?.(date);
  };
  const handleChartClick = (state: any) => {
    const date = state?.activePayload?.[0]?.payload?.vintage?.observationDate
      || state?.activePayload?.[0]?.payload?.date;
    if (!date) return;
    const payload = state?.activePayload?.[0]?.payload;
    const vintage = nearestVintage(date, payload?.timestamp);
    if (!vintage) return;
    rollingDebug("chart click fallback", { observationDate: date, selectedVintage: vintage.observationDate, targetDate: vintage.targetDate });
    selectVintage(vintage.observationDate);
  };
  const vintageDot = (props: any) => {
    const payload = props.payload,
      date = payload?.date,
      available = vintageByObservationDate.has(date),
      active = date === activeVintage.observationDate;
    if (!available) return null;
    const choose = () => selectVintage(date);
    const selectedMarker = date === clickedObservationDate;
    return (
      <g {...ui(UI_IDS.rolling.marker(date))} className="rolling-marker-hit" aria-label={`Выбрать прогноз на ${dateLabel(date)}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); choose(); }}>
        <circle className="rolling-marker-hit-area" cx={props.cx} cy={props.cy} r={12} />
        <circle className="rolling-vintage-marker rolling-marker-visual" cx={props.cx} cy={props.cy} r={selectedMarker ? 9 : 5} fill={selectedMarker ? "#0f8278" : "#fff"} stroke="#0f8278" strokeWidth={2} />
      </g>
    );
  };
  const actualIntersectionDot = (props: any) => <circle className="rolling-actual-intersection" cx={props.cx} cy={props.cy} r={5} fill="#0f8278" stroke="#fff" strokeWidth={2} />;
  const targetDot = (props: any) => {
    const point = props.payload;
    if (!point?.forecastTarget) return null;
    const date = point.vintage?.observationDate;
    const active = date === activeVintage.observationDate;
    const selectedMarker = date === clickedObservationDate;
    return <g {...ui(UI_IDS.rolling.targetMarker(point.vintage?.targetDate || point.date))} className={`rolling-marker-hit rolling-forecast-marker ${selectedMarker ? "is-active" : ""}`} aria-label={`Выбрать прогноз на ${dateLabel(point.vintage?.targetDate || point.date)}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (date) selectVintage(date); }}><circle className="rolling-marker-hit-area" cx={props.cx} cy={props.cy} r={12} /><circle className="rolling-target-marker rolling-marker-visual" cx={props.cx} cy={props.cy} r={selectedMarker ? 9 : 5} fill={selectedMarker ? "#0f8278" : "#fff"} stroke="#0f8278" strokeWidth={2} /></g>;
  };
  const boundDot = (bound: "lower" | "upper") => (props: any) => {
    const point = props.payload,
      value = bound === "lower" ? point?.forecastLower : point?.forecastUpper;
    if (value == null || !point?.vintage) return null;
    const date = point.vintage.observationDate;
    const active = date === activeVintage.observationDate;
    const selectedMarker = date === clickedObservationDate;
    return <g className={`rolling-marker-hit rolling-bound-marker-${bound} ${selectedMarker ? "is-active" : ""}`} aria-label={`Выбрать ${bound === "lower" ? "нижнюю" : "верхнюю"} границу прогноза на ${dateLabel(point.vintage.targetDate)}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); selectVintage(date); }}><circle className="rolling-marker-hit-area" cx={props.cx} cy={props.cy} r={12} /><circle className={`rolling-target-marker rolling-target-marker-${bound} rolling-marker-visual`} cx={props.cx} cy={props.cy} r={selectedMarker ? 7 : 3} fill="#0f8278" stroke="#0f8278" strokeOpacity={selectedMarker ? 1 : 0.35} strokeWidth={1.5} /></g>;
  };
  return (
    <section
      {...ui(UI_IDS.rolling.chart)}
      className="rolling-chart"
      aria-label={`Rolling forecast на ${dateLabel(displayVintage.observationDate)}`}
    >
      <div className="rolling-plot">
        {model.settings.showPastForecastSplit && (
          <div className="rolling-zone-labels">
            <span>{model.settings.pastLabel}</span>
            <span>{model.settings.futureLabel}</span>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 28, right: 20, bottom: 8, left: 8 }}
            onClick={handleChartClick}
          >
            <CartesianGrid vertical={false} stroke="#e3e9e9" />
            <ReferenceLine y={0} stroke="#52656b" strokeWidth={1.2} />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={domain}
              tickFormatter={(value) => hierarchyTimestampLabel(value, model.settings.timeHierarchy?.selectedLevelKey)}
              minTickGap={42}
            />
            <YAxis
              width={52}
              tickFormatter={(value) => formatValue(Number(value), model.unit)}
            />
            <Tooltip
              content={<RollingTooltip model={model} />}
              offset={14}
              allowEscapeViewBox={{ x: true, y: true }}
              isAnimationActive={false}
            />
            {model.settings.showForecastBand && (
              <Area
                dataKey="band"
                className="rolling-band"
                fill="#0f8278"
                stroke="none"
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            <Line
              dataKey="actual"
              name="Факт"
              stroke="#263b56"
              strokeWidth={2.4}
              dot={false}
              activeDot={actualIntersectionDot}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="vintageActual"
              stroke="transparent"
              activeDot={false}
              dot={vintageDot}
              isAnimationActive={false}
            />
            <Line
              dataKey="forecastTarget"
              name="Целевой прогноз"
              stroke="transparent"
              activeDot={false}
              dot={targetDot}
              isAnimationActive={false}
            />
            <Line dataKey="forecastLower" stroke="transparent" activeDot={false} dot={boundDot("lower")} isAnimationActive={false} />
            <Line dataKey="forecastUpper" stroke="transparent" activeDot={false} dot={boundDot("upper")} isAnimationActive={false} />
            {model.settings.showLagConnector && connectedVintage && (
              <>
                <ReferenceLine
                  segment={[
                    { x: connectedVintage.observationTimestamp, y: connectedVintage.actualValue },
                    { x: connectedVintage.targetTimestamp, y: connectedVintage.forecastValue },
                  ]}
                  stroke="#b8564f"
                  strokeWidth={2.5}
                  strokeDasharray="7 6"
                />
                {connectedVintage.lowerBound !== null && (
                  <ReferenceLine
                    segment={[
                      { x: connectedVintage.observationTimestamp, y: connectedVintage.actualValue },
                      { x: connectedVintage.targetTimestamp, y: connectedVintage.lowerBound },
                    ]}
                    stroke="#b8564f"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                    strokeDasharray="4 5"
                  />
                )}
                {connectedVintage.upperBound !== null && (
                  <ReferenceLine
                    segment={[
                      { x: connectedVintage.observationTimestamp, y: connectedVintage.actualValue },
                      { x: connectedVintage.targetTimestamp, y: connectedVintage.upperBound },
                    ]}
                    stroke="#b8564f"
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                    strokeDasharray="4 5"
                  />
                )}
              </>
            )}{" "}
            {model.settings.showForecastCenterLine && (
              <Line
                dataKey="forecast"
                isAnimationActive={false}
                name="Прогноз"
                stroke="#0f8278"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <span className="rolling-horizon-caption">{model.horizonLabel}</span>
      </div>
      {model.settings.showSummaryCard && (
        <aside {...ui(UI_IDS.rolling.summary)} className="rolling-summary">
          <small data-changed={changedSummary.has("observation-date") ? "true" : undefined}>{dateLabel(displayVintage.observationDate)}</small>
          <h3>Прогноз на {model.horizonLabel}</h3>
          <dl>
            <dt>Текущее значение</dt>
            <dd data-changed={changedSummary.has("actual") ? "true" : undefined}>{formatValue(displayVintage.actualValue, model.unit)}</dd>
            <dt>Целевая дата</dt>
            <dd data-changed={changedSummary.has("target-date") ? "true" : undefined}>{dateLabel(displayVintage.targetDate)}</dd>
            <dt>Средний прогноз</dt>
            <dd data-changed={changedSummary.has("forecast") ? "true" : undefined}>{formatValue(displayVintage.forecastValue, model.unit)}</dd>
            <dt>Изменение</dt>
            {deviation("absolute-deviation", displayDelta, formatValue(displayDelta, model.unit))}
            <dt>Отклонение</dt>
            {deviation("percentage-deviation", displayPercentageDelta, formatPercent(displayPercentageDelta))}
          </dl>
          {displayVintage.forecastVersion && <small>Версия: {displayVintage.forecastVersion}</small>}
        </aside>
      )}
      <table className="specialized-data-table">
        <caption>Rolling forecast</caption>
        <thead>
          <tr>
            <th>Observation date</th>
            <th>Actual</th>
            <th>Target date</th>
            <th>Forecast</th>
            <th>Lower</th>
            <th>Upper</th>
          </tr>
        </thead>
        <tbody>
          {model.vintages.map((item) => (
            <tr key={`${item.observationDate}-${item.targetDate}`}>
              <td>{item.observationDate}</td>
              <td>{item.actualValue}</td>
              <td>{item.targetDate}</td>
              <td>{item.forecastValue}</td>
              <td>{item.lowerBound}</td>
              <td>{item.upperBound}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const waterfallColor = (item: BridgeRenderItem) =>
  item.isTerminalCheckpoint
    ? "#0f8278"
    : ({
        opening: "#263b56",
        positive_movement: "#2f8b68",
        negative_movement: "#b8544f",
        checkpoint: "#5f8f8a",
      })[item.role];
function WaterfallTooltip({ active, payload, unit }: any) {
  const item = payload?.find((entry: any) => entry.dataKey === "height")
    ?.payload as BridgeRenderItem | undefined;
  if (!active || !item) return null;
  const checkpoint = item.role === "checkpoint";
  return (
    <div className="builder-tooltip waterfall-tooltip">
      <b>{item.label}</b>
      <span>Показатель: {item.measureLabel}</span>
      <article>
        {checkpoint ? (
          <>
            <small>Источник</small><strong>{item.valueSource === "calculated" ? "Расчётный итог" : "Транзакционные данные"}</strong>
            <small>Значение отчёта</small><strong>{formatValue(item.reportedValue, unit)}</strong>
            <small>Расчётное значение</small><strong>{formatValue(item.calculatedValue, unit)}</strong>
            <small>Расхождение</small><strong>{formatValue(item.difference, unit)}</strong>
            <small>Статус</small><strong>{item.reconciliationStatus === "warning" ? "Warning" : item.reconciliationStatus === "ok" ? "OK" : "Не проверяется"}</strong>
          </>
        ) : (
          <>
            <small>Значение строки</small><strong>{formatValue(Math.abs(item.signedValue), unit)}</strong>
            <small>Операция</small><strong>{item.role === "opening" ? "Начало" : item.role === "positive_movement" ? "Добавить" : "Вычесть"}</strong>
            {item.valueSource === "missing" && <><small>Источник</small><strong>Нет данных после фильтрации · 0</strong></>}
            <small>Влияние</small><strong>{formatValue(item.signedValue, unit)}</strong>
            <small>До шага</small><strong>{formatValue(item.runningBefore, unit)}</strong>
            <small>После шага</small><strong>{formatValue(item.runningAfter, unit)}</strong>
          </>
        )}
      </article>
    </div>
  );
}
type WaterfallBarRect = { itemId: string; left: number; top: number; bottom: number; width: number; height: number };
const waterfallDomKey = (key: string) => String(key).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");

function WaterfallLabelOverlay({ items, width, height, rects, showConnectors, showValueLabels }: { items: BridgeRenderItem[]; width: number; height: number; rects: Map<string, WaterfallBarRect>; showConnectors: boolean; showValueLabels: boolean }) {
  const connectorY = (item: BridgeRenderItem, rect: WaterfallBarRect) => {
    if (item.role === "positive_movement" || (item.role === "negative_movement" && item.runningAfter > item.runningBefore)) return rect.top;
    if (item.role === "negative_movement" || item.runningAfter < item.runningBefore) return rect.bottom;
    return item.runningAfter >= 0 ? rect.top : rect.bottom;
  };
  const measured = items.map((item) => rects.get(waterfallDomKey(item.id)) || null), measuredCenters = measured.map((rect) => rect ? rect.left + rect.width / 2 : null), fallbackWidth = measured.find(Boolean)?.width || Math.max(24, width / Math.max(items.length * 2, 1));
  const geometry = items.map((item, index) => {
    const rect = measured[index];
    if (rect) return { ...rect, yAfter: connectorY(item, rect), virtual: false };
    let left = index - 1, right = index + 1;
    while (left >= 0 && measuredCenters[left] === null) left--;
    while (right < measuredCenters.length && measuredCenters[right] === null) right++;
    const leftCenter = left >= 0 ? measuredCenters[left] : null, rightCenter = right < measuredCenters.length ? measuredCenters[right] : null;
    const center = leftCenter !== null && rightCenter !== null ? leftCenter + ((rightCenter - leftCenter) * (index - left)) / (right - left) : leftCenter !== null ? leftCenter + fallbackWidth * (index - left) : rightCenter !== null ? rightCenter - fallbackWidth * (right - index) : fallbackWidth * (index + 0.5);
    const previousMeasured = [...items.slice(0, index)].map((candidate, candidateIndex) => measured[candidateIndex] ? connectorY(candidate, measured[candidateIndex]!) : null).filter((value): value is number => value !== null).at(-1);
    const nextMeasured = items.slice(index + 1).map((candidate, offset) => { const candidateIndex = index + 1 + offset; return measured[candidateIndex] ? connectorY(candidate, measured[candidateIndex]!) : null; }).find((value): value is number => value !== null);
    const yAfter = previousMeasured ?? nextMeasured ?? height / 2;
    if (WATERFALL_DEBUG) console.info("[waterfall:geometry:virtual-rect]", { itemId: item.waterfallItemId, index, center, yAfter });
    return { itemId: waterfallDomKey(item.id), left: center - fallbackWidth / 2, top: yAfter, bottom: yAfter, width: fallbackWidth, height: 0, yAfter, virtual: true };
  });
  const realIndices = geometry.map((rect, index) => rect.virtual ? -1 : index).filter((index) => index >= 0);
  return <svg className="waterfall-label-overlay" width={width} height={height} aria-hidden="true"><g>{showConnectors && realIndices.slice(0, -1).map((index, pairIndex) => {
    const nextIndex = realIndices[pairIndex + 1], item = items[index], currentRect = geometry[index], nextRect = geometry[nextIndex];
    if (!currentRect || !nextRect) return null;
    const hasEmptySlots = nextIndex > index + 1, y = currentRect.yAfter;
    if (hasEmptySlots && WATERFALL_DEBUG) console.info("[waterfall:geometry:merged-empty-connector]", { fromItemId: item.waterfallItemId, toItemId: items[nextIndex].waterfallItemId, emptyBars: nextIndex - index - 1, solid: true });
    const className = hasEmptySlots ? "waterfall-connector waterfall-connector-empty" : "waterfall-connector";
    return <line {...ui(UI_IDS.waterfall.connector(item.id))} key={`connector-${item.id}`} className={className} x1={currentRect.left + currentRect.width} x2={nextRect.left} y1={y} y2={y} />;
  })}</g><g>{showValueLabels && items.map((item, index) => {
    const value = item.displayValue, domKey = waterfallDomKey(item.id), rect = geometry[index];
    if (value === 0 || !Number.isFinite(value) || !rect || rect.virtual) {
      if (WATERFALL_DEBUG && value !== 0 && Number.isFinite(value)) console.warn("[waterfall:geometry:missing-rect]", { itemId: item.waterfallItemId, domKey });
      return null;
    }
    const placement = item.role === "negative_movement" ? "below-bar" : "above-bar",
      x = rect.left + rect.width / 2,
      y = placement === "below-bar" ? rect.bottom + 8 : Math.max(12, rect.top - 8);
    if (WATERFALL_LABEL_DEBUG) console.info("[waterfall-label-dom]", { itemId: item.waterfallItemId, domKey, action: item.role, rectItemId: rect.itemId, rectLeft: rect.left, rectTop: rect.top, rectBottom: rect.bottom, rectWidth: rect.width, rectHeight: rect.height, labelX: x, labelY: y, placement });
    return <text {...ui(UI_IDS.waterfall.label(item.id))} className="waterfall-label" key={item.id} x={x} y={y} textAnchor="middle">{value > 0 && item.role !== "opening" && item.role !== "checkpoint" ? "+" : ""}{formatValue(value, item.unit)}</text>;
  })}</g></svg>;
}

export function WaterfallChart({
  model,
  warnings,
}: {
  model: BridgeModel;
  warnings: string[];
}) {
  const items = model.items;
  const plotRef = React.useRef<HTMLDivElement>(null), [plotSize, setPlotSize] = React.useState({ width: 0, height: 0 }), [barRects, setBarRects] = React.useState<Map<string, WaterfallBarRect>>(new Map());
  const geometryKey = items.map((item) => `${item.id}:${item.base}:${item.height}:${item.displayValue}`).join("|");
  React.useEffect(() => { const node = plotRef.current; if (!node) return; let secondFrame = 0; const update = () => { setPlotSize({ width: node.clientWidth, height: node.clientHeight }); const root = node.getBoundingClientRect(); const next = new Map<string, WaterfallBarRect>(); [...node.querySelectorAll<SVGRectElement>('[data-ui-id^="chart.waterfall.item."]')].forEach((rect) => { const uiId = rect.getAttribute("data-ui-id") || "", itemId = uiId.replace(/^chart\.waterfall\.item\./, ""); if (!itemId) return; const box = rect.getBoundingClientRect(); next.set(itemId, { itemId, left: box.left - root.left, top: box.top - root.top, bottom: box.bottom - root.top, width: box.width, height: box.height }); }); setBarRects(next); if (WATERFALL_DEBUG) console.info("[waterfall:geometry:rects]", { found: next.size, itemIds: [...next.keys()], plotHeight: node.clientHeight }); }; update(); const firstFrame = requestAnimationFrame(() => { update(); secondFrame = requestAnimationFrame(update); }); if (typeof ResizeObserver === "undefined") return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); }; const observer = new ResizeObserver(update); observer.observe(node); return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); observer.disconnect(); }; }, [geometryKey, model.settings.showValueLabels, model.settings.showReconciliationSummary, model.settings.showDebug]);
  const values = items.flatMap((item) => [item.runningBefore, item.runningAfter]).filter(Number.isFinite), rawMin = Math.min(0, ...values), rawMax = Math.max(0, ...values), padding = (rawMax - rawMin || 1) * 0.08, yDomain: [number, number] = rawMin >= 0 ? [0, rawMax + padding] : rawMax <= 0 ? [rawMin - padding, 0] : [rawMin - padding, rawMax + padding];
  if (WATERFALL_DEBUG) console.info("[waterfall:model]", { itemsCount: items.length, showValueLabels: model.settings.showValueLabels, unit: model.unit, items: items.map((item) => ({ itemId: item.waterfallItemId, label: item.label, role: item.role, displayValue: item.displayValue, signedValue: item.signedValue, calculatedValue: item.calculatedValue, valueSource: item.valueSource })) });
  if (WATERFALL_DEBUG && plotSize.width > 0 && plotSize.height > 0) { const plotTop = 30, plotBottom = plotSize.height - 28, zeroY = plotTop + (plotBottom - plotTop) * (1 - (0 - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)); console.info("[waterfall:geometry]", { chartWidth: plotSize.width, chartHeight: plotSize.height, plotTop, plotBottom, zeroY, firstBarValue: items[0]?.displayValue }); }
  return (
    <section
      {...ui(UI_IDS.waterfall.chart)}
      className="waterfall-chart"
      aria-label="Bridge / Waterfall: движение показателя"
    >
      <div ref={plotRef} className="waterfall-plot">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={items}
            margin={{ top: 30, right: 16, bottom: 28, left: 10 }}
          >
            <CartesianGrid vertical={false} horizontal={false} />
            <XAxis
              dataKey="label"
              interval={0}
              angle={-18}
              textAnchor="end"
              height={64}
              tick={{ fontSize: 8 }}
              axisLine={false}
            />
            <YAxis
              width={58}
              domain={yDomain}
              tickFormatter={(value) => formatValue(Number(value), model.unit)}
            />
            <ReferenceLine y={0} stroke="#8d9b9f" strokeWidth={1} />
            <Tooltip
              cursor={{ fill: "#edf3f2" }}
              content={<WaterfallTooltip unit={model.unit} />}
            />
            <Bar
              dataKey="base"
              stackId="waterfall"
              fill="transparent"
              stroke="none"
              isAnimationActive={false}
            />
            <Bar dataKey="height" stackId="waterfall" isAnimationActive={false} minPointSize={(value, index) => items[index]?.role === "checkpoint" && items[index]?.displayValue === 0 ? 1 : 0}>
              {items.map((item) => (
                <Cell
                  {...ui(UI_IDS.waterfall.item(item.id))}
                  data-waterfall-item-id={item.id}
                  key={item.id}
                  fill={waterfallColor(item)}
                  stroke={
                    model.settings.showReconciliation &&
                    item.reconciliationStatus === "warning"
                      ? "#cf7d28"
                      : item.isTerminalCheckpoint
                        ? "#075f59"
                        : "none"
                  }
                  strokeWidth={item.reconciliationStatus === "warning" ? 3 : 2}
                  tabIndex={0}
                  role="img"
                  aria-label={`${item.label}, ${item.role}, ${formatValue(item.signedValue, item.unit)}`}
                />
              ))}
            </Bar>
            {model.settings.showRunningBalance && (
              <Line dataKey="runningAfter" name="Накопленный результат" stroke="#6f8294" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {(model.settings.showValueLabels || model.settings.showConnectors) && plotSize.width > 0 && plotSize.height > 0 && <WaterfallLabelOverlay items={items} width={plotSize.width} height={plotSize.height} rects={barRects} showConnectors={model.settings.showConnectors} showValueLabels={model.settings.showValueLabels} />}
      </div>
      {model.settings.showReconciliationSummary && (
        <section {...ui(UI_IDS.waterfall.reconciliationSummary)} className="bridge-reconciliation-summary" aria-label="Сверка контрольных итогов">
          <header><b>Сверка контрольных итогов</b><small>Отчётное значение и расчёт по цепочке</small></header>
          <div className="bridge-reconciliation-grid" role="table">
            <div className="bridge-reconciliation-head" role="row"><span>Строка</span><span>Отчёт</span><span>Расчёт</span><span>Расхождение</span><span>Статус</span></div>
            {items.filter((item) => item.role === "checkpoint").map((item) => (
              <div {...ui(UI_IDS.waterfall.reconciliationSummaryRow(item.id))} key={item.id} className={`bridge-reconciliation-row ${item.reconciliationStatus === "warning" ? "warning" : "ok"}`} role="row">
                <b>{item.label}{item.isTerminalCheckpoint ? " · итог" : ""}</b>
                <span>{formatValue(item.reportedValue, item.unit)}</span>
                <span>{formatValue(item.calculatedValue, item.unit)}</span>
                <span>{formatValue(item.difference, item.unit)}</span>
                <strong>{item.valueSource === "calculated" ? "Расчётный итог" : item.reconciliationStatus === "warning" ? "Warning" : item.reconciliationStatus === "ok" ? "OK" : "Не проверяется"}</strong>
              </div>
            ))}
          </div>
        </section>
      )}
      {model.settings.showWarnings && warnings.length > 0 && (
        <div className="waterfall-warning" role="status">
          {warnings.join(" · ")}
        </div>
      )}
      {WATERFALL_DEBUG && model.settings.showDebug && <details data-ui-id="chart.waterfall.debug" className="waterfall-debug"><summary>Waterfall debug</summary><div className="waterfall-debug-table"><div className="waterfall-debug-row waterfall-debug-head"><span>#</span><span>Item</span><span>Статья</span><span>Роль</span><span>Source</span><span>Display</span><span>Signed</span><span>Calculated</span></div>{items.map((item, index) => <div className="waterfall-debug-row" key={item.id}><span>{index}</span><span>{item.waterfallItemId}</span><span>{item.label}</span><span>{item.role}</span><span>{item.valueSource || "transaction"}</span><span>{formatValue(item.displayValue, item.unit)}</span><span>{formatValue(item.signedValue, item.unit)}</span><span>{formatValue(item.calculatedValue, item.unit)}</span></div>)}</div></details>}
      <table className="waterfall-data-table">
        <caption>Bridge / Waterfall</caption>
        <thead>
          <tr>
            <th>Шаг</th>
            <th>Показатель</th>
            <th>Роль</th>
            <th>Влияние</th>
            <th>До</th>
            <th>После</th>
            <th>Расхождение</th>
          </tr>
        </thead>
        <tbody>
          {model.items.map((item) => (
            <tr key={item.id}>
              <td>{item.label}</td>
              <td>{item.measureLabel}</td>
              <td>{item.role}</td>
              <td>{item.signedValue}</td>
              <td>{item.runningBefore}</td>
              <td>{item.runningAfter}</td>
              <td>{item.difference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
