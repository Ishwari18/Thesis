export type OrderRequest = { symbol:string; side:"buy"|"sell"; quantity:string; reduceOnly?:boolean };
export interface ExecutionProvider { submitOrder(order:OrderRequest): Promise<{status:"accepted"|"rejected"; externalId?:string}> }
