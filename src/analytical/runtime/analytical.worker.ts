import { DuckDbRuntime } from "../duckdb/DuckDbRuntime";
import { DatasetRegistry } from "../datasets/DatasetRegistry";
import type { AnalyticalWorkerRequest, AnalyticalWorkerResponse } from "./workerProtocol";

const registry = new DatasetRegistry();
const runtime = new DuckDbRuntime(registry);
const controllers = new Map<string, AbortController>();

self.onmessage = (event: MessageEvent<AnalyticalWorkerRequest>) => {
  const request = event.data;
  const respond = (response: AnalyticalWorkerResponse) => self.postMessage(response);
  if (request.type === "cancel") {
    controllers.get(request.targetRequestId)?.abort();
    controllers.delete(request.targetRequestId);
    return;
  }
  if (request.type === "dispose") {
    void runtime.dispose().then(() => respond({ requestId: request.requestId, type: "ready" }));
    return;
  }
  const abort = new AbortController();
  controllers.set(request.requestId, abort);
  void (async () => {
    const started = performance.now();
    const datasetId = "query" in request ? request.query.datasetId : "datasetId" in request ? request.datasetId : undefined;
    if (["execute", "distinct", "memberStats", "countRows"].includes(request.type)) respond({ requestId: request.requestId, type: "progress", phase: "started", datasetId });
    try {
      if (request.type === "initialize") {
        await runtime.initialize();
        respond({ requestId: request.requestId, type: "ready" });
      } else if (request.type === "registerDataset") {
        await runtime.registerDataset(request.definition, request.text);
        respond({ requestId: request.requestId, type: "ready" });
      } else if (request.type === "registerComposedDataset") {
        await runtime.registerComposedDataset(request.definition, request.texts);
        respond({ requestId: request.requestId, type: "ready" });
      } else if (request.type === "execute") {
        const result = await runtime.execute(request.query, abort.signal);
        respond({ requestId: request.requestId, type: "result", result });
      } else if (request.type === "distinct") {
        respond({ requestId: request.requestId, type: "result", result: await runtime.distinct(request.query, abort.signal) });
      } else if (request.type === "memberStats") {
        const result = await runtime.execute({ datasetId: request.datasetId, dimensions: [{ fieldId: request.dimensionField }], measures: request.measureFields.map((fieldId) => ({ fieldId, aggregation: "SUM" as const })), filters: request.filters });
        respond({ requestId: request.requestId, type: "result", result: result.rows.map((row) => ({ member: String(row[request.dimensionField] ?? ""), values: Object.fromEntries(request.measureFields.map((field) => [field, row[`${field}__SUM`] == null ? null : Number(row[`${field}__SUM`])])) })).filter((item) => item.member) });
      } else if (request.type === "countRows") {
        respond({ requestId: request.requestId, type: "result", result: await runtime.countRows(request.datasetId, abort.signal) });
      }
      if (["execute", "distinct", "memberStats", "countRows"].includes(request.type)) respond({ requestId: request.requestId, type: "progress", phase: "finished", datasetId, durationMs: performance.now() - started });
    } catch (error) {
      respond({ requestId: request.requestId, type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      controllers.delete(request.requestId);
    }
  })();
};
