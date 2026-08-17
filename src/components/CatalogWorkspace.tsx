import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, CalendarClock, CheckCircle2, ChevronRight, Database, Layers3, Pencil, Save, Search, Sigma, Tag, X } from "lucide-react";
import { parse, stringify } from "yaml";
import rawCatalog from "../../config/business_catalog.yaml?raw";
import { UI_IDS, ui } from "../uiIds";
import { validateSemanticCatalog } from "../semantic/businessCatalog";

type AnyMap = Record<string, any>;
type CatalogKind = "dataset" | "reference" | "semantic";
type CatalogDoc = { revision: string; yaml: string; catalog: AnyMap; diagnostics: string[] };
export type CatalogEntityRef = { kind: CatalogKind; id: string };

const readLocalDocument = (): CatalogDoc => {
  const yaml = rawCatalog;
  const catalog = parse(yaml) as AnyMap;
  return { revision: "local", yaml, catalog, diagnostics: validateSemanticCatalog() };
};

async function loadDocument(): Promise<CatalogDoc> {
  try {
    const response = await fetch("/api/business-catalog", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as CatalogDoc;
  } catch {
    return readLocalDocument();
  }
}

function entityKey(kind: CatalogKind, id: string) { return `${kind}:${id}`; }

export function CatalogWorkspace({ initialEntity }: { initialEntity?: CatalogEntityRef | null } = {}) {
  const [document, setDocument] = useState<CatalogDoc>(() => readLocalDocument());
  const [draft, setDraft] = useState<AnyMap>(() => readLocalDocument().catalog);
  const [selected, setSelected] = useState<{ kind: CatalogKind; id: string } | null>(null);
  const [catalogView, setCatalogView] = useState<"list" | "detail">("list");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | CatalogKind>("all");
  const [tab, setTab] = useState<"overview" | "fields" | "source" | "semantic">("overview");
  const [editing, setEditing] = useState(false);
  const editable = true;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);

  useEffect(() => { void loadDocument().then((next) => { setDocument(next); setDraft(next.catalog); setDiagnostics(next.diagnostics); }); }, []);
  useEffect(() => {
    if (!initialEntity) return;
    setSelected(initialEntity);
    setSelectedFieldId(null);
    setTab(initialEntity.kind === "semantic" ? "semantic" : "overview");
    setCatalogView("detail");
  }, [initialEntity?.kind, initialEntity?.id]);
  useEffect(() => {
    const handleFieldEditClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-ui-id^="catalog.fields.edit."]') : null;
      if (target && editable) setEditing(true);
    };
    globalThis.document.addEventListener("click", handleFieldEditClick);
    return () => globalThis.document.removeEventListener("click", handleFieldEditClick);
  }, [editable]);
  useEffect(() => {
    const openRow = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !editable) return;
      const row = target.closest(".catalog-field-row");
      if (!row) return;
      const trigger = row.querySelector<HTMLElement>('[data-ui-id^="catalog.fields.edit."]');
      if (trigger && target !== trigger && !trigger.contains(target as Node)) {
        trigger.click();
      }
    };
    const onClick = (event: MouseEvent) => openRow(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".catalog-field-row") && !target.closest("input,select,textarea,button")) {
        event.preventDefault();
        openRow(target);
      }
    };
    globalThis.document.querySelectorAll<HTMLElement>(".catalog-field-row").forEach((row) => {
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", editable ? "0" : "-1");
    });
    globalThis.document.addEventListener("click", onClick);
    globalThis.document.addEventListener("keydown", onKeyDown);
    return () => { globalThis.document.removeEventListener("click", onClick); globalThis.document.removeEventListener("keydown", onKeyDown); };
  }, [editable, tab, selected?.id]);

  const entities = useMemo(() => {
    const datasets = Object.entries(draft.datasets || {}).map(([id, item]) => ({ id, kind: "dataset" as const, item: item as AnyMap }));
    const references = Object.entries(draft.references || {}).map(([id, item]) => ({ id, kind: "reference" as const, item: item as AnyMap }));
    const semantic = { id: "semantic", kind: "semantic" as const, item: { title: "Общая семантика", description: "Defaults и временные иерархии каталога", semantic: true } as AnyMap };
    return [...datasets, ...references, ...(kindFilter === "all" || kindFilter === "semantic" ? [semantic] : [])].filter((entity) => {
      if (kindFilter !== "all" && entity.kind !== kindFilter) return false;
      const haystack = [entity.id, entity.item.title, entity.item.description, entity.item.business_object, entity.item.cube, entity.item.source?.url, entity.item.source].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query.toLowerCase());
    });
  }, [draft, kindFilter, query]);

  const selectedEntity: AnyMap | undefined = selected?.kind === "semantic"
    ? { title: "Общая семантика", description: "Defaults и временные иерархии каталога", semantic: true } as AnyMap
    : selected ? (draft[selected.kind === "dataset" ? "datasets" : "references"] || {})[selected.id] as AnyMap | undefined : undefined;
  const fields = selected?.kind === "dataset" ? Object.entries(selectedEntity?.fields || {}) : [];
  const sourceEntries: AnyMap[] = selectedEntity?.type === "composed"
    ? (selectedEntity.sources || []).map((source: AnyMap) => ({
        id: source.dataset,
        title: draft.datasets?.[source.dataset]?.title || source.dataset,
        mappings: Object.fromEntries(Object.entries(source.mappings || {}).map(([physical, target]) => [target, physical])),
      }))
    : [];
  const referenceEntries = fields
    .filter(([, raw]) => Boolean((raw as AnyMap).reference))
    .map(([fieldId, raw]) => ({ fieldId, reference: (raw as AnyMap).reference }));
  const selectedField = selectedFieldId && selected?.kind === "dataset" ? (selectedEntity?.fields || {})[selectedFieldId] as AnyMap | undefined : undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(document.catalog);

  const updateSelected = (patch: AnyMap) => {
    if (!selected) return;
    const section = selected.kind === "dataset" ? "datasets" : "references";
    setDraft((current) => ({ ...current, [section]: { ...(current[section] || {}), [selected.id]: { ...(current[section]?.[selected.id] || {}), ...patch } } }));
  };

  const updateSelectedField = (patch: AnyMap) => {
    if (!selected || selected.kind !== "dataset" || !selectedFieldId) return;
    const normalizedPatch = "kind" in patch && ["text", "currency", "percent", "count", "ratio", "date"].includes(patch.kind)
      ? { unit: patch.kind }
      : patch;
    setDraft((current) => ({
      ...current,
      datasets: {
        ...(current.datasets || {}),
        [selected.id]: {
          ...(current.datasets?.[selected.id] || {}),
          fields: {
            ...(current.datasets?.[selected.id]?.fields || {}),
            [selectedFieldId]: {
              ...(current.datasets?.[selected.id]?.fields?.[selectedFieldId] || {}),
              ...normalizedPatch,
            },
          },
        },
      },
    }));
  };

  const openEntity = (kind: CatalogKind, id: string) => {
    setSelected({ kind, id });
    setSelectedFieldId(null);
    setTab(kind === "semantic" ? "semantic" : "overview");
    setCatalogView("detail");
  };

  const validateDraft = () => {
    const next = stringify(draft);
    const parsed = parse(next) as AnyMap;
    const issues: string[] = validateSemanticCatalog(parsed);
    if (!parsed.datasets) issues.push("Отсутствует раздел datasets");
    if (!parsed.references) issues.push("Отсутствует раздел references");
    for (const [id, item] of Object.entries(parsed.datasets || {})) {
      if (!(item as AnyMap).title) issues.push(`datasets.${id}: отсутствует title`);
      if ((item as AnyMap).type !== "composed" && !(item as AnyMap).source) issues.push(`datasets.${id}: отсутствует source`);
    }
    setDiagnostics(issues);
    return { yaml: next, issues };
  };

  const save = async () => {
    const validated = validateDraft();
    if (validated.issues.length) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/business-catalog", { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": document.revision }, body: JSON.stringify({ yaml: validated.yaml, revision: document.revision }) });
      if (!response.ok) throw new Error(response.status === 409 ? "Каталог изменён в другом окне. Перезагрузите данные." : `Не удалось сохранить каталог (HTTP ${response.status})`);
      const next = await response.json() as CatalogDoc;
      setDocument(next); setDraft(next.catalog); setDiagnostics(next.diagnostics || []); setEditing(false); setMessage("Каталог сохранён. Обновляем семантический runtime…");
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить каталог"); }
    finally { setSaving(false); }
  };

  return <section {...ui(UI_IDS.catalog.workspace)} className="catalog-workspace">
    <header className="catalog-workspace-header">
      <div><span className="catalog-eyebrow">SEMANTIC CATALOG</span><h1>Бизнес-сущности</h1><p>Кубы, composed datasets и справочники из business_catalog.yaml</p></div>
      <div className="catalog-workspace-actions">
        {dirty && <span className="catalog-dirty">Не сохранено</span>}
        {editable && !editing && <button {...ui(UI_IDS.catalog.edit)} type="button" onClick={() => setEditing(true)}><Pencil />Редактировать</button>}
        {editable && editing && <><button {...ui(UI_IDS.catalog.cancel)} type="button" onClick={() => { setDraft(document.catalog); setDiagnostics(document.diagnostics); setEditing(false); }}><X />Отменить</button><button {...ui(UI_IDS.catalog.save)} className="primary" type="button" disabled={saving || !dirty} onClick={() => void save()}><Save />{saving ? "Сохранение…" : "Сохранить"}</button></>}
      </div>
    </header>
    {message && <div className="catalog-toast" role="status">{message}</div>}
    {diagnostics.length > 0 && <div {...ui(UI_IDS.catalog.validation)} className="catalog-validation" role="alert"><AlertTriangle /><div><b>Найдены проблемы</b>{diagnostics.slice(0, 4).map((item) => <span key={item}>{item}</span>)}</div></div>}
    <div className={`catalog-workspace-body ${catalogView === "detail" ? "is-detail" : ""}`}>
      {catalogView === "list" && <aside className="catalog-entity-list">
        <div className="catalog-search"><Search /><input {...ui(UI_IDS.catalog.searchEntities)} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти сущность" aria-label="Поиск сущности" /></div>
        <div className="catalog-type-filter" role="group" aria-label="Тип сущности"><button {...ui(UI_IDS.catalog.typeFilter)} className={kindFilter === "all" ? "active" : ""} type="button" onClick={() => setKindFilter("all")}>Все</button><button className={kindFilter === "dataset" ? "active" : ""} type="button" onClick={() => setKindFilter("dataset")}>Кубы</button><button className={kindFilter === "reference" ? "active" : ""} type="button" onClick={() => setKindFilter("reference")}>Справочники</button><button {...ui(UI_IDS.catalog.typeFilterSemantic)} className={kindFilter === "semantic" ? "active" : ""} type="button" onClick={() => setKindFilter("semantic")}>Семантика</button></div>
        <div className="catalog-entity-count">{entities.length} сущностей</div>
        <div className="catalog-entity-cards">{entities.map((entity) => {
          const active = selected?.kind === entity.kind && selected.id === entity.id;
          const fieldCount = Object.keys(entity.item.fields || {}).length;
          const source = entity.item.type === "composed" ? `${entity.item.sources?.length || 0} источника` : (entity.item.source?.url || entity.item.source || "Источник не указан");
          return <button {...ui(entity.kind === "semantic" ? UI_IDS.catalog.semanticCard : UI_IDS.catalog.entityCard(entityKey(entity.kind, entity.id)))} key={entityKey(entity.kind, entity.id)} type="button" className={`catalog-entity-card ${active ? "active" : ""}`} onClick={() => openEntity(entity.kind, entity.id)}><span className="catalog-entity-icon">{entity.kind === "semantic" ? <Layers3 /> : entity.kind === "reference" ? <BookOpen /> : entity.item.type === "composed" ? <Layers3 /> : <Database />}</span><span className="catalog-entity-copy"><b>{entity.item.title || entity.id}</b><small>{entity.kind === "semantic" ? "Общие настройки каталога" : entity.kind === "reference" ? "Справочник" : entity.item.cube || entity.item.business_object || "Dataset"}</small><em>{entity.kind === "semantic" ? `${Object.keys(draft.hierarchies || {}).length} иерархии · ${Object.keys(draft.frontend_catalog?.defaults || {}).length} defaults` : fieldCount ? `${fieldCount} полей` : source}</em></span><ChevronRight /></button>;
        })}</div>
      </aside>}
      <main {...ui(UI_IDS.catalog.detail)} className="catalog-detail">
        {catalogView === "detail" && <nav {...ui(UI_IDS.catalog.breadcrumbs)} className="catalog-breadcrumbs" aria-label="Навигация каталога"><button {...ui(UI_IDS.catalog.breadcrumbRoot)} type="button" onClick={() => { setCatalogView("list"); setSelected(null); setSelectedFieldId(null); }}>Конструктор</button><span>/</span><button {...ui(UI_IDS.catalog.breadcrumbCatalog)} type="button" onClick={() => { setCatalogView("list"); setSelected(null); setSelectedFieldId(null); }}>Semantic Catalog</button><span>/</span><b {...ui(UI_IDS.catalog.breadcrumbEntity)}>{selected?.kind === "semantic" ? "Общая семантика" : selectedEntity?.title || selected?.id}</b></nav>}
        {!selectedEntity ? <div className="catalog-empty"><Database /><b>Выберите бизнес-сущность</b><span>Карточка покажет источник, поля и semantic metadata.</span></div> : <>
          <header className="catalog-detail-header"><div><span className="catalog-detail-kind">{selected?.kind === "reference" ? "REFERENCE" : selectedEntity.type === "composed" ? "COMPOSED DATASET" : "DATASET"}</span>{editing ? <input {...ui(UI_IDS.catalog.edit)} className="catalog-title-input" value={selectedEntity.title || ""} onChange={(event) => updateSelected({ title: event.target.value })} /> : <h2>{selectedEntity.title || selected?.id}</h2>}<p>{selected?.id} · {selectedEntity.business_object || selectedEntity.cube || ""}</p></div><span className="catalog-status valid"><CheckCircle2 /> Valid</span></header>
          {selected?.kind !== "semantic" && <nav className="catalog-detail-tabs" aria-label="Детали сущности">{([["overview", "Обзор"], ["fields", `Поля (${fields.length})`], ["source", "Источник"]] as const).map(([id, label]) => <button {...ui(UI_IDS.catalog.detailTab(id))} key={id} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}>{label}</button>)}</nav>}
          {tab === "overview" && <div className="catalog-overview-grid"><article><small>Описание</small>{editing ? <textarea value={selectedEntity.description || ""} onChange={(event) => updateSelected({ description: event.target.value })} /> : <p>{selectedEntity.description || "Описание не задано"}</p>}</article><article><small>Источник данных</small>{selectedEntity.type === "composed" ? sourceEntries.length ? <div className="catalog-lineage-list">{sourceEntries.map((source) => <span key={source.id}><b>{source.title}</b><small>{source.id} · {Object.keys(source.mappings).length} mappings</small></span>)}</div> : <p>Источники не объявлены</p> : <p>{selectedEntity.source?.url || selectedEntity.source || "Не указан"}</p>}{referenceEntries.length > 0 && <div className="catalog-reference-summary"><small>Справочники полей</small>{referenceEntries.map((item) => <span key={item.fieldId}>{item.fieldId} → {item.reference}</span>)}</div>}</article><article><small>Семантические поля</small><strong>{fields.filter(([, item]) => (item as AnyMap).kind === "measure").length} показателей · {fields.filter(([, item]) => (item as AnyMap).kind !== "measure").length} аналитик</strong></article></div>}
          {tab === "fields" && <div className="catalog-fields-layout"><div className="catalog-fields-table"><div className="catalog-fields-head"><span>Поле</span><span>Тип</span><span>Семантика</span><span>Формат</span><span></span></div>{fields.map(([fieldId, raw]) => { const field = raw as AnyMap; const isDate = field.data_type === "date"; const source = sourceEntries.map((entry) => entry.mappings[fieldId] ? `${entry.id}.${entry.mappings[fieldId]}` : "").filter(Boolean).join(", "); return <div {...ui(UI_IDS.catalog.fieldRow(selected?.id || "", fieldId))} className={`catalog-field-row ${selectedFieldId === fieldId ? "active" : ""}`} key={fieldId}><span><i>{field.kind === "measure" ? <Sigma /> : isDate ? <CalendarClock /> : <Tag />}</i><b>{field.title || fieldId}</b><small>{field.field || fieldId}</small>{source && <small className="catalog-field-source">Источник: {source}</small>}</span><span>{field.kind === "measure" ? "Показатель" : "Аналитика"}<small>{field.data_type || "string"}</small></span><span>{field.semantic_role || "—"}<small>{field.unit || "text"}{field.granularity ? ` · ${field.granularity}` : ""}</small></span><span>{(field.input_formats || []).join(", ") || field.output_format || "—"}</span><button {...ui(UI_IDS.catalog.fieldEdit(selected?.id || "", fieldId))} type="button" aria-label={`Редактировать поле ${field.title || fieldId}`} title="Редактировать поле" onClick={() => setSelectedFieldId(fieldId)}><Pencil /></button></div>; })}</div>{editing && selectedField && selectedFieldId && <aside {...ui(UI_IDS.catalog.fieldEditor)} className="catalog-field-editor"><header><div><span>FIELD METADATA</span><h3>{selectedField.title || selectedFieldId}</h3></div><button {...ui(UI_IDS.catalog.fieldEditorClose)} type="button" aria-label="Закрыть редактор поля" onClick={() => setSelectedFieldId(null)}><X /></button></header><label>Название<input {...ui(UI_IDS.catalog.fieldEditorTitle)} value={selectedField.title || ""} onChange={(event) => updateSelectedField({ title: event.target.value })} /></label><label>Physical field<input {...ui(UI_IDS.catalog.fieldEditorPhysical)} value={selectedField.field || selectedFieldId} onChange={(event) => updateSelectedField({ field: event.target.value })} /></label><label>Тип поля<select {...ui(UI_IDS.catalog.fieldEditorKind)} value={selectedField.kind || "dimension"} onChange={(event) => updateSelectedField({ kind: event.target.value })}><option value="dimension">Dimension</option><option value="measure">Measure</option><option value="event">Event</option></select></label><label>Data type<select {...ui(UI_IDS.catalog.fieldEditorDataType)} value={selectedField.data_type || "string"} onChange={(event) => updateSelectedField({ data_type: event.target.value })}><option value="string">String</option><option value="number">Number</option><option value="date">Date</option></select></label><label>Semantic role<input {...ui(UI_IDS.catalog.fieldEditorRole)} value={selectedField.semantic_role || ""} onChange={(event) => updateSelectedField({ semantic_role: event.target.value })} /></label><label>Unit<select {...ui(UI_IDS.catalog.fieldEditorUnit)} value={selectedField.unit || "text"} onChange={(event) => updateSelectedField({ kind: event.target.value })}><option value="text">Text</option><option value="currency">Currency</option><option value="percent">Percent</option><option value="count">Count</option><option value="ratio">Ratio</option><option value="date">Date</option></select></label>{selectedField.data_type === "date" && <><label>Granularity<select {...ui(UI_IDS.catalog.fieldEditorGranularity)} value={selectedField.granularity || "day"} onChange={(event) => updateSelectedField({ granularity: event.target.value })}><option value="day">Day</option><option value="month">Month</option></select></label><label>Input formats<input {...ui(UI_IDS.catalog.fieldEditorInputFormats)} value={(selectedField.input_formats || []).join(", ")} onChange={(event) => updateSelectedField({ input_formats: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="YYYYMMDD, YYYYMM" /></label><label>Output format<input {...ui(UI_IDS.catalog.fieldEditorOutputFormat)} value={selectedField.output_format || ""} onChange={(event) => updateSelectedField({ output_format: event.target.value })} placeholder="YYYYMMDD" /></label><label>Temporal key<select {...ui(UI_IDS.catalog.fieldEditorTemporalKey)} value={selectedField.temporal_key || "calendar"} onChange={(event) => updateSelectedField({ temporal_key: event.target.value })}><option value="calendar">Calendar</option><option value="fiscal">Fiscal</option></select></label><label>Hierarchies<select {...ui(UI_IDS.catalog.fieldEditorHierarchies)} multiple value={selectedField.hierarchies || []} onChange={(event) => updateSelectedField({ hierarchies: Array.from(event.target.selectedOptions, (option) => option.value) })}>{Object.entries(draft.hierarchies || {}).map(([id, item]) => <option key={id} value={id}>{(item as AnyMap).label || id}</option>)}</select></label></>}<p className="catalog-field-editor-hint">Изменения применяются в draft. Для записи в YAML используйте «Сохранить» вверху.</p></aside>}</div>}
          {tab === "source" && <div className="catalog-source-panel"><pre>{JSON.stringify(selectedEntity.type === "composed" ? { sources: selectedEntity.sources, fields: selectedEntity.fields } : { source: selectedEntity.source, cube: selectedEntity.cube, business_object: selectedEntity.business_object }, null, 2)}</pre></div>}
          {tab === "semantic" && <div className="catalog-semantic-view"><section className="catalog-semantic-section"><header><h3>Defaults</h3><small>Значения по умолчанию для полей без явной настройки</small></header><div className="catalog-semantic-cards">{Object.entries(draft.frontend_catalog?.defaults || {}).map(([id, item]) => <article key={id}><b>{id === "measure" ? "Показатели" : "Аналитики"}</b><span>Тип: {(item as AnyMap).data_type || "—"}</span><span>Единица: {(item as AnyMap).unit || "—"}</span><span>Агрегации: {((item as AnyMap).aggregations || []).join(", ") || "—"}</span></article>)}</div></section><section className="catalog-semantic-section"><header><h3>Библиотека временных иерархий</h3><small>Общие шаблоны, которые назначаются date-полям</small></header><div className="catalog-hierarchy-cards">{Object.entries(draft.hierarchies || {}).map(([id, raw]) => { const hierarchy = raw as AnyMap; return <article {...ui(UI_IDS.catalog.semanticHierarchy(id))} key={id}><div className="catalog-hierarchy-title"><b>{id}</b><span>{hierarchy.label || hierarchy.name || ""}</span></div><div className="catalog-hierarchy-levels">{(hierarchy.levels || []).map((level: AnyMap, index: number) => <React.Fragment key={level.key}><span>{level.label || level.key}</span>{index < hierarchy.levels.length - 1 && <ChevronRight />}</React.Fragment>)}</div><small>Default: {hierarchy.default_level || "—"} · Leaf: {hierarchy.leaf_level || "—"}</small></article>; })}</div></section><section className="catalog-semantic-section"><header><h3>Иерархии текущей сущности</h3></header><div className="catalog-assigned-hierarchies">{fields.filter(([, raw]) => (raw as AnyMap).hierarchies?.length).map(([fieldId, raw]) => <article key={fieldId}><b>{(raw as AnyMap).title || fieldId}</b><span>{((raw as AnyMap).hierarchies || []).join(", ")}</span></article>)}{!fields.some(([, raw]) => (raw as AnyMap).hierarchies?.length) && <p>У полей этой сущности иерархии не назначены.</p>}</div></section></div>}
        </>}
      </main>
    </div>
  </section>;
}
