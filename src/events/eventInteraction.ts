import type{ChartPoint}from'../types';
import{timePosition,type EventCategoryRow,type EventCluster}from'./eventLayout';

const clamp=(value:number,minimum:number,maximum:number)=>Math.min(Math.max(value,minimum),maximum);

export const timestampAtX=(pointerX:number,leftInset:number,usableWidth:number,domain:[number,number])=>{
 if(usableWidth<=0||domain[0]===domain[1])return domain[0];
 const ratio=clamp((pointerX-leftInset)/usableWidth,0,1);
 return domain[0]+ratio*(domain[1]-domain[0]);
};

export const nearestTimePoint=(points:ChartPoint[],timestamp:number)=>points.reduce<ChartPoint|undefined>((nearest,point)=>{
 if(typeof point.timestamp!=='number')return nearest;
 if(!nearest||typeof nearest.timestamp!=='number')return point;
 const distance=Math.abs(point.timestamp-timestamp),nearestDistance=Math.abs(nearest.timestamp-timestamp);
 return distance<nearestDistance||distance===nearestDistance&&point.timestamp<nearest.timestamp?point:nearest;
},undefined);

export const clustersAtX=(rows:EventCategoryRow[],pointerX:number,leftInset:number,usableWidth:number,domain:[number,number],tolerance=7):EventCluster[]=>rows.flatMap(row=>row.clusters.filter(cluster=>Math.abs(leftInset+timePosition(cluster.timestamp,domain)*usableWidth-pointerX)<=tolerance));
