import React from "react";
import { Responsive, WidthProvider, type Layout, type LayoutItem } from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { DashboardWidget, ResponsiveLayouts } from "../types";

const ResponsiveGrid = WidthProvider(Responsive);
export const CANVAS_BREAKPOINTS = { lg: 1200, md: 992, sm: 768, xs: 576, xxs: 0 };
export const CANVAS_COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

type Props = {
  widgets: DashboardWidget[];
  layouts: ResponsiveLayouts;
  editMode: boolean;
  activeWidgetId: string | null;
  onActivate: (id: string) => void;
  onLayoutsChange: (layouts: ResponsiveLayouts) => void;
  onRender: (widget: DashboardWidget) => React.ReactNode;
  onAction?: (action: string, widget: DashboardWidget) => void;
};

type Layouts = Partial<Record<string, Layout>>;
const toLayouts = (layouts: ResponsiveLayouts): Layouts => layouts as unknown as Layouts;
const fromLayouts = (layouts: Layouts): ResponsiveLayouts => ({
  lg: [...(layouts.lg || [])], md: [...(layouts.md || [])], sm: [...(layouts.sm || [])], xs: [...(layouts.xs || [])], xxs: [...(layouts.xxs || [])],
});

export function DashboardCanvas({ widgets, layouts, editMode, activeWidgetId, onActivate, onLayoutsChange, onRender, onAction }: Props) {
  return (
    <div className={`dashboard-canvas-shell ${editMode ? "is-editing" : "is-viewing"}`} data-ui-id="dashboard.canvas">
      {editMode && <div className="dashboard-grid-guide" aria-hidden="true" />}
      <ResponsiveGrid
        className="dashboard-grid"
        layouts={toLayouts(layouts)}
        breakpoints={CANVAS_BREAKPOINTS}
        cols={CANVAS_COLS}
        rowHeight={28}
        margin={[12, 12]}
        isDraggable={editMode}
        isResizable={editMode}
        compactType="vertical"
        preventCollision={false}
        allowOverlap={false}
        isBounded
        resizeHandles={["e", "w", "n", "s", "ne", "nw", "se", "sw"]}
        draggableCancel="input,textarea,button,select,.widget-action,.widget-action-bar,.widget-resize-handle"
        onLayoutChange={(_current: Layout, next: Layouts) => onLayoutsChange(fromLayouts(next))}
      >
        {widgets.filter((widget) => widget.visible).map((widget) => {
          const active = widget.id === activeWidgetId;
          return (
            <div key={widget.id} className="dashboard-grid-item" data-ui-id={`dashboard.widget.${widget.id}`}>
              <section
                className={`dashboard-widget-frame ${active ? "is-active" : ""}`}
                tabIndex={0}
                role="group"
                aria-label={widget.title}
                aria-selected={active}
                onClick={() => onActivate(widget.id)}
                onFocus={() => onActivate(widget.id)}
              >
                {active && (
                  <div className="widget-action-bar" data-ui-id={`dashboard.widget.${widget.id}.actions`}>
                    {[
                      ["comment", "Комментарий"], ["fullscreen", "Полный экран"],
                      ["export", "Экспорт"], ["duplicate", "Дублировать"], ["delete", "Удалить"],
                    ].map(([action, label]) => (
                      <button
                        key={action}
                        type="button"
                        className="widget-action"
                        data-ui-id={`dashboard.widget.${widget.id}.action.${action}`}
                        title={label}
                        aria-label={label}
                        onClick={(event) => { event.stopPropagation(); onAction?.(action, widget); }}
                      >{action === "delete" ? "×" : action === "duplicate" ? "+" : action === "fullscreen" ? "□" : action === "export" ? "⇩" : "…"}</button>
                    ))}
                  </div>
                )}
                <div className="dashboard-widget-content">{onRender(widget)}</div>
              </section>
            </div>
          );
        })}
      </ResponsiveGrid>
    </div>
  );
}
