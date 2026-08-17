import Papa from "papaparse";
import type { Dataset, FieldMeta } from "../../types";
import type { CsvDatasetDefinition } from "../query/types";

export interface DatasetFormatError { datasetId: string; fieldId: string; rowNumber: number; value: string; expectedFormats: string[]; message: string; }
export class DatasetFormatValidationError extends Error { constructor(public readonly errors: DatasetFormatError[]) { super(errors.map((error) => `${error.datasetId}.${error.fieldId}, строка ${error.rowNumber}, значение «${error.value || "∅"}»: ${error.message}`).join("; ")); this.name = "DatasetFormatValidationError"; } }
const parseDate = (value: string, format: string): { year: number; month: number; day?: number } | null => {
  const pattern = format === "YYYYMM" ? /^(\d{4})(\d{2})$/ : format === "YYYYMMDD" ? /^(\d{4})(\d{2})(\d{2})$/ : format === "YYYY-MM-DD" ? /^(\d{4})-(\d{2})-(\d{2})$/ : format === "YYYY.MM.DD" ? /^(\d{4})\.(\d{2})\.(\d{2})$/ : null;
  const match = pattern && value.match(pattern); if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = match[3] == null ? undefined : Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day !== undefined) { const date = new Date(Date.UTC(year, month - 1, day)); if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; }
  return { year, month, day };
};
const canonical = (parsed: { year: number; month: number; day?: number }, output: string) => output === "YYYYMM" ? `${parsed.year}${String(parsed.month).padStart(2, "0")}` : `${parsed.year}${String(parsed.month).padStart(2, "0")}${String(parsed.day || 1).padStart(2, "0")}`;
export function validateAndNormalizeCsv(text: string, dataset: Dataset, definition: CsvDatasetDefinition): string {
  const fields = dataset.fields.filter((field) => field.semantic?.dataType === "date"); if (!fields.length) return text;
  const delimiter = definition.source.delimiter || ",";
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, delimiter, skipEmptyLines: true }); const errors: DatasetFormatError[] = [];
  const rows = parsed.data.map((row, index) => { const next = { ...row }; fields.forEach((field: FieldMeta) => { const raw = String(row[field.id] ?? "").trim(), formats = field.semantic?.inputFormats || [], output = field.semantic?.outputFormat || formats[0]; const parsedValue = raw && output ? formats.map((format) => parseDate(raw, format)).find(Boolean) : null; if (!parsedValue) errors.push({ datasetId: dataset.id, fieldId: field.id, rowNumber: index + 2, value: raw, expectedFormats: formats, message: raw ? `Ожидался формат ${formats.join(", ")}` : "Пустое значение" }); else next[field.id] = canonical(parsedValue, output); }); return next; });
  if (errors.length) throw new DatasetFormatValidationError(errors.slice(0, 20));
  return Papa.unparse(rows, { delimiter });
}
