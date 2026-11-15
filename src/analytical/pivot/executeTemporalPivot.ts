import type { QueryResult } from "../query/types";
import type { QueryController } from "../runtime/QueryController";
import type { TemporalPivotPlan, TemporalPivotScope } from "./temporalPivot";

/** Execute bounded batches and never publish results from a superseded view. */
export async function executeTemporalPivot(
  plan: TemporalPivotPlan,
  controllerFor: (scope: TemporalPivotScope) => Pick<QueryController, "execute">,
  isCancelled: () => boolean,
): Promise<Map<string, QueryResult> | null> {
  const results = new Map<string, QueryResult>();
  for (let offset = 0; offset < plan.scopes.length; offset += 4) {
    if (isCancelled()) return null;
    const batch = await Promise.all(plan.scopes.slice(offset, offset + 4).map(async (scope) => {
      const snapshot = await controllerFor(scope).execute(scope.query);
      if (isCancelled()) return null;
      if ((snapshot.state !== "success" && snapshot.state !== "empty") || !snapshot.result || snapshot.queryKey !== JSON.stringify(scope.query)) {
        throw snapshot.error || new Error("Нет актуального результата Pivot query");
      }
      if (snapshot.result.rowCount >= (scope.query.limit || Infinity)) throw new Error("Превышен лимит строк временной иерархии Pivot; уточните фильтры");
      return [scope.key, snapshot.result] as const;
    }));
    if (isCancelled()) return null;
    for (const entry of batch) if (entry) results.set(entry[0], entry[1]);
  }
  return results;
}
