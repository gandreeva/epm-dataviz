import { parse } from "yaml";
import rawCatalog from "../../config/business_catalog.yaml?raw";
import type {
  Aggregation,
  DatasetId,
  DatasetPresentation,
  EventProjectionConfig,
  FieldCatalogMeta,
  FieldKind,
  TimeHierarchyDefinition,
  Unit,
} from "../types";
import type {
  ComposedDatasetDefinition,
  CsvDatasetDefinition,
  DatasetFieldSemantic,
  DatasetDefinition,
} from "../analytical/query/types";

type AnyMap = Record<string, any>;
const catalog = parse(rawCatalog) as AnyMap;
export const semanticDiagnostics: string[] = [];

const canonicalDatasets = () => catalog.datasets || {};
const defaults = (kind: FieldKind) => catalog.frontend_catalog?.defaults?.[kind] || {};

const hierarchyDefinition = (value: any): TimeHierarchyDefinition | undefined => {
  const source = typeof value === "string" ? catalog.hierarchies?.[value] : value;
  if (!source) return undefined;
  return {
    hierarchyId: source.id || source.key || (typeof value === "string" ? value : undefined),
    hierarchyName: source.name || source.id || String(value),
    displayLabel: source.label || source.name || String(value),
    defaultLevelKey: source.default_level || null,
    leafLevelKey: source.leaf_level || source.levels?.at(-1)?.key || "DAY",
    supportsDrill: source.supports_drill !== false,
    levels: (source.levels || []).map((level: AnyMap, index: number) => ({
      levelKey: level.key,
      levelLabel: level.label || level.key,
      depth: level.depth ?? index,
      parentLevelKey: level.parent || null,
      childLevelKey: level.child || null,
      ordinal: level.ordinal ?? index,
    })),
  };
};

const hierarchyList = (source: AnyMap): TimeHierarchyDefinition[] | undefined => {
  const refs = source.hierarchies || (source.hierarchy ? [source.hierarchy] : []);
  if (!Array.isArray(refs) || !refs.length) return undefined;
  return refs.map(hierarchyDefinition).filter((item: TimeHierarchyDefinition | undefined): item is TimeHierarchyDefinition => Boolean(item));
};

const metadata = (kind: FieldKind, role: string, value: any, businessObject?: string): FieldCatalogMeta => {
  const source = value && typeof value === "object" ? value : {};
  const base = defaults(kind);
  const dataType = source.data_type || base.data_type || (kind === "measure" ? "number" : "string");
  const members = source.members
    ? Object.fromEntries(Object.entries(source.members).map(([key, item]) => {
      const member = item as AnyMap;
      return [key, { label: member.title || key, timeRole: member.time_role }];
    }))
    : undefined;
  return {
    kind,
    label: source.title || role,
    unit: (source.unit || base.unit || (dataType === "date" ? "date" : "text")) as Unit,
    aggregations: kind === "measure" ? (source.aggregations || base.aggregations) as Aggregation[] : undefined,
    semantic: {
      businessObject: businessObject || source.business_object || "",
      role: source.semantic_role || source.role || role,
      dataType,
      temporalKey: source.temporal_key,
      granularity: source.granularity,
      inputFormats: source.input_formats,
      outputFormat: source.output_format,
      referenceId: source.reference,
      members,
      hierarchies: hierarchyList(source),
    },
  };
};

const fieldSemantics = (item: AnyMap): Record<string, DatasetFieldSemantic> | undefined => {
  const fields = item?.fields;
  if (!fields || typeof fields !== "object") return undefined;
  return Object.fromEntries(Object.entries(fields).map(([fieldId, value]) => {
    const field = value as AnyMap;
    return [fieldId, {
      dataType: field.data_type,
      semanticRole: field.semantic_role || field.role,
      granularity: field.granularity,
      inputFormats: Array.isArray(field.input_formats) ? field.input_formats : undefined,
      outputFormat: field.output_format,
    }];
  }));
};

const csvDefinition = (datasetId: string, item: AnyMap): CsvDatasetDefinition => ({
  datasetId: datasetId as DatasetId,
  source: {
    type: "csv",
    url: String(item?.source?.url || ""),
    delimiter: item?.source?.delimiter,
    decimalSeparator: item?.source?.decimal_separator,
    header: item?.source?.header !== false,
  },
  businessObject: item?.business_object,
  fields: fieldSemantics(item),
});

export function datasetDefinitionsFromCatalog(): DatasetDefinition[] {
  const datasets = canonicalDatasets();
  return Object.entries(datasets).map(([datasetId, raw]) => {
    const item = raw as AnyMap;
    if (item.type !== "composed") return csvDefinition(datasetId, item);
    const definition: ComposedDatasetDefinition = {
      datasetId: datasetId as DatasetId,
      source: {
        type: "composed",
        sources: (item.sources || []).map((source: AnyMap) => ({
          datasetId: source.dataset as DatasetId,
          definition: csvDefinition(String(source.dataset), datasets[source.dataset] || {}),
          mappings: source.mappings || {},
          constants: source.constants || undefined,
        })),
      },
      businessObject: item.business_object,
      fields: fieldSemantics(item),
    };
    return definition;
  });
}

export const catalogGroups: { dimension: string; measure: string } = {
  dimension: catalog.frontend_catalog?.groups?.dimension || "Dimensions",
  measure: catalog.frontend_catalog?.groups?.measure || "Measures",
};

export function datasetPresentation(datasetId: DatasetId): DatasetPresentation {
  const binding = canonicalDatasets()?.[datasetId] || {};
  return { label: binding.title || datasetId, description: binding.description || "", badge: binding.badge };
}

export function datasetSemanticMeta(datasetId: DatasetId) {
  const binding = canonicalDatasets()?.[datasetId] || {};
  return { ...datasetPresentation(datasetId), datasetId, businessObject: binding.business_object, cube: binding.cube };
}

export type ReferenceDefinition = { id: string; title: string; source?: string; key: string; fields?: Record<string, { column: string; title?: string }> };
export function referenceMeta(referenceId: string): ReferenceDefinition | undefined {
  const item = catalog.references?.[referenceId];
  if (!item) return undefined;
  return { id: referenceId, title: item.title || referenceId, source: item.source, key: item.key, fields: item.fields };
}

export function eventProjection(datasetId: DatasetId): EventProjectionConfig | undefined {
  const source = canonicalDatasets()?.[datasetId]?.event_projection;
  if (!source) return undefined;
  return {
    dateField: source.date_field,
    partitionBy: source.partition_by || [],
    commentSource: source.comment_source,
    categories: Object.entries(source.categories || {}).map(([key, value], order) => {
      const item = value as AnyMap;
      return { key, sourceField: item.source_field, label: item.title || key, color: item.color, unit: item.unit as Unit, rule: item.rule, order };
    }),
  };
}

export function fieldSemantic(datasetId: DatasetId, fieldId: string): FieldCatalogMeta {
  const binding = canonicalDatasets()?.[datasetId];
  if (!binding) return { kind: "dimension", label: fieldId, unit: "text", diagnostic: `Dataset ${datasetId} отсутствует в catalog.datasets` };
  const canonicalField = binding.fields?.[fieldId];
  if (canonicalField) return metadata(canonicalField.kind || "dimension", canonicalField.semantic_role || fieldId, canonicalField, binding.business_object);
  return { kind: "dimension", label: fieldId, unit: "text", diagnostic: `Поле ${fieldId} не описано в datasets.${datasetId}.fields` };
}

export function validateSemanticCatalog(inputCatalog: AnyMap = catalog): string[] {
  const issues: string[] = [];
  const sourceCatalog = inputCatalog || {};
  const sourceDatasets = sourceCatalog.datasets || {};
  const sourceDefaults = () => sourceCatalog.frontend_catalog?.defaults || {};
  if (sourceCatalog.frontend_datasets) issues.push("legacy frontend_datasets section is not supported; migrate it to datasets");
  if (sourceCatalog.business_objects) issues.push("legacy business_objects section is not supported; migrate it to datasets");
  const units = new Set(["currency", "percent", "count", "date", "text", "ratio"]);
  for (const [id, bindingValue] of Object.entries(sourceDatasets)) {
    const binding = bindingValue as AnyMap;
    if (!binding.source && binding.type !== "composed") issues.push(`${id}: missing source`);
    if (binding.type === "composed" && !Array.isArray(binding.sources)) issues.push(`${id}: missing composed sources`);
    if (!binding.title) issues.push(`${id}: missing title`);
    if (!binding.description) issues.push(`${id}: missing description`);
    for (const [fieldId, fieldValueItem] of Object.entries(binding.fields || {})) {
      const field = fieldValueItem as AnyMap;
      const kind = field.kind === "measure" ? "measure" : "dimension";
      if (!field.field) issues.push(`${id}.${fieldId}: missing physical field`);
      const unit = field.unit || sourceDefaults()[kind]?.unit;
      if (!units.has(unit)) issues.push(`${id}.${fieldId}: invalid unit ${unit}`);
      if (field.data_type === "date" && !(field.input_formats || field.output_format)) issues.push(`${id}.${fieldId}: missing date format`);
      for (const hierarchy of field.hierarchies || []) {
        if (!sourceCatalog.hierarchies?.[hierarchy]) issues.push(`${id}.${fieldId}: unknown hierarchy ${hierarchy}`);
      }
    }
    if (binding.type === "composed") {
      for (const source of binding.sources || []) {
        if (!sourceDatasets[source.dataset]) issues.push(`${id}: unknown source dataset ${source.dataset}`);
        const sourceFields = sourceDatasets[source.dataset]?.fields || {};
        for (const [physical, target] of Object.entries(source.mappings || {})) {
          if (!sourceFields[physical]) issues.push(`${id}: mapping source field ${source.dataset}.${physical} is not defined`);
          if (!binding.fields?.[String(target)]) issues.push(`${id}: mapping target field ${target} is not defined`);
        }
      }
    }
  }
  return issues;
}
