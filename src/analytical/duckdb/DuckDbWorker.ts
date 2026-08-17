export type DuckDbWorkerRequest =
  | { type: "initialize" }
  | { type: "register-csv"; name: string; text: string; delimiter?: string }
  | { type: "query"; sql: string; parameters: unknown[] };

export type DuckDbWorkerResponse =
  | { type: "ready" }
  | { type: "result"; columns: Array<{ name: string; type?: string }>; rows: Record<string, unknown>[] }
  | { type: "error"; message: string };
