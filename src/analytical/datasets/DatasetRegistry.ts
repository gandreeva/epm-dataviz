import type { DatasetId } from "../../types";
import type { DatasetDefinition, RegisteredDataset } from "../query/types";

export class DatasetRegistry {
  private readonly definitions = new Map<DatasetId, DatasetDefinition>();
  private readonly registered = new Map<DatasetId, RegisteredDataset>();
  private readonly loading = new Map<DatasetId, Promise<void>>();
  private readonly texts = new Map<string, string>();

  register(definition: DatasetDefinition) {
    this.definitions.set(definition.datasetId, definition);
  }

  definition(datasetId: DatasetId) {
    return this.definitions.get(datasetId);
  }

  state(datasetId: DatasetId): RegisteredDataset | undefined {
    return this.registered.get(datasetId);
  }

  setState(datasetId: DatasetId, state: RegisteredDataset) {
    this.registered.set(datasetId, state);
  }

  pending(datasetId: DatasetId) { return this.loading.get(datasetId); }
  setPending(datasetId: DatasetId, promise: Promise<void>) { this.loading.set(datasetId, promise); promise.finally(() => this.loading.delete(datasetId)); }
  text(key: string) { return this.texts.get(key); }
  setText(key: string, value: string) { this.texts.set(key, value); }
}
