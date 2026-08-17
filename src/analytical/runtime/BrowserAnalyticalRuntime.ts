import type { AnalyticalQuery, DistinctQuery, QueryResult } from "../query/types";

export interface BrowserAnalyticalRuntime {
  initialize(): Promise<void>;
  registerDataset?(definition: import("../query/types").CsvDatasetDefinition, text: string): Promise<void>;
  registerComposedDataset?(definition: import("../query/types").ComposedDatasetDefinition, texts: Record<string, string>): Promise<void>;
  execute(query: AnalyticalQuery, signal?: AbortSignal): Promise<QueryResult>;
  distinct(query: DistinctQuery, signal?: AbortSignal): Promise<string[]>;
  countRows?(datasetId: import("../../types").DatasetId, signal?: AbortSignal): Promise<number>;
  dispose(): Promise<void>;
}
