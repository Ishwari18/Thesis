export type OrderRequest = { symbol:string; side:"bid"|"ask"; quantity:string; reduceOnly?:boolean; slippagePercent?:string; clientOrderId?:string };
export interface ExecutionProvider { submitOrder(order:OrderRequest): Promise<{status:"accepted"|"rejected"; externalId?:string}> }
