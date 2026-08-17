import type { AnalyticalQuery, QueryResult } from "../query/types";
import type { BrowserAnalyticalRuntime } from "./BrowserAnalyticalRuntime";

export type QueryControllerState = "idle" | "loading" | "success" | "empty" | "error";

export interface QueryControllerSnapshot {
  state: QueryControllerState;
  queryKey: string | null;
  result: QueryResult | null;
  error: Error | null;
  cacheHit: boolean;
}

const stableKey = (query: AnalyticalQuery) => JSON.stringify(query);

export class QueryController {
  private readonly cache = new Map<string, QueryResult>();
  private active: { key: string; requestId: number; abort: AbortController } | null = null;
  private requestId = 0;
  private snapshot: QueryControllerSnapshot = { state: "idle", queryKey: null, result: null, error: null, cacheHit: false };

  constructor(private readonly runtime: BrowserAnalyticalRuntime) {}

  getSnapshot() { return this.snapshot; }

  clear() { this.cache.clear(); }

  cancel() {
    this.active?.abort.abort();
    this.active = null;
  }

  async execute(query: AnalyticalQuery): Promise<QueryControllerSnapshot> {
    const key = stableKey(query);
    const cached = this.cache.get(key);
    this.cancel();
    if (cached) {
      this.snapshot = { state: cached.rowCount ? "success" : "empty", queryKey: key, result: cached, error: null, cacheHit: true };
      return this.snapshot;
    }
    const requestId = ++this.requestId;
    const abort = new AbortController();
    this.active = { key, requestId, abort };
    this.snapshot = { state: "loading", queryKey: key, result: this.snapshot.result, error: null, cacheHit: false };
    try {
      const result = await this.runtime.execute(query, abort.signal);
      if (!this.active || this.active.requestId !== requestId || abort.signal.aborted) return this.snapshot;
      this.cache.set(key, result);
      this.active = null;
      this.snapshot = { state: result.rowCount ? "success" : "empty", queryKey: key, result, error: null, cacheHit: false };
      return this.snapshot;
    } catch (error) {
      if (abort.signal.aborted || !this.active || this.active.requestId !== requestId) return this.snapshot;
      this.active = null;
      this.snapshot = { state: "error", queryKey: key, result: this.snapshot.result, error: error instanceof Error ? error : new Error(String(error)), cacheHit: false };
      return this.snapshot;
    }
  }
}
