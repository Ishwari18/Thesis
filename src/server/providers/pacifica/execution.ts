import "server-only";
import type { ExecutionProvider, OrderRequest } from "../execution/types";
import { submitPacificaMarketBatch, submitPacificaMarketOrder } from "./orders";
import { setPacificaLeverage } from "./leverage";
import { getPacificaAccount } from "./account";
import { getPacificaPositions } from "./positions";
import { PacificaError } from "./errors";

export class PacificaExecutionProvider implements ExecutionProvider {
  submitOrder(order:OrderRequest){return submitPacificaMarketOrder(order);}
  submitBatch(orders:OrderRequest[]){return submitPacificaMarketBatch(orders);}
  setLeverage(symbol:string,leverage:number){return setPacificaLeverage(symbol,leverage);}
  getAccount(){return getPacificaAccount();}
  getPositions(){return getPacificaPositions();}
  async closePosition(symbol:string){const positions=await getPacificaPositions();const p=positions.find(position=>position.symbol===symbol);if(!p)throw new PacificaError("response",`No Pacifica testnet position is open for ${symbol}.`);return submitPacificaMarketOrder({symbol,side:p.side==="bid"?"ask":"bid",quantity:p.quantity,reduceOnly:true});}
}
