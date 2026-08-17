import type { Dataset, DatasetId, FieldMeta } from "../../types";
import type { BrowserAnalyticalRuntime } from "../runtime/BrowserAnalyticalRuntime";
import type { AnalyticalQuery, ComposedDatasetDefinition, CsvDatasetDefinition, MemberStats, QueryFilter } from "../query/types";
import { datasetDefinition } from "../datasets/definitions";
import { DatasetRegistry } from "../datasets/DatasetRegistry";
import { validateAndNormalizeCsv } from "../datasets/formatValidator";

/**
 * Metadata boundary for builder controls. Components must ask this service for
 * members and availability instead of scanning Dataset.rows themselves.
 */
export class DatasetMetadataService {
  private readonly distinctCache = new Map<string, Promise<string[]>>();
  private readonly statsCache = new Map<string, Promise<MemberStats[]>>();

  constructor(
    private readonly runtime: BrowserAnalyticalRuntime,
    private readonly registry: DatasetRegistry,
    private readonly datasets: Record<string, Dataset>,
  ) {}

  fields(datasetId: DatasetId): FieldMeta[] {
    return this.datasets[datasetId]?.fields || [];
  }

  async ensureDataset(datasetId: DatasetId): Promise<void> {
    if (this.registry.state(datasetId)?.state === "ready") return;
    const definition = datasetDefinition(datasetId);
    if (!definition) throw new Error(`Dataset ${datasetId} не имеет CSV definition`);
    await this.runtime.initialize();
    if (definition.source.type === "composed") {
      const composedDefinition = definition as ComposedDatasetDefinition;
      if (!this.runtime.registerComposedDataset) throw new Error("Analytical runtime does not support composed datasets");
      const texts: Record<string, string> = {};
      for (const source of composedDefinition.source.sources) {
        const response = await fetch(source.definition.source.url);
        if (!response.ok) throw new Error(`Не удалось загрузить ${source.definition.source.url}`);
        texts[source.datasetId] = validateAndNormalizeCsv(await response.text(), this.datasets[source.datasetId], source.definition);
      }
      await this.runtime.registerComposedDataset(composedDefinition, texts);
    } else {
      const csvDefinition = definition as CsvDatasetDefinition;
      const response = await fetch(csvDefinition.source.url);
      if (!response.ok) throw new Error(`Не удалось загрузить ${definition.source.url}`);
      if (!this.runtime.registerDataset) throw new Error("Analytical runtime does not support CSV datasets");
      await this.runtime.registerDataset(csvDefinition, validateAndNormalizeCsv(await response.text(), this.datasets[datasetId], csvDefinition));
    }
  }

  async distinct(datasetId: DatasetId, fieldId: string, filters: QueryFilter[] = []): Promise<string[]> {
    const key = JSON.stringify([datasetId, fieldId, filters]);
    const cached = this.distinctCache.get(key);
    if (cached) return cached;
    const pending = this.ensureDataset(datasetId)
      .then(() => this.runtime.distinct({ datasetId, fieldId, filters }));
    this.distinctCache.set(key, pending);
    return pending;
  }

  async memberStats(
    datasetId: DatasetId,
    dimensionField: string,
    measureFields: string[],
    filters: QueryFilter[] = [],
  ): Promise<MemberStats[]> {
    const fields = [...new Set(measureFields)].filter(Boolean);
    const key = JSON.stringify([datasetId, dimensionField, fields, filters]);
    const cached = this.statsCache.get(key);
    if (cached) return cached;
    const query: AnalyticalQuery = {
      datasetId,
      dimensions: [{ fieldId: dimensionField }],
      measures: fields.map((fieldId) => ({ fieldId, aggregation: "SUM" as const })),
      filters,
      orderBy: [{ fieldId: dimensionField, direction: "asc" }],
      limit: 50000,
    };
    const pending = this.ensureDataset(datasetId).then(() => this.runtime.execute(query)).then((result) =>
      result.rows.map((row) => ({
        member: String(row[dimensionField] ?? ""),
        values: Object.fromEntries(fields.map((field) => [field, row[`${field}__SUM`] == null ? null : Number(row[`${field}__SUM`])])),
      })).filter((item) => item.member),
    );
    this.statsCache.set(key, pending);
    return pending;
  }

  async rowCount(datasetId: DatasetId): Promise<number> {
    await this.ensureDataset(datasetId);
    if (!this.runtime.countRows) throw new Error("Analytical runtime does not support row count");
    return this.runtime.countRows(datasetId);
  }

  clear(): void {
    this.distinctCache.clear();
    this.statsCache.clear();
  }
}
