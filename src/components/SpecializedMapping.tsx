import React from "react";
import { createPortal } from "react-dom";
import { useDroppable } from "@dnd-kit/core";
import type {
  BridgeSequenceAction,
  BridgeSequenceItemConfig,
  ChartConfig,
  Dataset,
  FieldMeta,
  PageFilterDefinition,
  RollingForecastBindings,
  ThresholdZone,
} from "../types";
import {
  bindSpecializedField,
  bucketAccepts,
  type SpecializedBucketId,
} from "../config/specializedConfig";
import {
  DEFAULT_ROLLING_SETTINGS,
  DEFAULT_THRESHOLD_SETTINGS,
  DEFAULT_WATERFALL_SETTINGS,
  validateBridgeSequence,
} from "../query/specializedCharts";
import { UI_IDS, ui } from "../uiIds";
import { useTranslation } from "react-i18next";
import { DATASETS, FIN_ACCOUNT_DISPLAY, FIN_ACCOUNT_LABELS, referenceRows } from "../data/datasets";
import { referenceMeta } from "../semantic/businessCatalog";
import { BuilderSelector } from "./BuilderSelector";

type Props = {
  dataset: Dataset;
  datasets?: Record<string, Dataset>;
  config: ChartConfig;
  pageFilters?: PageFilterDefinition[];
  onChange: (config: ChartConfig) => void;
};
type BucketProps = {
  id: SpecializedBucketId;
  title: string;
  hint: string;
  dataset: Dataset;
  selected?: string | null;
  optional?: boolean;
  disabled?: boolean;
  onChange: (field: FieldMeta | null) => void;
};

const formatWaterfallMember = (
  dataset: Dataset,
  dimensionKey: string | null | undefined,
  memberKey: string,
  fallback?: string,
) => {
  if (dimensionKey === "fin_acc") {
    const reference = FIN_ACCOUNT_DISPLAY[memberKey];
    if (reference?.text) return `${reference.text} (${memberKey})`;
  }
  return fallback || memberKey;
};

function SpecializedBucket({
  id,
  title,
  hint,
  dataset,
  selected,
  optional,
  disabled,
  onChange,
}: BucketProps) {
  const { setNodeRef, isOver } = useDroppable({
      id: `special-bucket:${id}`,
      disabled,
    }),
    fields = dataset.fields.filter((field) => bucketAccepts(id, field));
  return (
    <section
      {...ui(UI_IDS.mapping.specializedBucket(id))}
      ref={setNodeRef}
      className={
        "builder-bucket specialized-bucket " +
        (isOver ? "over" : "") +
        (disabled ? " disabled" : "")
      }
    >
      <header>
        <b>{title}</b>
        <small>{optional ? "Optional" : "Required"}</small>
      </header>
      <select
        value={selected || ""}
        disabled={disabled}
        aria-label={title}
        onChange={(event) =>
          onChange(
            dataset.fields.find((field) => field.id === event.target.value) ||
              null,
          )
        }
      >
        <option value="">{optional ? "Не задано" : "Выберите поле"}</option>
        {fields.map((field) => (
          <option key={field.id} value={field.id}>
            {field.label}
          </option>
        ))}
      </select>
      <p>{hint}</p>
    </section>
  );
}

function HelpHint({ id, label, ariaLabel }: { id: string; label: string; ariaLabel: string }) {
  const [open, setOpen] = React.useState(false);
  const tooltipId = `${id}.tooltip`;
  return (
    <span className="specialized-help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        {...ui(id)}
        type="button"
        className="specialized-help-button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); }
        }}
      >?</button>
      {open && <span id={tooltipId} role="tooltip" className="specialized-help-popover">{label}</span>}
    </span>
  );
}

const checkbox = (
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
  help?: string,
  helpId?: string,
  helpAriaLabel = "Help",
  controlId?: string,
) => (
  <label className="specialized-check">
    <input
      {...(controlId ? ui(controlId) : {})}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>{label}</span>
    {help && helpId && <HelpHint id={helpId} label={help} ariaLabel={helpAriaLabel} />}
  </label>
);

function ThresholdMapping({ dataset, config, onChange, pageFilters = [] }: Props) {
  const { t } = useTranslation("threshold");
    const settings =
      config.thresholdComparison || structuredClone(DEFAULT_THRESHOLD_SETTINGS),
    pageFilterFieldIds = new Set(pageFilters.map((filter) => filter.fieldId)),
    dimensions = dataset.fields.filter((field) => field.kind === "dimension" && !pageFilterFieldIds.has(field.id)),
    measures = dataset.fields.filter((field) => field.kind === "measure"),
    commonRows = dataset.rows.filter((row) => pageFilters.every((filter) => {
      const raw = String(row[filter.fieldId] ?? "");
      if (filter.kind === "categorical") return !filter.defaultValue.length || filter.defaultValue.includes(raw);
      const range = filter.defaultValue;
      return (!range.from || raw >= range.from) && (!range.to || raw <= range.to);
    })),
    differentiator = settings.differentiator || { fieldId: null, valueA: null, valueB: null },
    differentiatorField = dimensions.find((field) => field.id === differentiator.fieldId),
    differentiatorValues = differentiatorField
      ? [...new Set(commonRows.map((row) => String(row[differentiatorField.id] ?? "")).filter(Boolean))].sort()
      : [],
    patch = (value: Partial<typeof settings>) =>
      onChange({ ...config, thresholdComparison: { ...settings, ...value } }),
    patchZone = (index: number, value: Partial<ThresholdZone>) =>
      patch({
        thresholds: settings.thresholds.map((zone, zoneIndex) =>
          zoneIndex === index ? { ...zone, ...value } : zone,
        ),
      });
  const bind = (bucket: SpecializedBucketId, field: FieldMeta | null) =>
      onChange(bindSpecializedField(config, bucket, field));
  const patchBinding = (
      key: "actual" | "reference",
      value: Partial<typeof settings.actual>,
    ) => patch({ [key]: { ...settings[key], ...value } });
  const patchDifferentiator = (value: Partial<typeof differentiator>) =>
    patch({ differentiator: { ...differentiator, ...value } });
  return (
    <div {...ui(UI_IDS.threshold.root)} className="specialized-mapping">
      <section className="settings-dataset-binding threshold-dataset-binding"><header><b>{t("dataset")}</b><small>{dataset.label}</small></header><select {...ui("mapping.threshold-comparison.dataset")} value={config.datasetId} onChange={(event) => onChange({ ...config, datasetId: event.target.value as typeof config.datasetId })}>{Object.values(DATASETS).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><p>{dataset.description}</p></section>
      {(
        <section className="specialized-settings threshold-slice-settings">
          <header><b>{t("comparisonSetup")}</b><small>{t("comparisonSetupHint")}</small></header>
          <div className="specialized-form two-columns">
            <label>{t("measure")}<select {...ui("mapping.threshold-comparison.measure")} value={settings.measureField || ""} onChange={(event) => patch({ measureField: event.target.value || null })}><option value="">{t("selectMeasure")}</option>{measures.map((field) => <option key={field.id} value={field.id}>{field.label}{field.unit ? ` · ${field.unit}` : ""}</option>)}</select></label>
            <label>{t("differentiator")}<select {...ui("mapping.threshold-comparison.differentiator")} value={differentiator.fieldId || ""} onChange={(event) => patch({ differentiator: { fieldId: event.target.value || null, valueA: null, valueB: null } })}><option value="">{t("selectDimension")}</option>{dimensions.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
            <label>{t("valueA")}<select {...ui("mapping.threshold-comparison.value-a")} value={differentiator.valueA || ""} disabled={!differentiatorField} onChange={(event) => patchDifferentiator({ valueA: event.target.value || null })}><option value="">{t("selectValue")}</option>{differentiatorValues.filter((value) => value !== differentiator.valueB).map((value) => <option key={value} value={value}>{differentiatorField?.semantic?.members?.[value]?.label || value}</option>)}</select></label>
            <label>{t("valueB")}<select {...ui("mapping.threshold-comparison.value-b")} value={differentiator.valueB || ""} disabled={!differentiatorField} onChange={(event) => patchDifferentiator({ valueB: event.target.value || null })}><option value="">{t("selectValue")}</option>{differentiatorValues.filter((value) => value !== differentiator.valueA).map((value) => <option key={value} value={value}>{differentiatorField?.semantic?.members?.[value]?.label || value}</option>)}</select></label>
            <label>{t("differentiator")}<select {...ui("mapping.threshold-comparison.article-field")} value={settings.articleFieldId || ""} disabled={!settings.showArticleLabel} onChange={(event) => patch({ articleFieldId: event.target.value || null })}><option value="">{t("selectDimension")}</option>{dataset.fields.filter((field) => field.kind === "dimension").map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
            {settings.articleFieldId === "fin_acc" && <label>{t("articleDisplayField", { defaultValue: "Представление статьи" })}<select {...ui("mapping.threshold-comparison.article-display-field")} value={settings.articleDisplayField || "text"} disabled={!settings.showArticleLabel} onChange={(event) => patch({ articleDisplayField: event.target.value as "key" | "text" | "acc_type" })}><option value="text">{t("articleDisplayText", { defaultValue: "Текст (TXT)" })}</option><option value="key">{t("articleDisplayKey", { defaultValue: "Ключ (ID)" })}</option><option value="acc_type">{t("articleDisplayType", { defaultValue: "acc_type" })}</option></select></label>}
          </div>
          <label className="specialized-check"><input {...ui("mapping.threshold-comparison.show-article-label")} type="checkbox" checked={settings.showArticleLabel} onChange={(event) => patch({ showArticleLabel: event.target.checked })}/><span>{t("showExplanation")}</span></label>
          <p className="threshold-filter-hint">{t("pageFilterHint")}</p>
          {differentiator.fieldId && pageFilterFieldIds.has(differentiator.fieldId) && <p {...ui("mapping.threshold-comparison.page-filter-conflict")} className="threshold-filter-conflict">{t("differentiatorConflictsWithPageFilter")}</p>}
          <p {...ui("mapping.threshold-comparison.preview")} className="threshold-comparison-preview">{t("comparisonPreview", { measure: measures.find((field) => field.id === settings.measureField)?.label || "—", dimension: differentiatorField?.label || "—", valueA: differentiator.valueA || "—", valueB: differentiator.valueB || "—" })}</p>
        </section>
      )}
      <div className="specialized-bucket-grid threshold-legacy-controls">
        <SpecializedBucket
          id="threshold.actual"
          title="Actual"
          hint="Фактическое значение"
          dataset={dataset}
          selected={settings.actual.fieldId}
          disabled={settings.actual.source === "manual"}
          onChange={(field) => bind("threshold.actual", field)}
        />
        <SpecializedBucket
          id="threshold.reference"
          title="Reference"
          hint="План, прогноз или target"
          dataset={dataset}
          selected={settings.reference.fieldId}
          disabled={settings.reference.source === "manual"}
          onChange={(field) => bind("threshold.reference", field)}
        />
      </div>
        <section className="specialized-settings threshold-visual-settings">
        <header>
          <b>{t("visualSettings")}</b>
          <small>{t("visualSettingsHint")}</small>
        </header>
        <div className="specialized-form two-columns">
          {(["actual", "reference"] as const).map((key) => (
            <label key={key} className="threshold-legacy-binding">
              {key === "actual" ? "Actual source" : "Reference source"}
              <select
                {...ui("mapping.threshold-comparison.reference-type")}
                value={settings[key].source}
                onChange={(event) =>
                  patchBinding(key, {
                    source: event.target.value as "metric" | "manual",
                  })
                }
              >
                <option value="metric">Metric</option>
                <option value="manual">Manual</option>
              </select>
              {settings[key].source === "manual" && (
                <input
                  type="number"
                  value={settings[key].manualValue ?? ""}
                  placeholder="Введите значение"
                  onChange={(event) =>
                    patchBinding(key, {
                      manualValue:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              )}
            </label>
          ))}
          <label>
            Reference type
              <select
                {...ui("mapping.threshold-comparison.percentage-base")}
              value={settings.referenceType}
              onChange={(event) =>
                patch({
                  referenceType: event.target
                    .value as typeof settings.referenceType,
                })
              }
            >
              {[
                "forecast",
                "plan",
                "target",
                "benchmark",
                "fair_value",
                "model_value",
              ].map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Percentage base
            <select
              value={settings.percentageBase}
              onChange={(event) =>
                patch({
                  percentageBase: event.target.value as "actual" | "reference",
                })
              }
            >
              <option value="actual">Actual</option>
              <option value="reference">Reference</option>
            </select>
          </label>
          <label>
            Direction
            <select
              {...ui(UI_IDS.threshold.direction)}
              value={settings.direction}
              onChange={(event) =>
                patch({
                  direction: event.target.value as typeof settings.direction,
                })
              }
            >
              <option value="higher_is_better">Выше — лучше</option>
              <option value="lower_is_better">Ниже — лучше</option>
            </select>
          </label>
        </div>
        <div className="threshold-marker-colors">
          <label>
            {t("actualMarkerColor")}
            <input
              {...ui("mapping.threshold-comparison.marker-color.actual")}
              type="color"
              value={settings.markerColors?.actual || "#0f8278"}
              onChange={(event) =>
                patch({
                  markerColors: {
                    actual: event.target.value,
                    reference: settings.markerColors?.reference || "#263b56",
                  },
                })
              }
            />
          </label>
          <label>
            {t("referenceMarkerColor")}
            <input
              {...ui("mapping.threshold-comparison.marker-color.reference")}
              type="color"
              value={settings.markerColors?.reference || "#263b56"}
              onChange={(event) =>
                patch({
                  markerColors: {
                    actual: settings.markerColors?.actual || "#0f8278",
                    reference: event.target.value,
                  },
                })
              }
            />
          </label>
        </div>
        <fieldset
          {...ui(UI_IDS.threshold.zones)}
          className="threshold-zone-editor"
        >
          <legend>Thresholds, %</legend>
          {settings.thresholds.map((zone, index) => (
            <div
              key={zone.key}
              className={`threshold-zone-row ${zone.semantic}`}
            >
              <b>{zone.label}</b>
              <label>
                От
                <input
                  {...ui(`mapping.threshold-comparison.zone.${zone.key}.from`)}
                  type="number"
                  value={zone.from ?? ""}
                  placeholder="−∞"
                  onChange={(event) =>
                    patchZone(index, {
                      from:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                До
                <input
                  {...ui(`mapping.threshold-comparison.zone.${zone.key}.to`)}
                  type="number"
                  value={zone.to ?? ""}
                  placeholder="+∞"
                  onChange={(event) =>
                    patchZone(index, {
                      to:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </fieldset>
        <div className="specialized-options">
          {checkbox(t("showActualLabel"), settings.showActualLabel, (value) =>
            patch({ showActualLabel: value }),
            undefined, undefined, "Help", "mapping.threshold-comparison.show-actual-label")}
          {checkbox(t("showReferenceLabel"), settings.showReferenceLabel, (value) =>
            patch({ showReferenceLabel: value }),
            undefined, undefined, "Help", "mapping.threshold-comparison.show-reference-label")}
          {checkbox(t("showDeviation"), settings.showDeviation, (value) =>
            patch({ showDeviation: value }),
            undefined, undefined, "Help", "mapping.threshold-comparison.show-deviation")}
          {checkbox(t("showZoneLabels"), settings.showZoneLabels, (value) =>
            patch({ showZoneLabels: value }),
            undefined, undefined, "Help", "mapping.threshold-comparison.show-zone-labels")}
          {checkbox(t("showExplanation"), settings.showExplanation, (value) =>
            patch({ showExplanation: value }),
            undefined, undefined, "Help", "mapping.threshold-comparison.show-explanation")}
        </div>
      </section>
    </div>
  );
}

const rollingBuckets: Array<
  [keyof RollingForecastBindings, string, string, boolean?]
> = [
  ["observationDateField", "Observation Date", "Дата формирования прогноза"],
  ["actualValueField", "Actual", "Историческое фактическое значение"],
  ["targetDateField", "Target Date", "Дата, к которой относится прогноз"],
  ["forecastValueField", "Forecast", "Средний прогноз"],
  ["lowerBoundField", "Lower Bound", "Нижняя граница диапазона", true],
  ["upperBoundField", "Upper Bound", "Верхняя граница диапазона", true],
  ["forecastVersionField", "Version", "Версия прогноза", true],
];
function RollingMapping({ dataset, config, onChange }: Props) {
  const settings = {
      ...structuredClone(DEFAULT_ROLLING_SETTINGS),
      ...(config.rollingForecast || {}),
      bindings: {
        ...DEFAULT_ROLLING_SETTINGS.bindings,
        ...(config.rollingForecast?.bindings || {}),
      },
    },
    patch = (value: Partial<typeof settings>) =>
      onChange({ ...config, rollingForecast: { ...settings, ...value } }),
    bind = (key: keyof RollingForecastBindings, field: FieldMeta | null) =>
      onChange(bindSpecializedField(config, `rolling.${key}`, field));
  const forecastDataset = DATASETS[settings.forecastDatasetId || "key_rate_forecast"] || dataset;
  const actualDataset = DATASETS[settings.actualDatasetId || "key_rate_actual"] || dataset;
  const forecastFields = rollingBuckets.filter(([key]) => !["observationDateField", "actualValueField"].includes(key));
  const actualFields = rollingBuckets.filter(([key]) => ["observationDateField", "actualValueField"].includes(key));
  const rollingFilters = settings.filters || [];
  const addRollingFilter = (source: "forecast" | "actual") => {
    const sourceDataset = source === "forecast" ? forecastDataset : actualDataset;
    const field = sourceDataset.fields.find((item) => item.kind === "dimension" && !rollingFilters.some((filter) => filter.source === source && filter.fieldId === item.id));
    if (!field) return;
    patch({ filters: [...rollingFilters, { id: `${source}-${field.id}`, source, fieldId: field.id, kind: field.semantic?.dataType === "date" ? "date-range" : "categorical", granularity: field.semantic?.granularity, value: field.semantic?.dataType === "date" ? { from: "", to: "" } : [] }] });
  };
  const removeRollingFilter = (id: string) => patch({ filters: rollingFilters.filter((filter) => filter.id !== id) });
  return (
    <div {...ui(UI_IDS.rolling.root)} className="specialized-mapping">
      <section className="rolling-source-card"><header className="rolling-source-header"><div><b>Forecast cube</b><small>{forecastDataset.label}</small></div><select value={settings.forecastDatasetId || ""} onChange={(event) => patch({ forecastDatasetId: event.target.value as typeof settings.forecastDatasetId })}>{Object.values(DATASETS).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></header><div className="specialized-bucket-grid">
        {forecastFields.map(([key, title, hint, optional]) => (
          <SpecializedBucket
            key={key}
            id={`rolling.${key}`}
            title={title}
            hint={hint}
            dataset={(["observationDateField", "actualValueField"] as string[]).includes(key) ? actualDataset : forecastDataset}
            selected={settings.bindings[key]}
            optional={optional}
            onChange={(field) => bind(key, field)}
          />
        ))}
      </div></section>
      <section className="rolling-source-card"><header className="rolling-source-header"><div><b>Actual cube</b><small>{actualDataset.label}</small></div><select value={settings.actualDatasetId || ""} onChange={(event) => patch({ actualDatasetId: event.target.value as typeof settings.actualDatasetId })}>{Object.values(DATASETS).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></header><div className="specialized-bucket-grid">{actualFields.map(([key, title, hint, optional]) => <SpecializedBucket key={key} id={`rolling.${key}`} title={title} hint={hint} dataset={actualDataset} selected={settings.bindings[key]} optional={optional} onChange={(field) => bind(key, field)} />)}</div></section>
      <section className="specialized-settings">
        <header>
          <b>Rolling Forecast</b>
          <small>Selected analyst target</small>
        </header>
        <div className="specialized-form two-columns">
          <label>
            Horizon
            <input
              {...ui(UI_IDS.rolling.horizon)}
              type="number"
              min="1"
              value={settings.horizonValue}
              onChange={(event) =>
                patch({ horizonValue: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Unit
            <select
              {...ui(UI_IDS.rolling.unit)}
              value={settings.horizonUnit}
              onChange={(event) =>
                patch({
                  horizonUnit: event.target
                    .value as typeof settings.horizonUnit,
                })
              }
            >
              {["day", "week", "month", "quarter", "year"].map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vintage mode
            <select
              {...ui(UI_IDS.rolling.mode)}
              value={settings.observationDateMode}
              onChange={(event) =>
                patch({
                  observationDateMode: event.target.value as
                    "hover" | "latest" | "selected",
                  selectedObservationDate:
                    event.target.value === "latest"
                      ? null
                      : settings.selectedObservationDate,
                })
              }
            >
              <option value="hover">Hover</option>
              <option value="latest">Latest</option>
              <option value="selected">Selected</option>
            </select>
          </label>
          {settings.observationDateMode === "selected" && (
            <label>
              Selected date
              <input
                type="text"
                readOnly
                value={
                  settings.selectedObservationDate ||
                  "Выберите точку на графике"
                }
              />
            </label>
          )}
        </div>
        <div className="specialized-options">
          {checkbox("Lag connector", settings.showLagConnector, (value) =>
            patch({ showLagConnector: value }),
          )}
          {checkbox("Forecast band", settings.showForecastBand, (value) =>
            patch({ showForecastBand: value }),
          )}
          {checkbox("Center line", settings.showForecastCenterLine, (value) =>
            patch({ showForecastCenterLine: value }),
          )}
          {checkbox(
            "Observation marker",
            settings.showObservationMarker,
            (value) => patch({ showObservationMarker: value }),
          )}
          {checkbox("Target marker", settings.showTargetMarker, (value) =>
            patch({ showTargetMarker: value }),
          )}
          {checkbox("Summary card", settings.showSummaryCard, (value) =>
            patch({ showSummaryCard: value }),
          )}
          {checkbox(
            "Past / Forecast labels",
            settings.showPastForecastSplit,
            (value) => patch({ showPastForecastSplit: value }),
          )}
        </div>
      </section>
    </div>
  );
}

function WaterfallSequenceEditor({ dataset, config, onChange, onCandidateMemberChange }: Props & { onCandidateMemberChange?: (memberKey: string) => void }) {
  const { t } = useTranslation("waterfall");
  const { t: tc } = useTranslation("common");
  const settings =
      config.waterfall || structuredClone(DEFAULT_WATERFALL_SETTINGS),
    patch = (value: Partial<typeof settings>) =>
      onChange({ ...config, waterfall: { ...settings, ...value } });
  const [candidateMember, setCandidateMember] = React.useState(""),
    [draggedId, setDraggedId] = React.useState<string | null>(null),
    dimensions = dataset.fields.filter((field) => field.kind === "dimension"),
    allMeasures = dataset.fields.filter(
      (field) => field.kind === "measure" && !["text", "date"].includes(field.unit),
    ),
    sequenceUnit = settings.items
      .filter((item) => item.enabled && item.action !== "exclude")
      .map((item) => dataset.fields.find((field) => field.id === item.measureKey)?.unit)
      .find(Boolean),
    measures = sequenceUnit
      ? allMeasures.filter((field) => field.unit === sequenceUnit)
      : allMeasures,
    dimensionField = dataset.fields.find((field) => field.id === settings.dimensionKey),
    memberMeta = dimensionField?.semantic?.members,
    referenceId = settings.memberReference?.referenceId || dimensionField?.semantic?.referenceId || null,
    referenceDefinition = referenceId ? referenceMeta(referenceId) : undefined,
    referenceData = referenceId && referenceDefinition ? referenceRows(referenceId) : [],
    referenceKeyColumn = referenceDefinition?.key || "",
    memberReference = settings.memberReference || { referenceId: referenceId, attributeField: null, attributeValue: null },
    referenceAttributeFields: Array<[string, { column: string; title?: string }]> = referenceDefinition?.fields
      ? (Object.entries(referenceDefinition.fields).filter(([field]) => field !== "text") as Array<[string, { column: string; title?: string }]> )
      : [],
    transactionMemberKeys = new Set(settings.dimensionKey
      ? dataset.rows.map((row) => String(row[settings.dimensionKey!] ?? "")).filter(Boolean)
      : []),
    referenceMemberRows = referenceData.filter((row) => {
      const attributeField = memberReference.attributeField,
        attributeValue = memberReference.attributeValue;
      if (!attributeField || !attributeValue) return true;
      const column = referenceDefinition?.fields?.[attributeField]?.column || attributeField;
      return String(row[column] ?? "") === attributeValue;
    }),
    memberKeys = settings.dimensionKey
      ? referenceData.length && referenceKeyColumn
        ? [...new Set(referenceMemberRows.map((row) => String(row[referenceKeyColumn] ?? "")).filter(Boolean))]
        : [...transactionMemberKeys]
      : [],
    memberLabel = (key: string) => formatWaterfallMember(
      dataset,
      settings.dimensionKey,
      key,
      memberMeta?.[key]?.label,
    ),
    memberType = (key: string) =>
      settings.dimensionKey === "fin_acc"
        ? FIN_ACCOUNT_DISPLAY[key]?.accType || ""
        : "",
    newMemberKeys = memberKeys.filter(
      (key) => !settings.items.some((item) => item.memberKey === key),
    ),
    newMeasureKeys = allMeasures
      .map((field) => field.id)
      .filter((key) => !settings.availableMeasureKeys.includes(key)),
    normalized = (items: BridgeSequenceItemConfig[]) =>
      items.map((item, index) => ({ ...item, order: index + 1 })),
    updateItems = (items: BridgeSequenceItemConfig[]) =>
      patch({ items: normalized(items) }),
    updateItem = (id: string, value: Partial<BridgeSequenceItemConfig>) =>
      updateItems(settings.items.map((item) => (item.id === id ? { ...item, ...value } : item))),
    move = (id: string, delta: number) => {
      const items = [...settings.items].sort((a, b) => a.order - b.order),
        index = items.findIndex((item) => item.id === id),
        target = index + delta;
      if (index < 0 || target < 0 || target >= items.length) return;
      [items[index], items[target]] = [items[target], items[index]];
      updateItems(items);
    },
    moveBefore = (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      const items = [...settings.items].sort((a, b) => a.order - b.order),
        sourceIndex = items.findIndex((item) => item.id === sourceId),
        targetIndex = items.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const [source] = items.splice(sourceIndex, 1);
      items.splice(targetIndex, 0, source);
      updateItems(items);
    },
    addItem = () => {
      if (!candidateMember) return;
      const measure =
        measures.find((field) => field.id === settings.defaultMeasureKey) || measures[0];
      if (!measure) return;
      const id = `bridge-${candidateMember}-${measure.id}-${Date.now()}-${settings.items.length}`;
      updateItems([
        ...settings.items,
        {
          id,
          memberKey: candidateMember,
          displayLabel: memberLabel(candidateMember),
          measureKey: measure.id,
          measureLabel: measure.label,
          action: "exclude",
          order: settings.items.length + 1,
          enabled: false,
        },
      ]);
      setCandidateMember("");
    },
    active = settings.items
      .filter((item) => item.enabled && item.action !== "exclude")
      .sort((a, b) => a.order - b.order),
    terminalId = active.filter((item) => item.action === "checkpoint").at(-1)?.id,
    validation = validateBridgeSequence(dataset, settings);
  return (
    <div {...ui(UI_IDS.waterfall.editor)} className="specialized-mapping">
      <section className="specialized-settings">
        <header>
          <b>Bridge / Waterfall</b>
          <small>Статья + показатель + действие</small>
        </header>
        {(validation.blockingErrors.length > 0 || validation.warnings.length > 0) && <div className="bridge-editor-diagnostics" aria-live="polite">{validation.blockingErrors.map((message) => <span className="error" key={message}>{message}</span>)}{validation.warnings.map((message) => <span className="warning" key={message}>{message}</span>)}</div>}
        <div className="specialized-form two-columns">
          <BuilderSelector uiId={UI_IDS.waterfall.dimension} label="Аналитика статей" ariaLabel="Аналитика статей" value={settings.dimensionKey || ""} options={[{ id: "", label: "Выберите аналитику" }, ...dimensions.map((field) => ({ id: field.id, label: field.label, meta: field.id }))]} onChange={(value) => patch({ dimensionKey: value || null, memberReference: { referenceId: null, attributeField: null, attributeValue: null } })} />
          <BuilderSelector uiId={UI_IDS.waterfall.defaultMeasure} label="Показатель по умолчанию" ariaLabel="Показатель по умолчанию" value={settings.defaultMeasureKey || ""} options={[{ id: "", label: "Не выбран" }, ...allMeasures.map((field) => ({ id: field.id, label: field.label, meta: field.unit }))]} onChange={(value) => patch({ defaultMeasureKey: value || null, availableMeasureKeys: value ? [...new Set([...settings.availableMeasureKeys, value])] : settings.availableMeasureKeys })} />
        </div>
        <div className="bridge-add-row">
          {referenceId && <>
            <BuilderSelector uiId="mapping.waterfall.member-attribute" className="waterfall-neutral-selector" label="" ariaLabel="Атрибут справочника" value={memberReference.attributeField || ""} options={[{ id: "", label: "Без фильтра по атрибуту" }, ...referenceAttributeFields.map(([field, meta]) => ({ id: field, label: meta.title || field }))]} onChange={(value) => patch({ memberReference: { referenceId, attributeField: value || null, attributeValue: null } })} />
            {memberReference.attributeField && <BuilderSelector uiId="mapping.waterfall.member-attribute-value" className="waterfall-neutral-selector" label="" ariaLabel="Значение атрибута" value={memberReference.attributeValue || ""} options={[{ id: "", label: "Все значения" }, ...[...new Set(referenceData.map((row) => String(row[referenceDefinition?.fields?.[memberReference.attributeField!]?.column || memberReference.attributeField!] ?? "")).filter(Boolean))].map((value) => ({ id: value, label: value }))]} onChange={(value) => patch({ memberReference: { ...memberReference, referenceId, attributeValue: value || null } })} />}
          </>}
          <BuilderSelector uiId="mapping.waterfall.member-selector" className="waterfall-neutral-selector waterfall-member-selector" label="" ariaLabel="Статья для добавления" value={candidateMember} disabled={!settings.dimensionKey} options={[{ id: "", label: "Выберите статью" }, ...memberKeys.map((key) => ({ id: key, label: memberLabel(key), meta: memberType(key) || key, marker: transactionMemberKeys.has(key) ? "transaction" as const : "reference" as const }))]} onChange={(value) => { setCandidateMember(value); onCandidateMemberChange?.(value); }} />
          <button {...ui(UI_IDS.waterfall.addItem)} type="button" disabled={!candidateMember || !measures.length} onClick={addItem}>Добавить строку</button>
        </div>
        <div {...ui(UI_IDS.waterfall.sequence)} className="bridge-sequence" role="table" aria-label="Структура Bridge / Waterfall">
          <div className="bridge-sequence-head" role="row"><span>Порядок</span><span>Статья</span><span>Показатель</span><span>Действие</span><span>Статус</span></div>
          {[...settings.items].sort((a, b) => a.order - b.order).map((item, index) => {
            const unresolvedMember = !memberKeys.includes(item.memberKey),
              unresolvedMeasure = !dataset.fields.some((field) => field.id === item.measureKey),
              terminal = item.id === terminalId;
            const itemMeasures = measures.filter((field) => dataset.rows.some((row) => String(row[settings.dimensionKey || ""] ?? "") === item.memberKey && row[field.id] !== null && row[field.id] !== undefined && row[field.id] !== "" && Number.isFinite(Number(row[field.id]))));
            return <div {...ui(UI_IDS.waterfall.sequenceRow(item.id))} className="bridge-sequence-row" role="row" key={item.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedId) moveBefore(draggedId, item.id); setDraggedId(null) }}>
              <div className="bridge-reorder"><button type="button" draggable onDragStart={() => setDraggedId(item.id)} onDragEnd={() => setDraggedId(null)} aria-label={`Перетащить ${item.displayLabel}`} title="Перетащите строку">≡</button><button {...ui(UI_IDS.waterfall.reorder(item.id, "up"))} type="button" disabled={index === 0} aria-label={`Переместить ${item.displayLabel} вверх`} onClick={() => move(item.id, -1)}>↑</button><button {...ui(UI_IDS.waterfall.reorder(item.id, "down"))} type="button" disabled={index === settings.items.length - 1} aria-label={`Переместить ${item.displayLabel} вниз`} onClick={() => move(item.id, 1)}>↓</button></div>
              <b>{memberKeys.includes(item.memberKey) ? memberLabel(item.memberKey) : formatWaterfallMember(dataset, settings.dimensionKey, item.memberKey, item.displayLabel)}</b>
              <BuilderSelector portalMenu uiId={UI_IDS.waterfall.measure(item.id)} label="" ariaLabel={`Показатель ${item.displayLabel}`} value={item.measureKey} options={[...(unresolvedMeasure ? [{ id: item.measureKey, label: `${item.measureLabel} — unresolved` }] : []), ...itemMeasures.map((field) => ({ id: field.id, label: field.label, meta: field.unit }))]} onChange={(value) => { const measure = allMeasures.find((field) => field.id === value), measureKey = value; onChange({ ...config, waterfall: { ...settings, availableMeasureKeys: [...new Set([...settings.availableMeasureKeys, measureKey])], items: normalized(settings.items.map((candidate) => candidate.id === item.id ? { ...candidate, measureKey, measureLabel: measure?.label || measureKey } : candidate)) } }) }} />
              <BuilderSelector portalMenu className="waterfall-action-selector" uiId={UI_IDS.waterfall.action(item.id)} label="" ariaLabel={`Действие ${item.displayLabel}`} value={item.action} options={[{ id: "opening", label: "Начало" }, { id: "add", label: "+" }, { id: "subtract", label: "−" }, { id: "checkpoint", label: "Контрольный итог" }, { id: "exclude", label: "Не показывать" }]} onChange={(value) => { const action = value as BridgeSequenceAction; updateItem(item.id, { action, enabled: value !== "exclude" }) }} />
              <span className={unresolvedMeasure || (unresolvedMember && item.action === "opening") ? "bridge-status warning" : terminal ? "bridge-status terminal" : "bridge-status"}>{unresolvedMeasure ? "Unresolved measure" : unresolvedMember && item.action === "opening" ? "Нет данных" : unresolvedMember && (item.action === "add" || item.action === "subtract") ? "Нет данных · 0" : terminal ? "Последняя" : item.enabled ? "Активна" : "Исключена"}</span>
              <button type="button" className="bridge-delete" aria-label={`Удалить ${item.displayLabel}`} onClick={() => updateItems(settings.items.filter((candidate) => candidate.id !== item.id))}>×</button>
            </div>;
          })}
          {!settings.items.length && <p className="bridge-empty">Добавьте статьи и назначьте действия. Новые строки не включаются автоматически.</p>}
        </div>
        {(newMemberKeys.length > 0 || newMeasureKeys.length > 0) && <p className="bridge-new-items" role="status">Новые элементы не добавлены автоматически: статей {newMemberKeys.length}, показателей {newMeasureKeys.length}.</p>}
        <div className="specialized-form two-columns bridge-validation-settings">
          <BuilderSelector uiId="mapping.waterfall.tolerance-type" label="Tolerance type" ariaLabel="Тип допуска" value={settings.toleranceType} options={[{ id: "percentage", label: "Percentage" }, { id: "absolute", label: "Absolute" }]} onChange={(value) => patch({ toleranceType: value as "absolute" | "percentage" })} />
          <label>Tolerance<input {...ui(UI_IDS.waterfall.tolerance)} type="number" min="0" step="0.1" value={settings.toleranceValue} onChange={(event) => patch({ toleranceValue: Number(event.target.value) })}/></label>
        </div>
        <div className="specialized-options">
          <span {...ui(UI_IDS.waterfall.validateCheckpoints)}>{checkbox(t("options.validateCheckpoints.label"), settings.validateCheckpoints, (value) => patch({ validateCheckpoints: value }), t("options.validateCheckpoints.help"), UI_IDS.waterfall.help("validate-checkpoints"), tc("help"))}</span>
          {checkbox(t("options.connectors.label"), settings.showConnectors, (value) => patch({ showConnectors: value }), t("options.connectors.help"), UI_IDS.waterfall.help("connectors"), tc("help"))}
          {checkbox(t("options.valueLabels.label"), settings.showValueLabels, (value) => patch({ showValueLabels: value }), t("options.valueLabels.help"), UI_IDS.waterfall.help("value-labels"), tc("help"))}
          {checkbox(t("options.runningBalance.label"), settings.showRunningBalance, (value) => patch({ showRunningBalance: value }), t("options.runningBalance.help"), UI_IDS.waterfall.help("running-balance"), tc("help"))}
          {checkbox(t("options.reconciliation.label"), settings.showReconciliation, (value) => patch({ showReconciliation: value }), t("options.reconciliation.help"), UI_IDS.waterfall.help("reconciliation"), tc("help"))}
          {checkbox(t("options.reconciliationSummary.label"), settings.showReconciliationSummary, (value) => patch({ showReconciliationSummary: value }), t("options.reconciliationSummary.help"), UI_IDS.waterfall.help("reconciliation-summary"), tc("help"))}
          {checkbox(t("options.warnings.label"), settings.showWarnings, (value) => patch({ showWarnings: value }), t("options.warnings.help"), "mapping.waterfall.help.warnings", tc("help"))}
          {checkbox(t("options.debug.label"), settings.showDebug, (value) => patch({ showDebug: value }), t("options.debug.help"), UI_IDS.waterfall.help("debug"), tc("help"))}
        </div>
      </section>
    </div>
  );
}

function WaterfallSurface({ dataset, config, onChange }: Props) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ChartConfig | null>(null);
  const [candidateMember, setCandidateMember] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const settings = config.waterfall || structuredClone(DEFAULT_WATERFALL_SETTINGS);
  const dialogDataset = draft?.datasetId
    ? DATASETS[draft.datasetId] || dataset
    : dataset;
  const validation = validateBridgeSequence(dataset, settings);
  const active = settings.items.filter((item) => item.enabled && item.action !== "exclude");
  const checkpoints = active.filter((item) => item.action === "checkpoint");
  const openDialog = () => {
    const current = structuredClone(config),
      currentSettings = current.waterfall || structuredClone(DEFAULT_WATERFALL_SETTINGS),
      availableFields = new Set(dataset.fields.map((field) => field.id)),
      dimensionKey = currentSettings.dimensionKey && availableFields.has(currentSettings.dimensionKey)
        ? currentSettings.dimensionKey
        : null;
    current.waterfall = {
      ...currentSettings,
      dimensionKey,
      items: currentSettings.items.map((item) => ({
        ...item,
        displayLabel: formatWaterfallMember(dataset, dimensionKey, item.memberKey, item.displayLabel),
      })),
    };
    setDraft(current);
    setCandidateMember("");
    setOpen(true);
  };
  const closeDialog = () => {
    setOpen(false);
    setDraft(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const applyDraft = () => {
    if (!draft || !draft.waterfall) return;
    const nextValidation = validateBridgeSequence(dialogDataset, draft.waterfall);
    if (nextValidation.blockingErrors.length) return;
    onChange(draft);
    closeDialog();
  };
  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const closeButton = dialogRef.current?.querySelector<HTMLButtonElement>("[data-ui-id='mapping.waterfall.dialog.close']");
    closeButton?.focus();
  }, [open]);
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button,select,input,[tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return <>
    <section {...ui(UI_IDS.waterfall.summary)} className="waterfall-settings-summary">
      <div>
        <b>Bridge / Waterfall</b>
        <small {...ui("mapping.waterfall.dimension.meta")}>{settings.dimensionKey ? `Dimension: ${settings.dimensionKey === "fin_acc" ? "Статья (fin_acc)" : settings.dimensionKey}` : "Аналитика не выбрана"}</small>
        <small {...ui("mapping.waterfall.dataset.meta.summary")}>Dataset: {dataset.label} · {settings.dimensionKey ? new Set(dataset.rows.map((row) => String(row[settings.dimensionKey!] ?? "")).filter(Boolean)).size : 0} кодов</small>
        <small>{active.length} активных строк · {checkpoints.length} контрольных итогов</small>
      </div>
      <button {...ui(UI_IDS.waterfall.settingsOpen)} ref={triggerRef} type="button" className="waterfall-settings-open" onClick={openDialog}>
        Настройки
      </button>
      {(validation.blockingErrors.length > 0 || validation.warnings.length > 0) && <span className={validation.blockingErrors.length ? "waterfall-summary-status error" : "waterfall-summary-status warning"} role="status">{validation.blockingErrors.length ? `${validation.blockingErrors.length} ошибок` : `${validation.warnings.length} предупреждений`}</span>}
    </section>
    {open && draft && createPortal(
      <div className="waterfall-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
        <div {...ui(UI_IDS.waterfall.dialog)} ref={dialogRef} className="waterfall-dialog" role="dialog" aria-modal="true" aria-labelledby="waterfall-dialog-title" onKeyDown={onDialogKeyDown}>
          <header className="waterfall-dialog-header">
            <div><h2 id="waterfall-dialog-title" {...ui("mapping.waterfall.dialog.title")}>Bridge / Waterfall{candidateMember && dialogDataset.id === "writecube_fin_reports" ? ` — ${FIN_ACCOUNT_DISPLAY[candidateMember]?.text || FIN_ACCOUNT_LABELS[candidateMember] || candidateMember} (${candidateMember})` : candidateMember ? ` — ${candidateMember}` : ""}</h2><p>Настройка последовательности движения показателя</p></div>
            <button {...ui(UI_IDS.waterfall.dialogClose)} type="button" className="waterfall-dialog-close" aria-label="Закрыть настройки" onClick={closeDialog}>×</button>
          </header>
          <div className="waterfall-dialog-body">
            <WaterfallSequenceEditor dataset={dialogDataset} config={draft} onChange={setDraft} onCandidateMemberChange={setCandidateMember} />
          </div>
          <footer className="waterfall-dialog-footer">
            <span {...ui("mapping.waterfall.dialog.dataset-status")}>{dialogDataset.label} · {validateBridgeSequence(dialogDataset, draft.waterfall).blockingErrors.length ? "Исправьте ошибки перед применением" : "Изменения применятся к текущей странице"}</span>
            <div><button {...ui(UI_IDS.waterfall.dialogCancel)} type="button" onClick={closeDialog}>Отмена</button><button {...ui(UI_IDS.waterfall.dialogApply)} type="button" className="primary" disabled={validateBridgeSequence(dialogDataset, draft.waterfall).blockingErrors.length > 0} onClick={applyDraft}>Применить</button></div>
          </footer>
        </div>
      </div>,
      document.body,
    )}
  </>;
}

export function SpecializedMapping(props: Props) {
  if (props.config.chartType === "threshold-comparison")
    return <ThresholdMapping {...props} />;
  if (props.config.chartType === "rolling-forecast")
    return <RollingMapping {...props} />;
  if (props.config.chartType === "waterfall")
    return <WaterfallSurface {...props} />;
  return null;
}
