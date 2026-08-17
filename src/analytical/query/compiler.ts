import type { AnalyticalQuery, Primitive, QueryFilter } from "./types";

export interface CompiledQuery {
  sql: string;
  parameters: Primitive[];
}

const identifier = (value: string) => {
  // Source cubes use physical temporal columns such as `0date` and
  // `0calmonth`; quoted identifiers may start with a digit.
  if (!/^[A-Za-z0-9_]+$/.test(value))
    throw new Error(`Invalid SQL identifier: ${value}`);
  return `\"${value}\"`;
};

const placeholder = (parameters: Primitive[], value: Primitive) => {
  parameters.push(value);
  return `$${parameters.length}`;
};

export const temporalBucketExpression = (fieldId: string, granularity: "day" | "month", levelKey?: string | null) => {
  const field = `CAST(${identifier(fieldId)} AS VARCHAR)`;
  if (!levelKey || levelKey === "DAY" || (levelKey === "MONTH" && granularity === "month")) return field;
  const year = `substr(${field}, 1, 4)`;
  const month = `substr(${field}, 5, 2)`;
  if (levelKey === "MONTH") return `substr(${field}, 1, 6)`;
  if (levelKey === "YEAR") return year;
  if (levelKey === "HALF_YEAR") return `${year} || CASE WHEN ${month} <= '06' THEN 'H1' ELSE 'H2' END`;
  if (levelKey === "QUARTER") return `${year} || CASE WHEN ${month} <= '03' THEN 'Q1' WHEN ${month} <= '06' THEN 'Q2' WHEN ${month} <= '09' THEN 'Q3' ELSE 'Q4' END`;
  return field;
};

export function compileFilter(filter: QueryFilter, parameters: Primitive[]): string {
  const field = identifier(filter.fieldId);
  if (filter.operator === "IN" || filter.operator === "NOT_IN") {
    if (!filter.values.length) return "";
    const values = filter.values.map((value) => placeholder(parameters, value));
    return `${field} ${filter.operator === "IN" ? "IN" : "NOT IN"} (${values.join(", ")})`;
  }
  if (filter.operator === "BETWEEN") {
    const clauses: string[] = [];
    if (filter.from !== undefined && filter.from !== null) clauses.push(`${field} >= ${placeholder(parameters, filter.from)}`);
    if (filter.to !== undefined && filter.to !== null) clauses.push(`${field} <= ${placeholder(parameters, filter.to)}`);
    return clauses.length ? clauses.join(" AND ") : "";
  }
  const operator = filter.operator;
  const value = "value" in filter ? filter.value : null;
  return `${field} ${operator === "GTE" ? ">=" : operator === "LTE" ? "<=" : operator === "NE" ? "<>" : operator === "EQ" ? "=" : operator === "GT" ? ">" : "<"} ${placeholder(parameters, value)}`;
}

const aggregate = (measure: AnalyticalQuery["measures"][number]) => {
  if (measure.aggregation === "COUNT" && measure.fieldId === "*") return "CAST(COUNT(*) AS DOUBLE)";
  const field = identifier(measure.fieldId);
  const expression = measure.aggregation === "COUNT_DISTINCT"
    ? `COUNT(DISTINCT ${field})`
    : measure.aggregation === "FIRST_NON_NULL"
      ? `ARG_MIN(${field}, ${identifier(measure.orderBy?.[0]?.fieldId || measure.fieldId)})`
      : measure.aggregation === "LAST_NON_NULL"
        ? `ARG_MAX(${field}, ${identifier(measure.orderBy?.[0]?.fieldId || measure.fieldId)})`
        : `${measure.aggregation}(${field})`;
  return `CAST(${expression} AS DOUBLE)`;
};

export function compileAnalyticalQuery(query: AnalyticalQuery, tableName: string): CompiledQuery {
  const parameters: Primitive[] = [];
  const dimensions = query.dimensions.map((item) => {
    const expression = item.hierarchy
      ? temporalBucketExpression(item.fieldId, item.hierarchy.granularity || "month", item.hierarchy.levelKey)
      : `CAST(${identifier(item.fieldId)} AS VARCHAR)`;
    return `${expression} AS ${identifier(item.alias || item.fieldId)}`;
  });
  const measures = query.measures.map((item) => `${aggregate(item)} AS ${identifier(item.alias || (item.fieldId === "*" ? "row_count" : `${item.fieldId}__${item.aggregation}`))}`);
  if (!measures.length) throw new Error("AnalyticalQuery requires at least one measure");
  const select = [...dimensions, ...measures].join(", ");
  const where = query.filters.map((filter) => compileFilter(filter, parameters)).filter(Boolean);
  const group = dimensions.length ? ` GROUP BY ${dimensions.map((_, index) => index + 1).join(", ")}` : "";
  const order = query.orderBy?.length ? ` ORDER BY ${query.orderBy.map((item) => `${identifier(item.fieldId)} ${item.direction.toUpperCase()}`).join(", ")}` : "";
  const limit = query.limit && query.limit > 0 ? ` LIMIT ${Math.floor(query.limit)}` : "";
  return { sql: `SELECT ${select} FROM ${identifier(tableName)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${group}${order}${limit}`, parameters };
}

export function compileDistinctQuery(query: import("./types").DistinctQuery, tableName: string): CompiledQuery {
  const parameters: Primitive[] = [];
  const field = identifier(query.fieldId);
  const where = query.filters.map((filter) => compileFilter(filter, parameters)).filter(Boolean);
  return { sql: `SELECT DISTINCT ${field} AS ${field} FROM ${identifier(tableName)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${field}`, parameters };
}

export function querySignature(query: AnalyticalQuery): string {
  return JSON.stringify(query, Object.keys(query).sort());
}
