export const SMALL_MULTIPLES_SYNC_ID='small-multiples-time-cursor';

export const smallMultiplesSyncEnabled=(value:boolean|undefined,temporal:boolean)=>temporal&&value!==false;

export const toggleSmallMultiplesSync=(value:boolean|undefined)=>value===false;
