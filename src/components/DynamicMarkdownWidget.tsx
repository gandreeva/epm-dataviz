import React, { useMemo } from "react";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import DOMPurify from "dompurify";
import type { DashboardWidget, FieldMeta } from "../types";
import { ui } from "../uiIds";

export type MarkdownFieldValue = { raw: unknown; formatted: string; label: string };
export type MarkdownRow = { fields: Record<string, MarkdownFieldValue>; values: Record<string, MarkdownFieldValue>; row_total: Record<string, MarkdownFieldValue> };
export type MarkdownContext = { rows: MarkdownRow[]; columns: MarkdownFieldValue[]; values: MarkdownFieldValue[]; col_totals: Record<string, Record<string, MarkdownFieldValue>>; grand_totals: Record<string, MarkdownFieldValue> };
type Props = { widget: DashboardWidget; context: MarkdownContext; fields: FieldMeta[]; editable: boolean; onChangeTitle: (title: string) => void; onChangeConfig: (patch: NonNullable<DashboardWidget["markdownConfig"]>) => void; onDrill?: (row: MarkdownRow, raw: string) => void };

const field = (row: MarkdownRow | undefined, name: string) => row?.fields[name] || row?.values[name] || row?.row_total[name] || { raw: "", formatted: "—", label: "—" };
const resolve = (value: string, scope: MarkdownRow | undefined, context: MarkdownContext) => {
  const cleaned = value.trim().replace(/^`|`$/g, "");
  if (cleaned === "rows") return context.rows;
  const match = cleaned.match(/^(?:rows\[(-?\d+)\]|rows\.(-?\d+))\.(?:values\.)?`?([^`.]+)`?(?:\.(raw|formatted))?$/);
  if (match) { const index = Number(match[1] ?? match[2]); const item = context.rows[index < 0 ? context.rows.length + index : index]; const result = field(item, match[3]); return match[4] === "raw" ? result.raw : result.formatted; }
  const direct = cleaned.match(/^(?:(?:values|value)\.)?`?([^`.]+)`?(?:\.(raw|formatted))?$/);
  if (direct && scope) { const result = field(scope, direct[1]); const fallback = result.formatted === "—" && scope.values.value ? scope.values.value : result; return direct[2] === "raw" ? fallback.raw : fallback.formatted; }
  const total = cleaned.match(/^grand_totals\.`?([^`.]+)`?(?:\.(raw|formatted))?$/);
  if (total) { const result = context.grand_totals[total[1]] || { raw: "", formatted: "—" }; return total[2] === "raw" ? result.raw : result.formatted; }
  const rowTotal = cleaned.match(/^row_total\.`?([^`.]+)`?(?:\.(raw|formatted))?$/);
  if (rowTotal && scope) { const result = scope.row_total[rowTotal[1]] || { raw: "", formatted: "—" }; return rowTotal[2] === "raw" ? result.raw : result.formatted; }
  return "—";
};
const interpolate = (text: string, scope: MarkdownRow | undefined, context: MarkdownContext, index?: number) => text.replace(/{{\s*([^}]+)\s*}}/g, (_, expression) => expression.trim() === "rows.index" && index !== undefined ? String(index) : String(resolve(expression, scope, context) ?? "—"));
const scopeCss = (css: string, namespace: string) => css.replace(/(^|})\s*([^@{}][^{]*)\{/g, (_, prefix, selector) => `${prefix}\n${selector.split(",").map((item: string) => `.${namespace} ${item.trim()}`).join(", ")} {`).replace(/@import[^;]+;/gi, "").replace(/url\s*\([^)]*\)/gi, "none");
const markdownToHtml = (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkMath).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeKatex).use(rehypeStringify);
  return String(processor.processSync(markdown));
};
const normalizeTemplate = (template: string) => {
  const trimmed = template.trim();
  const outer = trimmed.match(/^```(?:html|markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  const source = outer ? outer[1].trim() : template;
  if (!/<(?:style|div|span|section|h-drill|table|ul|ol)\b/i.test(source)) return source;
  return source.split("\n")
    .filter((line) => !/^\s*```(?:html|xml|markdown|md)?\s*$/i.test(line))
    .map((line) => /^\s*<\/?[a-z][^>]*>/i.test(line) ? line.trimStart() : line)
    .join("\n");
};
const expandTemplate = (template: string, context: MarkdownContext, options: { allowHtml: boolean; allowCss: boolean; namespace: string }) => {
  let css = "";
  let source = normalizeTemplate(template).replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, value) => { css += String(value); return ""; });
  let output = source.replace(/{%\s*map\((rows|columns|values)\)\s*%}([\s\S]*?){%\s*end\s*%}/g, (_, collection, body) => {
    const values = collection === "rows" ? context.rows : collection === "columns" ? context.columns : context.values;
    return (values as unknown[]).map((item, index) => collection === "rows" ? interpolate(body, item as MarkdownRow, context, index) : interpolate(body, undefined, { ...context, rows: [{ fields: {}, values: { value: item as MarkdownFieldValue, [(item as MarkdownFieldValue).label]: item as MarkdownFieldValue }, row_total: {} }] }, index)).join("");
  });
  output = interpolate(output, undefined, context);
  output = output.replace(/<h-drill\b([^>]*)>([\s\S]*?)<\/h-drill>/gi, (_match, attributes, body) => { const row = String(attributes).match(/\brow\s*=\s*["'](\d+)["']/i)?.[1]; const value = String(attributes).match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1]; return row && value !== undefined ? `<span data-markdown-drill-row="${row}" data-markdown-drill-value="${value.replace(/&quot;/g, "\"")}">${body}</span>` : body; });
  const html = options.allowHtml ? DOMPurify.sanitize(markdownToHtml(output), { ADD_ATTR: ["data-markdown-drill-row", "data-markdown-drill-value"] }) : DOMPurify.sanitize(markdownToHtml(output.replace(/<[^>]+>/g, "")));
  return { html, css: options.allowCss ? scopeCss(css, options.namespace) : "" };
};

export function DynamicMarkdownWidget({ widget, context, fields, editable, onChangeTitle, onChangeConfig, onDrill }: Props) {
  const config = widget.markdownConfig || { sourceWidgetId: null, template: "# Markdown\n\nВыберите табличный источник.", enabled: true, maxRows: 100, allowHtml: true, allowCss: true };
  const namespace = `markdown-widget-${widget.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const rendered = useMemo(() => expandTemplate(config.template, { ...context, rows: context.rows.slice(0, Math.max(1, config.maxRows || 100)) }, { allowHtml: config.allowHtml !== false, allowCss: config.allowCss !== false, namespace }), [config.template, config.maxRows, config.allowHtml, config.allowCss, context, namespace]);
  return <section {...ui(`dashboard.widget.${widget.id}.markdown`)} className={`dynamic-markdown-widget ${namespace}`} aria-label={widget.title} onClick={(event) => { const target = (event.target as HTMLElement).closest<HTMLElement>("[data-markdown-drill-row]"); if (!target || !onDrill) return; const row = context.rows[Number(target.dataset.markdownDrillRow)]; if (row) onDrill(row, target.dataset.markdownDrillValue || ""); }}><header className="text-widget-header"><b>{widget.title}</b>{editable && <button {...ui(`dashboard.widget.${widget.id}.markdown.edit`)} type="button" onClick={() => onChangeTitle(widget.title)} aria-label="Редактировать заголовок">✎</button>}</header>{!config.sourceWidgetId ? <div className="dynamic-markdown-empty">Выберите источник Table или Pivot Table в настройках.</div> : <div {...ui(`dashboard.widget.${widget.id}.markdown.preview`)} className="dynamic-markdown-preview">{rendered.css && <style>{rendered.css}</style>}<div dangerouslySetInnerHTML={{ __html: rendered.html }} /></div>}</section>;
}

export { expandTemplate, normalizeTemplate };
