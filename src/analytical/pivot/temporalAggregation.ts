import type { DataRow, PivotAggregationOperation } from "../../types";

/** Aggregation of already aggregated base-period values, in chronological order. */
export type PivotTemporalOperation = PivotAggregationOperation | "FIRST_NON_NULL" | "LAST_NON_NULL";

export interface PivotPeriodValue {
  period: string;
  value: number | null;
}

export type PivotTimeLevel = "YEAR" | "HALF_YEAR" | "QUARTER" | "MONTH" | "DAY";

/** The canonical time key used by the analytical query compiler. */
export function pivotPeriodKey(value: unknown, level: PivotTimeLevel): string | null {
  const date = String(value ?? "");
  if (!/^\d{6}(?:\d{2})?$/.test(date)) return null;
  const year = date.slice(0, 4), month = Number(date.slice(4, 6));
  if (month < 1 || month > 12 || (level === "DAY" && date.length !== 8)) return null;
  if (level === "YEAR") return year;
  if (level === "HALF_YEAR") return `${year}H${month <= 6 ? 1 : 2}`;
  if (level === "QUARTER") return `${year}Q${Math.ceil(month / 3)}`;
  return level === "MONTH" ? date.slice(0, 6) : date;
}

/** Apply the ordinary operation to raw non-null measure values. */
export function aggregatePivotBaseRows(rows: DataRow[], field: string, operation: PivotAggregationOperation): number | null {
  const values = rows.map((row) => row[field]).filter((value) => value != null && value !== "")
    .map(Number).filter(Number.isFinite);
  if (operation === "COUNT") return values.length;
  if (operation === "COUNT_DISTINCT") return new Set(values).size;
  if (!values.length) return null;
  if (operation === "MIN") return Math.min(...values);
  if (operation === "MAX") return Math.max(...values);
  const sum = values.reduce((total, value) => total + value, 0);
  return operation === "AVG" ? sum / values.length : sum;
}

/** Calculate one already-filtered cell from source rows at the configured base grain. */
export function aggregatePivotTemporalCell(
  rows: DataRow[], field: string, dateField: string, baseLevel: PivotTimeLevel,
  baseOperation: PivotAggregationOperation, hierarchyOperation: PivotTemporalOperation,
): number | null {
  const periods = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = pivotPeriodKey(row[dateField], baseLevel);
    if (key === null) continue;
    const group = periods.get(key) || [];
    group.push(row);
    periods.set(key, group);
  }
  return aggregatePivotPeriods([...periods].map(([period, group]) => ({
    period, value: aggregatePivotBaseRows(group, field, baseOperation),
  })), hierarchyOperation);
}

/**
 * Roll up base-period aggregates, not the raw rows or intermediate subtotals.
 * The caller is responsible for grouping the input by its non-time dimensions.
 */
export function aggregatePivotPeriods(values: PivotPeriodValue[], operation: PivotTemporalOperation): number | null {
  const present = values
    .filter((item): item is { period: string; value: number } => item.value !== null && Number.isFinite(item.value))
    .sort((a, b) => a.period.localeCompare(b.period));
  if (operation === "COUNT") return present.length;
  if (operation === "COUNT_DISTINCT") return new Set(present.map((item) => item.value)).size;
  if (!present.length) return null;
  if (operation === "FIRST_NON_NULL") return present[0].value;
  if (operation === "LAST_NON_NULL") return present[present.length - 1].value;
  const numbers = present.map((item) => item.value);
  if (operation === "MIN") return Math.min(...numbers);
  if (operation === "MAX") return Math.max(...numbers);
  const sum = numbers.reduce((total, value) => total + value, 0);
  return operation === "AVG" ? sum / numbers.length : sum;
}
