/** Values crossing the DuckDB Worker RPC boundary must be structured-clone and
 * JSON safe. DuckDB/Arrow commonly exposes COUNT and integer columns as
 * bigint; JSON.stringify (used by Pivot branch de-duplication and diagnostics)
 * otherwise throws. Preserve safe integers as numbers and large integers as
 * strings so they cannot silently lose precision. */
export const normalizeTransportValue = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeTransportValue);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length) return Object.fromEntries(entries.map(([key, item]) => [key, normalizeTransportValue(item)]));
    return String(value);
  }
  return String(value);
};

export const normalizeTransportRow = (row: Record<string, unknown>) =>
  normalizeTransportValue(row) as Record<string, unknown>;

export const transportKey = (value: unknown) => JSON.stringify(normalizeTransportValue(value));
