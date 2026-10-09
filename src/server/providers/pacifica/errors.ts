import "server-only";
export type PacificaErrorCode="configuration"|"network"|"timeout"|"http"|"response"|"execution_disabled"|"unauthorized";
export class PacificaError extends Error { constructor(public readonly code:PacificaErrorCode,message:string,public readonly status?:number){super(message);this.name="PacificaError";} }
export function safePacificaMessage(error:unknown) { if(error instanceof PacificaError)return error.message;return "Pacifica testnet request failed. Check connectivity and try again."; }
