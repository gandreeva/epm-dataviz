import type{ChartEvent,ChartEventCategory,DataRow,Dataset,EventComment,EventProjectionCategory,TimeGranularity,FieldSemantic}from'../types';

const KEY_SEPARATOR='\u001f';
const COMMENT_FALLBACK='Комментарий не добавлен';
const text=(value:unknown)=>String(value??'');
const numeric=(value:unknown)=>{const number=Number(value);return Number.isFinite(number)?number:null};
const safeId=(value:string)=>value.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'none';
export const eventKey=(version:string,scenario:string,document:string,date:string,type:string)=>[version,scenario,document,date,type].join(KEY_SEPARATOR);
export const eventTimestamp=(value:unknown,granularity:TimeGranularity='day')=>{const raw=text(value).replace(/-/g,'');const year=Number(raw.slice(0,4)),month=Number(raw.slice(4,6));const day=granularity==='day'?Number(raw.slice(6,8)):1;if(!/^\d{6}(?:\d{2})?$/.test(raw)||!year||month<1||month>12||day<1||day>31)return null;const timestamp=Date.UTC(year,month-1,day);const date=new Date(timestamp);return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?timestamp:null};
export const semanticDateTimestamp=(value:unknown,semantic?:Pick<FieldSemantic,'dataType'|'granularity'|'inputFormats'>)=>{
 if(semantic?.dataType&&semantic.dataType!=="date")return null;
 const raw=text(value).replace(/-/g,'');
 // When a lightweight/test dataset has no catalog metadata, infer the
 // canonical granularity from the value itself.  Six digits are YYYYMM;
 // eight digits are YYYYMMDD.  Catalog metadata still takes precedence.
 const granularity=semantic?.granularity||((semantic?.inputFormats||[]).includes("YYYYMM")||/^\d{6}$/.test(raw)?"month":"day");
 return eventTimestamp(raw,granularity);
};

export interface EventRecord{event:ChartEvent;sourceRow:DataRow}
export interface EventBuildResult{records:EventRecord[];categories:ChartEventCategory[];warnings:string[]}

const commentIndex=(comments:EventComment[],categories:EventProjectionCategory[])=>{const warnings:string[]=[];const index=new Map<string,EventComment>();const allowed=new Set(categories.map(category=>category.key));for(const comment of comments){const key=eventKey(comment.fin_version,comment.fin_scenario,comment.fin_doc_num,comment.event_date,comment.event_type);if(!allowed.has(comment.event_type)){warnings.push(`Неизвестный event_type ${comment.event_type}`);continue}if(eventTimestamp(comment.event_date)===null){warnings.push(`Некорректная дата комментария ${comment.event_date}`);continue}if(index.has(key)){warnings.push(`Дубликат комментария ${comment.fin_doc_num} ${comment.event_date} ${comment.event_type}`);continue}index.set(key,comment)}return{index,warnings}};

export function buildEventRecords(dataset:Dataset):EventBuildResult{const projection=dataset.eventProjection;if(!projection)return{records:[],categories:[],warnings:[]};const comments=commentIndex(dataset.eventComments||[],projection.categories);const records:EventRecord[]=[];const emittedKeys=new Set<string>();const emit=(row:DataRow,category:EventProjectionCategory,value:number)=>{const date=text(row[projection.dateField]);const timestamp=eventTimestamp(date);if(timestamp===null)return;const version=text(row.fin_version),scenario=text(row.fin_scenario),document=text(row.fin_doc_num);const key=eventKey(version,scenario,document,date,category.key);const comment=comments.index.get(key);emittedKeys.add(key);records.push({sourceRow:row,event:{id:[version,scenario,document,date,category.key].map(safeId).join('-'),date,timestamp,title:comment?.event_title||`${category.label} · ${document}`,comment:comment?.event_comment||COMMENT_FALLBACK,categoryKey:category.key,categoryLabel:category.label,color:category.color,unit:category.unit,importance:'medium',relatedValue:value,documentId:document,version,scenario,sourceType:'lifecycle-projection',sourceId:key}})};
 for(const category of projection.categories.filter(item=>item.rule==='nonzero'))for(const row of dataset.rows){const value=numeric(row[category.sourceField]);if(value!==null&&value!==0)emit(row,category,value)}
 for(const category of projection.categories.filter(item=>item.rule==='change')){const partitions=new Map<string,DataRow[]>();for(const row of dataset.rows){const key=projection.partitionBy.map(field=>text(row[field])).join(KEY_SEPARATOR);partitions.set(key,[...(partitions.get(key)||[]),row])}for(const rows of partitions.values()){rows.sort((a,b)=>text(a[projection.dateField]).localeCompare(text(b[projection.dateField])));let previous:number|null=null;for(const row of rows){const value=numeric(row[category.sourceField]);if(value===null)continue;if(previous!==null&&value!==previous)emit(row,category,value);previous=value}}}
 for(const[key,comment]of comments.index)if(!emittedKeys.has(key))comments.warnings.push(`Комментарий без события ${comment.fin_doc_num} ${comment.event_date} ${comment.event_type}`);
 records.sort((a,b)=>a.event.timestamp-b.event.timestamp||a.event.id.localeCompare(b.event.id));return{records,categories:projection.categories.map(category=>({key:category.key,label:category.label,color:category.color,order:category.order,visible:true})),warnings:comments.warnings}}
