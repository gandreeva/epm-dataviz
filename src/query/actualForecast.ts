import type{ChartModel,ChartPoint,ChartSeries,Dataset,SeriesTimeRole,ResolvedActualForecast,ActualForecastSettings}from'../types';
import { eventTimestamp } from '../events/eventAdapter';

export interface TemporalRenderLine{key:string;series:ChartSeries;role:SeriesTimeRole;legend:boolean}
export interface TemporalRenderModel{data:ChartPoint[];lines:TemporalRenderLine[]}
export interface ActualForecastBands{actualEnd:number;forecastStart:number;inside:boolean;showActual:boolean;showForecast:boolean}
export interface ActualForecastZoneShares{actual:number;forecast:number}

const roleForMember = (dataset: Dataset, series: ChartSeries): SeriesTimeRole | undefined => {
 const path=series.columnPath?.[0]; if(!path)return series.timeRole;
 return series.timeRole || dataset.fields.find(field=>field.id===path.dimensionKey)?.semantic?.members?.[String(path.value)]?.timeRole;
};

/** Resolves split metadata for both legacy and DuckDB-produced chart models. */
export function resolveActualForecast(dataset: Dataset, config: {actualForecast?: ActualForecastSettings; chartType?: string}, model: ChartModel, splitDate?: string): ResolvedActualForecast | undefined {
 const settings=config.actualForecast; if(!settings?.enabled || !model.data.length || !model.series.length)return undefined;
 const timestamps=model.data.map(point=>point.timestamp).filter((value): value is number=>typeof value==='number'&&Number.isFinite(value));
 if(!timestamps.length)return undefined;
 let boundary=splitDate?eventTimestamp(splitDate,'day'):null;
 const contexts: Record<string,Record<string,{timeRole:SeriesTimeRole;statusValues:string[];scenarioValues:string[];versionValues:string[];conflict?:boolean}>>={};
 for(const point of model.data){ contexts[point.categoryKey]={}; for(const series of model.series){
  let role: SeriesTimeRole|undefined=roleForMember(dataset,series);
  if(settings.splitMode==='date' && boundary!=null) role=typeof point.timestamp==='number'&&point.timestamp>=boundary?'forecast':'actual';
  if(!role && settings.splitMode==='field') role='unknown';
  contexts[point.categoryKey][series.dataKey]={timeRole:role||'unknown',statusValues:[],scenarioValues:[],versionValues:[]};
 }}
 if(settings.splitMode==='series'){
  const actualTimes=model.data.filter(point=>model.series.some(series=>contexts[point.categoryKey]?.[series.dataKey]?.timeRole==='actual'&&point[series.dataKey]!=null)).map(point=>point.timestamp).filter((value):value is number=>typeof value==='number');
  boundary=actualTimes.length?Math.max(...actualTimes)+1:Math.min(...timestamps);
 }
 if(boundary==null)return undefined;
 return {enabled:true,splitTimestamp:boundary,splitDate:splitDate||'',settings,contexts};
}

const segmentKey=(dataKey:string,role:SeriesTimeRole)=>`${dataKey}__${role}`;

export function resolveActualForecastBands(domain:[number,number],boundary:number):ActualForecastBands{
 const[start,end]=domain;
 return{actualEnd:Math.min(end,boundary),forecastStart:Math.max(start,boundary),inside:boundary>start&&boundary<end,showActual:boundary>start,showForecast:boundary<end};
}

export function resolveActualForecastZoneShares(domain:[number,number],boundary:number):ActualForecastZoneShares{
 const[start,end]=domain,span=end-start;
 if(span<=0)return{actual:boundary>start?1:0,forecast:boundary>start?0:1};
 const actual=Math.min(1,Math.max(0,(boundary-start)/span));
 return{actual,forecast:1-actual};
}

export function buildTemporalRenderModel(model:ChartModel,series:ChartSeries[]):TemporalRenderModel{
 if(!model.actualForecast)return{data:model.data,lines:series.map(item=>({key:item.dataKey,series:item,role:'unknown',legend:true}))};
 const data=model.data.map(point=>({...point})),lines:TemporalRenderLine[]=[];
 for(const item of series){const roles=[...new Set(model.data.map(point=>model.actualForecast?.contexts[point.categoryKey]?.[item.dataKey]?.timeRole||item.timeRole||'unknown'))];roles.forEach((role,index)=>lines.push({key:segmentKey(item.dataKey,role),series:item,role,legend:index===0}));for(const point of data){const role=model.actualForecast.contexts[point.categoryKey]?.[item.dataKey]?.timeRole||item.timeRole||'unknown';point[segmentKey(item.dataKey,role)]=point[item.dataKey] as number|null|undefined}}
 const split=model.actualForecast.splitTimestamp;
 for(const line of lines.filter(item=>item.role==='forecast')){const actualSeries=series.find(item=>item.measureKey===line.series.measureKey&&(item.timeRole==='actual'||model.data.some(point=>model.actualForecast?.contexts[point.categoryKey]?.[item.dataKey]?.timeRole==='actual')));if(!actualSeries)continue;const bridge=[...model.data].filter(point=>typeof point.timestamp==='number'&&point.timestamp<split&&model.actualForecast?.contexts[point.categoryKey]?.[actualSeries.dataKey]?.timeRole==='actual'&&point[actualSeries.dataKey]!=null).at(-1);if(!bridge)continue;const target=data.find(point=>point.categoryKey===bridge.categoryKey);if(target)target[line.key]=bridge[actualSeries.dataKey] as number|null|undefined}
 return{data,lines};
}
