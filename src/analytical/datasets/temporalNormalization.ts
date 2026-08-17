import type { DatasetFieldSemantic } from "../query/types";

const compactDate = (value: unknown) => String(value ?? "").trim().replace(/[-.]/g, "");

const isTemporal = (field?: DatasetFieldSemantic) => Boolean(field && (
  field.dataType === "date" || field.semanticRole === "date" || field.semanticRole === "calmonth"
));

/** Converts a physical temporal value to the canonical format declared by the target field. */
export const normalizeTemporalValue = (
  value: unknown,
  sourceField?: DatasetFieldSemantic,
  targetField?: DatasetFieldSemantic,
) => {
  if (value == null || value === "" || !sourceField || !targetField || !isTemporal(sourceField) || !isTemporal(targetField)) return value;
  const compact = compactDate(value);
  if (targetField.outputFormat === "YYYYMM" || targetField.granularity === "month") {
    if (/^\d{8}$/.test(compact) || /^\d{6}$/.test(compact)) return compact.slice(0, 6);
    return null;
  }
  if (targetField.outputFormat === "YYYYMMDD" || targetField.granularity === "day") {
    if (/^\d{8}$/.test(compact)) return compact;
    if (/^\d{6}$/.test(compact)) return `${compact}01`;
    return null;
  }
  return value;
};
