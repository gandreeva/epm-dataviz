import * as duckdb from "@duckdb/duckdb-wasm";
import localWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import localModuleUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import type { DatasetDefinition, CsvDatasetDefinition, ComposedDatasetDefinition, DatasetFieldSemantic, QueryResult, AnalyticalQuery, DistinctQuery } from "../query/types";
import { compileAnalyticalQuery, compileDistinctQuery } from "../query/compiler";
import { DatasetRegistry } from "../datasets/DatasetRegistry";
import type { BrowserAnalyticalRuntime } from "../runtime/BrowserAnalyticalRuntime";
import { normalizeTransportRow } from "../query/transport";

const tableName = (datasetId: string) => `dataset_${datasetId.replace(/[^A-Za-z0-9_]/g, "_")}`;
// Physical CSV columns may legitimately start with a digit (for example
// `0date` and `0calmonth`). They are still safe to quote as long as the
// identifier contains only the catalog-supported word characters.
const identifier = (value: string) => { if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`Invalid SQL identifier: ${value}`); return `"${value}"`; };
const literal = (value: unknown) => value == null ? "NULL" : typeof value === "number" || typeof value === "boolean" ? String(value) : `'${String(value).replace(/'/g, "''")}'`;

const isDateField = (field?: DatasetFieldSemantic) => Boolean(field && (
  field.dataType === "date" || field.semanticRole === "date" || field.semanticRole === "calmonth"
));

/**
 * Composed datasets expose canonical fields, so mapped temporal values must be
 * converted to the canonical representation before UNION ALL. In particular,
 * a daily YYYYMMDD source can feed a monthly YYYYMM field without leaking its
 * day suffix into the shared time axis.
 */
const mappedExpression = (
  physical: string,
  sourceField: DatasetFieldSemantic | undefined,
  targetField: DatasetFieldSemantic | undefined,
) => {
  const expression = identifier(physical);
  if (!sourceField || !targetField || !isDateField(sourceField) || !isDateField(targetField)) return expression;
  const value = `TRIM(CAST(${expression} AS VARCHAR))`;
  if (targetField.outputFormat === "YYYYMM" || targetField.granularity === "month") {
    return `(CASE WHEN regexp_matches(${value}, '^[0-9]{8}$') THEN substr(${value}, 1, 6) WHEN regexp_matches(${value}, '^[0-9]{6}$') THEN ${value} ELSE NULL END)`;
  }
  if (targetField.outputFormat === "YYYYMMDD" || targetField.granularity === "day") {
    return `(CASE WHEN regexp_matches(${value}, '^[0-9]{8}$') THEN ${value} WHEN regexp_matches(${value}, '^[0-9]{6}$') THEN ${value} || '01' ELSE NULL END)`;
  }
  return expression;
};

export class DuckDbRuntime implements BrowserAnalyticalRuntime {
  private db: duckdb.AsyncDuckDB | null = null;
  private connection: duckdb.AsyncDuckDBConnection | null = null;
  private initialized = false;
  constructor(private readonly registry: DatasetRegistry) {}

  async initialize() {
    if (this.initialized) return;
    // The runtime itself already runs in an application Worker. CDN worker URLs
    // cannot be constructed from that Worker because of the browser's same
    // origin policy, so keep the DuckDB worker and WASM module in the Vite
    // bundle as same-origin assets.
    const worker = new Worker(localWorkerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(localModuleUrl, null);
    this.db = db;
    this.connection = await db.connect();
    this.initialized = true;
  }

  async registerDataset(definition: CsvDatasetDefinition, text: string) {
    await this.initialize();
    if (!this.db || !this.connection) throw new Error("DuckDB runtime is not initialized");
    const name = `${tableName(definition.datasetId)}.csv`;
    await this.db.registerFileText(name, text);
    const delimiter = definition.source.delimiter ? `, delim='${definition.source.delimiter}'` : "";
    const decimal = definition.source.decimalSeparator ? `, decimal_separator='${definition.source.decimalSeparator}'` : "";
    await this.connection.query(`CREATE OR REPLACE TABLE ${tableName(definition.datasetId)} AS SELECT * FROM read_csv_auto('${name}'${delimiter}${decimal}, header=${definition.source.header})`);
    this.registry.setState(definition.datasetId, { definition, tableName: tableName(definition.datasetId), state: "ready" });
  }

  async registerComposedDataset(definition: ComposedDatasetDefinition, texts: Record<string, string>) {
    await this.initialize();
    if (!this.connection) throw new Error("DuckDB runtime is not initialized");
    for (const source of definition.source.sources) {
      const text = texts[source.datasetId];
      if (text == null) throw new Error(`Source ${source.datasetId} for ${definition.datasetId} is unavailable`);
      await this.registerDataset(source.definition, text);
    }
    const outputFields = [...new Set(definition.source.sources.flatMap((source) => [...Object.values(source.mappings), ...Object.keys(source.constants || {})]))];
    const selects = definition.source.sources.map((source) => {
      const reverse = new Map(Object.entries(source.mappings).map(([physical, canonical]) => [canonical, physical]));
      return `SELECT ${outputFields.map((field) => {
        if (reverse.has(field)) {
          const physical = reverse.get(field)!;
          const expression = mappedExpression(physical, source.definition.fields?.[physical], definition.fields?.[field]);
          return `${expression} AS ${identifier(field)}`;
        }
        return source.constants && field in source.constants
          ? `${literal(source.constants[field])} AS ${identifier(field)}`
          : `NULL AS ${identifier(field)}`;
      }).join(", ")} FROM ${identifier(tableName(source.datasetId))}`;
    });
    await this.connection.query(`CREATE OR REPLACE TABLE ${identifier(tableName(definition.datasetId))} AS ${selects.join(" UNION ALL ")}`);
    this.registry.setState(definition.datasetId, { definition, tableName: tableName(definition.datasetId), state: "ready" });
  }

  async execute(query: AnalyticalQuery, signal?: AbortSignal): Promise<QueryResult> {
    await this.initialize();
    if (!this.connection) throw new Error("DuckDB runtime is not initialized");
    if (signal?.aborted) throw new DOMException("Query cancelled", "AbortError");
    const registered = this.registry.state(query.datasetId);
    if (!registered || registered.state !== "ready") throw new Error(`Dataset ${query.datasetId} is not registered`);
    const started = performance.now();
    const compiled = compileAnalyticalQuery(query, registered.tableName);
    const statement = await this.connection.prepare(compiled.sql);
    try {
      const table = await statement.query(...compiled.parameters);
      const rows = table.toArray().map((row) => normalizeTransportRow({ ...row }));
      return { columns: table.schema.fields.map((field) => ({ name: field.name })), rows, rowCount: rows.length, diagnostics: [], execution: { queryId: crypto.randomUUID(), durationMs: performance.now() - started, datasetId: query.datasetId } };
    } finally {
      await statement.close();
    }
  }

  async distinct(query: DistinctQuery, signal?: AbortSignal): Promise<string[]> {
    await this.initialize();
    if (!this.connection) throw new Error("DuckDB runtime is not initialized");
    if (signal?.aborted) throw new DOMException("Query cancelled", "AbortError");
    const registered = this.registry.state(query.datasetId);
    if (!registered || registered.state !== "ready") throw new Error(`Dataset ${query.datasetId} is not registered`);
    const compiled = compileDistinctQuery(query, registered.tableName);
    const statement = await this.connection.prepare(compiled.sql);
    try {
      const table = await statement.query(...compiled.parameters);
      return table.toArray().map((row) => String((row as Record<string, unknown>)[query.fieldId] ?? "")).filter(Boolean);
    } finally { await statement.close(); }
  }

  async countRows(datasetId: import("../../types").DatasetId, signal?: AbortSignal): Promise<number> {
    const registered = this.registry.state(datasetId);
    if (!registered) throw new Error(`Dataset ${datasetId} is not registered`);
    const result = await this.execute({ datasetId, dimensions: [], measures: [{ fieldId: "*", aggregation: "COUNT" as const }], filters: [] }, signal);
    return Number(result.rows[0]?.row_count ?? 0);
  }

  async dispose() {
    await this.connection?.close();
    await this.db?.terminate();
    this.connection = null;
    this.db = null;
    this.initialized = false;
  }
}
