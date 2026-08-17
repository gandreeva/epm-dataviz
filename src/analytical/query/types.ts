import type { DatasetId, Aggregation } from "../../types";

export type Primitive = string | number | boolean | null;

export interface DimensionSelection {
  fieldId: string;
  alias?: string;
  hierarchy?: { hierarchyId: string | number; levelKey: string; granularity?: "day" | "month" };
}

export interface MeasureSelection {
  fieldId: string;
  aggregation: Aggregation | "COUNT_DISTINCT" | "FIRST_NON_NULL" | "LAST_NON_NULL";
  alias?: string;
  orderBy?: Array<{ fieldId: string; direction: "asc" | "desc" }>;
}

export type QueryFilter =
  | { fieldId: string; operator: "IN" | "NOT_IN"; values: Primitive[] }
  | { fieldId: string; operator: "BETWEEN"; from?: Primitive; to?: Primitive }
  | { fieldId: string; operator: "EQ" | "NE" | "GT" | "GTE" | "LT" | "LTE"; value: Primitive };

export interface QueryOrder {
  fieldId: string;
  direction: "asc" | "desc";
}

export interface AnalyticalQuery {
  datasetId: DatasetId;
  dimensions: DimensionSelection[];
  measures: MeasureSelection[];
  filters: QueryFilter[];
  orderBy?: QueryOrder[];
  limit?: number;
}

export interface QueryColumn { name: string; type?: string }

export interface QueryDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  queryId?: string;
  datasetId?: DatasetId;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  diagnostics: QueryDiagnostic[];
  execution: { queryId: string; durationMs: number; datasetId: DatasetId };
}

/** Aggregated metadata used by mapping controls, never by renderers. */
export interface MemberStats {
  member: string;
  values: Record<string, number | null>;
}

export interface DistinctQuery {
  datasetId: DatasetId;
  fieldId: string;
  filters: QueryFilter[];
}

export interface CsvDatasetDefinition {
  datasetId: DatasetId;
  source: { type: "csv"; url: string; delimiter?: "," | ";" | "\t"; decimalSeparator?: "." | ","; header: boolean };
  businessObject?: string;
  /** Serializable semantic hints used when a physical field is mapped into a composed dataset. */
  fields?: Record<string, DatasetFieldSemantic>;
}

export interface DatasetFieldSemantic {
  dataType?: string;
  semanticRole?: string;
  granularity?: string;
  inputFormats?: string[];
  outputFormat?: string;
}

export interface ComposedDatasetDefinition {
  datasetId: DatasetId;
  source: {
    type: "composed";
    sources: Array<{
      datasetId: DatasetId;
      definition: CsvDatasetDefinition;
      mappings: Record<string, string>;
      constants?: Record<string, Primitive>;
    }>;
  };
  businessObject?: string;
  fields?: Record<string, DatasetFieldSemantic>;
}

export type DatasetDefinition = CsvDatasetDefinition | ComposedDatasetDefinition;

export interface RegisteredDataset {
  definition: DatasetDefinition;
  tableName: string;
  state: "loading" | "ready" | "error";
  physicalSchema?: QueryColumn[];
  error?: QueryDiagnostic;
}
