import type { DatasetId } from "../../types";
import type { BrowserAnalyticalRuntime } from "./BrowserAnalyticalRuntime";
import type { AnalyticalQuery, DatasetDefinition, DistinctQuery, QueryResult } from "../query/types";
import type { AnalyticalWorkerRequest, AnalyticalWorkerResponse } from "./workerProtocol";
import { DatasetRegistry } from "../datasets/DatasetRegistry";

type WorkerRequestBody = { [K in AnalyticalWorkerRequest["type"]]: Omit<Extract<AnalyticalWorkerRequest, { type: K }>, "requestId"> }[AnalyticalWorkerRequest["type"]];

export class ApplicationAnalyticalClient implements BrowserAnalyticalRuntime {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  onProgress?: (event: Extract<AnalyticalWorkerResponse, { type: "progress" }>) => void;
  constructor(private readonly registry?: DatasetRegistry) {}

  private ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./analytical.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<AnalyticalWorkerResponse>) => {
      const pending = this.pending.get(event.data.requestId);
      if (event.data.type === "progress") { this.onProgress?.(event.data); return; }
      if (!pending) return;
      this.pending.delete(event.data.requestId);
      event.data.type === "error" ? pending.reject(new Error(event.data.message)) : pending.resolve(event.data.type === "ready" ? undefined : event.data.result);
    };
    worker.onerror = (event) => { for (const pending of this.pending.values()) pending.reject(new Error(event.message || "Analytical worker failed")); this.pending.clear(); };
    this.worker = worker;
    return worker;
  }

  private request<T>(request: WorkerRequestBody, signal?: AbortSignal): Promise<T> {
    const requestId = crypto.randomUUID();
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => { this.pending.delete(requestId); worker.postMessage({ requestId: crypto.randomUUID(), type: "cancel", targetRequestId: requestId }); reject(new DOMException("Query cancelled", "AbortError")); };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(requestId, { resolve: (value) => { signal?.removeEventListener("abort", onAbort); resolve(value); }, reject: (error) => { signal?.removeEventListener("abort", onAbort); reject(error); } });
      worker.postMessage({ ...request, requestId });
    });
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => { this.ensureWorker(); await this.request<void>({ type: "initialize" }); this.initialized = true; })();
    try { await this.initializePromise; } finally { this.initializePromise = null; }
  }
  async registerDataset(definition: import("../query/types").CsvDatasetDefinition, text: string) { await this.initialize(); await this.request<void>({ type: "registerDataset", definition, text }); this.registry?.setState(definition.datasetId, { definition, tableName: `dataset_${definition.datasetId.replace(/[^A-Za-z0-9_]/g, "_")}`, state: "ready" }); }
  async registerComposedDataset(definition: import("../query/types").ComposedDatasetDefinition, texts: Record<string, string>) { await this.initialize(); await this.request<void>({ type: "registerComposedDataset", definition, texts }); this.registry?.setState(definition.datasetId, { definition, tableName: `dataset_${definition.datasetId.replace(/[^A-Za-z0-9_]/g, "_")}`, state: "ready" }); }
  async execute(query: AnalyticalQuery, signal?: AbortSignal): Promise<QueryResult> { await this.initialize(); return this.request<QueryResult>({ type: "execute", query }, signal); }
  async distinct(query: DistinctQuery, signal?: AbortSignal): Promise<string[]> { await this.initialize(); return this.request<string[]>({ type: "distinct", query }, signal); }
  async countRows(datasetId: DatasetId, signal?: AbortSignal): Promise<number> { await this.initialize(); return this.request<number>({ type: "countRows", datasetId }, signal); }
  async memberStats(datasetId: DatasetId, dimensionField: string, measureFields: string[], filters: import("../query/types").QueryFilter[] = [], signal?: AbortSignal) { await this.initialize(); return this.request<import("../query/types").MemberStats[]>({ type: "memberStats", datasetId, dimensionField, measureFields, filters }, signal); }
  async dispose() { if (this.worker) { await this.request<void>({ type: "dispose" }); this.worker.terminate(); this.worker = null; this.initialized = false; } }
}
