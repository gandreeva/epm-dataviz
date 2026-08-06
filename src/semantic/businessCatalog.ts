import{parse}from'yaml';
import rawCatalog from'../../config/business_catalog.yaml?raw';
import type{Aggregation,DatasetId,DatasetPresentation,EventProjectionConfig,FieldCatalogMeta,FieldKind,TimeHierarchyDefinition,Unit}from'../types';

type AnyMap=Record<string,any>;
const catalog=parse(rawCatalog)as AnyMap;
export const semanticDiagnostics:string[]=[];
const fieldValue=(value:any)=>typeof value==='string'?value:value?.field;
const defaults=(kind:FieldKind)=>catalog.frontend_catalog?.defaults?.[kind]||{};
const metadata=(kind:FieldKind,role:string,value:any,businessObject:string):FieldCatalogMeta=>{const source=value&&typeof value==='object'?value:{};const base=defaults(kind);const dataType=source.data_type||base.data_type||(kind==='measure'?'number':'string');const members=source.members?Object.fromEntries(Object.entries(source.members).map(([key,item])=>{const member=item as AnyMap;return[key,{label:member.title||key,timeRole:member.time_role}]})):undefined;const hierarchies=Array.isArray(source.hierarchies)?source.hierarchies.map((item:AnyMap):TimeHierarchyDefinition=>({hierarchyId:item.id, hierarchyName:item.name||String(item.id), displayLabel:item.label||item.name||String(item.id), defaultLevelKey:item.default_level||null, leafLevelKey:item.leaf_level||item.levels?.at(-1)?.key||'DAY', supportsDrill:item.supports_drill!==false, levels:(item.levels||[]).map((level:AnyMap,index:number)=>({levelKey:level.key,levelLabel:level.label||level.key,depth:level.depth??index,parentLevelKey:level.parent||null,childLevelKey:level.child||null,ordinal:level.ordinal??index}))})):undefined;return{kind,label:source.title||role,unit:(source.unit||base.unit||(dataType==='date'?'date':'text'))as Unit,aggregations:kind==='measure'?(source.aggregations||base.aggregations)as Aggregation[]:undefined,semantic:{businessObject,role,dataType,granularity:source.granularity,inputFormats:source.input_formats,outputFormat:source.output_format,referenceId:source.reference,members,hierarchies}}};

export const catalogGroups:{dimension:string;measure:string}={dimension:catalog.frontend_catalog?.groups?.dimension||'Dimensions',measure:catalog.frontend_catalog?.groups?.measure||'Measures'};
export function datasetPresentation(datasetId:DatasetId):DatasetPresentation{const binding=catalog.frontend_datasets?.[datasetId]||{};return{label:binding.title||datasetId,description:binding.description||'',badge:binding.badge}}
export function datasetSemanticMeta(datasetId:DatasetId){const binding=catalog.frontend_datasets?.[datasetId]||{},object=catalog.business_objects?.[binding.business_object]||{},source=object[object.default_source||'epm']||object.epm||{};return{...datasetPresentation(datasetId),datasetId,businessObject:binding.business_object,cube:source.cube} }
export type ReferenceDefinition={id:string;title:string;source?:string;key:string;fields?:Record<string,{column:string;title?:string}>};
export function referenceMeta(referenceId:string):ReferenceDefinition|undefined{const item=catalog.references?.[referenceId];if(!item)return undefined;return{id:referenceId,title:item.title||referenceId,source:item.source,key:item.key,fields:item.fields};}
export function eventProjection(datasetId:DatasetId):EventProjectionConfig|undefined{const source=catalog.frontend_datasets?.[datasetId]?.event_projection;if(!source)return undefined;return{dateField:source.date_field,partitionBy:source.partition_by||[],commentSource:source.comment_source,categories:Object.entries(source.categories||{}).map(([key,value],order)=>{const item=value as AnyMap;return{key,sourceField:item.source_field,label:item.title||key,color:item.color,unit:item.unit as Unit,rule:item.rule,order}})}}

export function fieldSemantic(datasetId:DatasetId,fieldId:string):FieldCatalogMeta{
 const binding=catalog.frontend_datasets?.[datasetId];
 if(!binding)return{kind:'dimension',label:fieldId,unit:'text',diagnostic:`Dataset ${datasetId} отсутствует в frontend_datasets`};
 const override=binding.field_overrides?.[fieldId];
 if(override)return metadata(override.kind||'dimension',override.semantic_role||fieldId,override,binding.business_object);
 const object=catalog.business_objects?.[binding.business_object];
 if(!object)return{kind:'dimension',label:fieldId,unit:'text',diagnostic:`Business object ${binding.business_object} не найден`};
 const source=object[object.default_source||'epm']||object.epm;
 const alias=binding.field_aliases?.[fieldId]||fieldId;
 for(const[role,value]of Object.entries(source?.dimensions||{}))if(fieldValue(value)===alias)return metadata('dimension',role,value,binding.business_object);
 for(const[role,value]of Object.entries(source?.measures||{}))if(fieldValue(value)===alias)return metadata('measure',role,value,binding.business_object);
 return{kind:'dimension',label:fieldId,unit:'text',diagnostic:`Поле ${fieldId} не описано в ${binding.business_object}`};
}

export function validateSemanticCatalog():string[]{const issues:string[]=[];const units=new Set(['currency','percent','count','date','text','ratio']);for(const[id,binding]of Object.entries(catalog.frontend_datasets||{})){const item=binding as AnyMap;if(!catalog.business_objects?.[item.business_object])issues.push(`${id}: unknown business object`);if(!item.title)issues.push(`${id}: missing title`);if(!item.description)issues.push(`${id}: missing description`);const projection=item.event_projection;if(projection){if(!projection.date_field)issues.push(`${id}: missing event date_field`);if(!projection.comment_source)issues.push(`${id}: missing event comment_source`);for(const[key,value]of Object.entries(projection.categories||{})){const event=value as AnyMap;if(!event.source_field||!event.title||!event.color)issues.push(`${id}.${key}: incomplete event category`);if(!['nonzero','change'].includes(event.rule))issues.push(`${id}.${key}: invalid event rule`)}}}for(const[name,object]of Object.entries(catalog.business_objects||{})){const item=object as AnyMap;const source=item[item.default_source||'epm']||item.epm;for(const group of['dimensions','measures'])for(const[role,value]of Object.entries(source?.[group]||{})){if(typeof value==='string')continue;const meta=value as AnyMap;if(!meta.title)issues.push(`${name}.${role}: missing title`);const unit=meta.unit||defaults(group==='measures'?'measure':'dimension').unit;if(!units.has(unit))issues.push(`${name}.${role}: invalid unit ${unit}`)}}return issues}
