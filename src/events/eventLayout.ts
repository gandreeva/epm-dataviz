import type{ChartEvent,ChartEventCategory}from'../types';

export interface EventCluster{
 id:string;
 categoryKey:string;
 timestamp:number;
 events:ChartEvent[];
 showLabel:boolean;
}

export interface EventCategoryRow{
 category:ChartEventCategory;
 clusters:EventCluster[];
 eventCount:number;
}

export const timePosition=(timestamp:number,domain:[number,number])=>domain[0]===domain[1]?0.5:(timestamp-domain[0])/(domain[1]-domain[0]);

export function layoutEventRows(
 events:ChartEvent[],
 categories:ChartEventCategory[],
 domain:[number,number]|undefined,
 width=0,
 labelLimit=30,
 minimumLabelGap=120,
):EventCategoryRow[]{
 let labels=0;
 return categories
  .filter(category=>category.visible)
  .sort((a,b)=>a.order-b.order)
  .map(category=>{
   const categoryEvents=events.filter(event=>event.categoryKey===category.key).sort((a,b)=>a.timestamp-b.timestamp||a.id.localeCompare(b.id));
   const exact=new Map<number,ChartEvent[]>();
   for(const event of categoryEvents)exact.set(event.timestamp,[...(exact.get(event.timestamp)||[]),event]);
   let previousLabelX=-Infinity;
   const clusters=[...exact.entries()].map(([timestamp,items])=>{
    const x=domain&&width>0?timePosition(timestamp,domain)*width:0;
    const showLabel=Boolean(domain&&width>0&&labels<labelLimit&&x-previousLabelX>=minimumLabelGap);
    if(showLabel){previousLabelX=x;labels+=1}
    return{id:`${category.key}-${timestamp}`,categoryKey:category.key,timestamp,events:items,showLabel};
   });
   return{category,clusters,eventCount:categoryEvents.length};
  });
}
