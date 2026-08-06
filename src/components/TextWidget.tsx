import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DashboardWidget } from "../types";
import { ui } from "../uiIds";

export const DEFAULT_TEXT_CONTENT = `# Новый комментарий

Добавьте описание, выводы или формулу.

$E = mc^2$`;

type Props = {
  widget: DashboardWidget;
  editable: boolean;
  onChangeTitle: (title: string) => void;
  onChangeContent: (content: string) => void;
};

export function TextWidget({ widget, editable, onChangeTitle, onChangeContent }: Props) {
  const { t } = useTranslation("common");
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(widget.title || t("textWidget.emptyTitle"));
  const titleInputRef = useRef<HTMLInputElement>(null);
  const originalTitleRef = useRef(widget.title || t("textWidget.emptyTitle"));
  const cancelTitleBlurRef = useRef(false);
  const content = widget.textContent || "";
  const editorId = `dashboard.widget.${widget.id}.text`;
  const commitTitle = () => {
    if (cancelTitleBlurRef.current) {
      cancelTitleBlurRef.current = false;
      return;
    }
    const nextTitle = draftTitle.trim() || widget.title || t("textWidget.emptyTitle");
    setDraftTitle(nextTitle);
    onChangeTitle(nextTitle);
  };
  const toggleEditing = () => {
    if (isEditing) {
      commitTitle();
      setIsEditing(false);
      return;
    }
    setDraftTitle(widget.title || t("textWidget.emptyTitle"));
    originalTitleRef.current = widget.title || t("textWidget.emptyTitle");
    setIsEditing(true);
  };
  useEffect(() => {
    if (isEditing) titleInputRef.current?.focus();
  }, [isEditing]);
  useEffect(() => {
    if (!isEditing) setDraftTitle(widget.title || t("textWidget.emptyTitle"));
  }, [isEditing, widget.title, t]);

  return (
    <section {...ui(editorId)} className="text-widget" aria-label={widget.title}>
      <header className="text-widget-header">
        {editable && isEditing ? (
          <input
            {...ui(`${editorId}.title`)}
            ref={titleInputRef}
            className="text-widget-title-editor"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitTitle();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelTitleBlurRef.current = true;
                setDraftTitle(originalTitleRef.current);
                onChangeTitle(originalTitleRef.current);
                titleInputRef.current?.blur();
              }
            }}
            aria-label={t("textWidget.titleLabel")}
          />
        ) : (
          <b>{widget.title || t("textWidget.emptyTitle")}</b>
        )}
        {editable && (
          <button
            {...ui(`${editorId}.edit`)}
            type="button"
            className="text-widget-edit"
            onClick={toggleEditing}
            title={isEditing ? t("textWidget.finishEditing") : t("textWidget.edit")}
            aria-label={isEditing ? t("textWidget.finishEditing") : t("textWidget.edit")}
          >
            {isEditing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
          </button>
        )}
      </header>
      {editable && isEditing ? (
        <textarea
          {...ui(`${editorId}.content`)}
          className="text-widget-editor"
          value={content}
          onChange={(event) => onChangeContent(event.target.value)}
          placeholder={t("textWidget.placeholder")}
          aria-label={t("textWidget.editorLabel")}
        />
      ) : content ? (
        <div {...ui(`${editorId}.preview`)} className="text-widget-preview">
          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="text-widget-empty">{t("textWidget.empty")}</div>
      )}
    </section>
  );
}
