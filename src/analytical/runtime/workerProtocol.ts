import type { DatasetId } from "../../types";
import type { AnalyticalQuery, CsvDatasetDefinition, DistinctQuery, MemberStats, QueryFilter, QueryResult } from "../query/types";

export type AnalyticalWorkerRequest =
  | { requestId: string; type: "initialize" }
  | { requestId: string; type: "registerDataset"; definition: CsvDatasetDefinition; text: string }
  | { requestId: string; type: "registerComposedDataset"; definition: import("../query/types").ComposedDatasetDefinition; texts: Record<string, string> }
  | { requestId: string; type: "execute"; query: AnalyticalQuery }
  | { requestId: string; type: "distinct"; query: DistinctQuery }
  | { requestId: string; type: "memberStats"; datasetId: DatasetId; dimensionField: string; measureFields: string[]; filters: QueryFilter[] }
  | { requestId: string; type: "countRows"; datasetId: DatasetId }
  | { requestId: string; type: "cancel"; targetRequestId: string }
  | { requestId: string; type: "dispose" };

export type AnalyticalWorkerResponse =
  | { requestId: string; type: "ready" }
  | { requestId: string; type: "result"; result: QueryResult | string[] | MemberStats[] | number }
  | { requestId: string; type: "error"; message: string }
  | { requestId: string; type: "progress"; phase: "started" | "finished"; datasetId?: DatasetId; durationMs?: number; rowCount?: number };
