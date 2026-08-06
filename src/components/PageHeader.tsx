import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Pencil, X } from "lucide-react";
import type { BuilderPage, PageHeaderConfig } from "../types";
import { UI_IDS, ui } from "../uiIds";

type Props = {
  page: BuilderPage;
  chartTitle: string;
  chartHint: string;
  datasetLabel: string;
  editable: boolean;
  onChange: (header: PageHeaderConfig) => void;
};

const DEFAULT_COLOR = "#1f2933";
const DEFAULT_BACKGROUND = "transparent";
const fallbackMarkdown = (chartTitle: string, chartHint: string, datasetLabel: string) =>
  `КРЕДИТНЫЙ LIFECYCLE · FRONT-ONLY DEMO\n\n# ${chartTitle}\n\n${chartHint}. Источник: ${datasetLabel}`;

export function PageHeader({ page, chartTitle, chartHint, datasetLabel, editable, onChange }: Props) {
  const savedMarkdown = page.header?.markdown || "";
  const savedColor = page.header?.color || DEFAULT_COLOR;
  const savedBackground = page.header?.backgroundColor || DEFAULT_BACKGROUND;
  const defaultMarkdown = fallbackMarkdown(chartTitle, chartHint, datasetLabel);
  const [editing, setEditing] = useState(false);
  const [draftMarkdown, setDraftMarkdown] = useState(savedMarkdown || defaultMarkdown);
  const [draftColor, setDraftColor] = useState(savedColor);
  const [draftBackground, setDraftBackground] = useState(savedBackground === "transparent" ? "#ffffff" : savedBackground);
  const [draftTransparent, setDraftTransparent] = useState(savedBackground === "transparent");
  const markdownRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) {
      setDraftMarkdown(savedMarkdown || defaultMarkdown);
      setDraftColor(savedColor);
      setDraftBackground(savedBackground === "transparent" ? "#ffffff" : savedBackground);
      setDraftTransparent(savedBackground === "transparent");
    }
  }, [defaultMarkdown, editing, savedBackground, savedColor, savedMarkdown]);

  useEffect(() => {
    if (editing) markdownRef.current?.focus();
  }, [editing]);

  const previewMarkdown = savedMarkdown || defaultMarkdown;
  const startEditing = () => {
    setDraftMarkdown(savedMarkdown || defaultMarkdown);
    setDraftColor(savedColor);
    setDraftBackground(savedBackground === "transparent" ? "#ffffff" : savedBackground);
    setDraftTransparent(savedBackground === "transparent");
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraftMarkdown(savedMarkdown || defaultMarkdown);
    setDraftColor(savedColor);
    setDraftBackground(savedBackground === "transparent" ? "#ffffff" : savedBackground);
    setDraftTransparent(savedBackground === "transparent");
    setEditing(false);
  };
  const applyEditing = () => {
    onChange({
      markdown: draftMarkdown.trim() || defaultMarkdown,
      color: draftColor || DEFAULT_COLOR,
      backgroundColor: draftTransparent ? DEFAULT_BACKGROUND : draftBackground,
    });
    setEditing(false);
  };

  return (
    <div className="builder-canvas-context">
      {editing ? (
        <div className="builder-page-header-editor">
          <textarea
            {...ui(UI_IDS.canvas.headerMarkdown)}
            ref={markdownRef}
            value={draftMarkdown}
            onChange={(event) => setDraftMarkdown(event.target.value)}
            aria-label="Markdown заголовка страницы"
            rows={4}
          />
          <div className="builder-page-header-editor-actions">
            <label className="builder-page-header-color">
              <span>Цвет текста</span>
              <input
                {...ui(UI_IDS.canvas.headerColor)}
                type="color"
                value={draftColor}
                onChange={(event) => setDraftColor(event.target.value)}
                aria-label="Цвет заголовка страницы"
              />
            </label>
            <label className="builder-page-header-color">
              <span>Фон</span>
              <input
                {...ui(UI_IDS.canvas.headerBackground)}
                type="color"
                value={draftBackground}
                disabled={draftTransparent}
                onChange={(event) => setDraftBackground(event.target.value)}
                aria-label="Цвет фона заголовка страницы"
              />
            </label>
            <label className="builder-page-header-transparent">
              <input
                {...ui(UI_IDS.canvas.headerBackgroundTransparent)}
                type="checkbox"
                checked={draftTransparent}
                onChange={(event) => setDraftTransparent(event.target.checked)}
              />
              Прозрачный
            </label>
            <button {...ui(UI_IDS.canvas.headerApply)} type="button" onClick={applyEditing} aria-label="Применить заголовок" title="Применить">
              <Check aria-hidden="true" />
            </button>
            <button {...ui(UI_IDS.canvas.headerCancel)} type="button" onClick={cancelEditing} aria-label="Отменить редактирование заголовка" title="Отменить">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div {...ui(UI_IDS.canvas.headerPreview)} className="builder-page-header-preview" style={{ color: savedColor }}>
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {previewMarkdown}
          </ReactMarkdown>
        </div>
      )}
      {editable && !editing && (
        <button {...ui(UI_IDS.canvas.headerEdit)} type="button" className="builder-page-header-edit" onClick={startEditing} aria-label="Редактировать заголовок страницы" title="Редактировать заголовок">
          <Pencil aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
