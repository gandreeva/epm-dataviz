import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, ChevronDown } from "lucide-react";

export type BuilderSelectorOption = { id: string; label: string; meta?: string; count?: string; marker?: "transaction" | "reference" };

export function BuilderSelector({
  uiId,
  label,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
  portalMenu = false,
  onOpenDetail,
  detailUiId,
  detailLabel = "Открыть детали",
}: {
  uiId: string;
  label: string;
  value: string;
  options: BuilderSelectorOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  portalMenu?: boolean;
  onOpenDetail?: () => void;
  detailUiId?: string;
  detailLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 180 });
  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 180), gap = 4;
    const below = window.innerHeight - rect.bottom, above = rect.top;
    const top = below >= 220 || below >= above ? rect.bottom + gap : Math.max(8, rect.top - 220 - gap);
    const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8));
    setMenuPosition({ top, left, width });
  };
  useEffect(() => {
    if (!open) return;
    if (portalMenu) updateMenuPosition();
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    const reposition = () => portalMenu && updateMenuPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open, portalMenu]);
  const selected = options.find((option) => option.id === value) || options[0];
  return <div ref={rootRef} className={`catalog-source-picker builder-selector ${className}`.trim()}>
    <span className="catalog-source-caption">{label}</span>
    <div className="catalog-source-control"><button ref={triggerRef} type="button" data-ui-id={uiId} className="catalog-source-trigger" title={selected?.label || value} aria-expanded={open} aria-haspopup="listbox" aria-label={ariaLabel} disabled={disabled} onClick={() => { if (portalMenu) updateMenuPosition(); setOpen((current) => !current); }}>
      <span>{selected?.marker && <i className={`builder-selector-marker ${selected.marker}`} aria-hidden="true"/>}<b>{selected?.label || value}</b>{selected?.meta && <small>{selected.meta}</small>}</span><ChevronDown />
    </button>{onOpenDetail && value && <button type="button" data-ui-id={detailUiId || `${uiId}.detail`} className="catalog-source-detail-action" aria-label={detailLabel} title={detailLabel} onClick={onOpenDetail}><ArrowUpRight aria-hidden="true" /></button>}</div>
    {open && (portalMenu ? createPortal(<div ref={menuRef} className={`catalog-source-menu catalog-source-menu-portal ${className}`.trim()} role="listbox" aria-label={ariaLabel} style={{ top: menuPosition.top, left: menuPosition.left, minWidth: menuPosition.width }}>{options.map((option) => <button type="button" role="option" data-ui-id={`${uiId}.${option.id || "empty"}`} aria-selected={option.id === value} className={option.id === value ? "active" : ""} key={option.id || "empty"} onClick={() => { onChange(option.id); setOpen(false); }}><span>{option.marker && <i className={`builder-selector-marker ${option.marker}`} aria-hidden="true"/>}<b>{option.label}</b>{option.meta && <small>{option.meta}</small>}</span>{option.count && <em>{option.count}</em>}</button>)}</div>, document.body) : <div className="catalog-source-menu" role="listbox" aria-label={ariaLabel}>{options.map((option) => <button type="button" role="option" data-ui-id={`${uiId}.${option.id || "empty"}`} aria-selected={option.id === value} className={option.id === value ? "active" : ""} key={option.id || "empty"} onClick={() => { onChange(option.id); setOpen(false); }}><span>{option.marker && <i className={`builder-selector-marker ${option.marker}`} aria-hidden="true"/>}<b>{option.label}</b>{option.meta && <small>{option.meta}</small>}</span>{option.count && <em>{option.count}</em>}</button>)}</div>)}
  </div>;
}
