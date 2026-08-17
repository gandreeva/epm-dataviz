import type { DataRow } from "../types";
import type { ComposedDatasetDefinition } from "../analytical/query/types";
import { normalizeTemporalValue } from "../analytical/datasets/temporalNormalization";

/** Builds a compatibility row set from the same composed definition used by DuckDB. */
export const composeDatasetRows = (
  definition: ComposedDatasetDefinition,
  sourceRows: Record<string, DataRow[]>,
): DataRow[] => definition.source.sources.flatMap((source) => {
  const rows = sourceRows[source.datasetId] || [];
  return rows.map((row) => {
    const result: DataRow = {};
    for (const [physical, canonical] of Object.entries(source.mappings)) {
      result[canonical] = normalizeTemporalValue(
        row[physical],
        source.definition.fields?.[physical],
        definition.fields?.[canonical],
      ) as DataRow[string];
    }
    for (const [field, value] of Object.entries(source.constants || {})) result[field] = typeof value === "boolean" ? String(value) : value;
    return result;
  });
});
