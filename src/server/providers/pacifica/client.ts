import "server-only";
import { readPacificaConfig } from "./config";
import { PacificaError, parsePacificaErrorBody } from "./errors";

export type PacificaClient={get<T>(path:string,params?:Record<string,string>):Promise<T>;post<T>(path:string,body:unknown):Promise<T>};
export function createPacificaClient(fetchImpl:typeof fetch=fetch,timeoutMs=7000):PacificaClient {
  const {baseUrl}=readPacificaConfig();
  async function request<T>(path:string,init:RequestInit={},params?:Record<string,string>):Promise<T>{
    const url=new URL(path,baseUrl);if(params)Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
    let response:Response;
    try{response=await fetchImpl(url,{...init,signal:AbortSignal.timeout(timeoutMs),headers:{accept:"application/json",...init.headers}});}
    catch(error){if(error instanceof Error&&error.name==="TimeoutError")throw new PacificaError("timeout","Pacifica testnet request timed out.");throw new PacificaError("network","Pacifica testnet could not be reached.");}
    const text=await response.text();
    let body:unknown;
    try{body=text?JSON.parse(text):null;}catch{body=undefined;}
    if(!response.ok){
      const diagnostic=parsePacificaErrorBody(body);
      const error=new PacificaError("http",`Pacifica testnet returned HTTP ${response.status}.`,response.status,diagnostic.providerCode,diagnostic.providerMessage,path);
      // Log only the sanitized endpoint, HTTP status, numeric provider code and approved message fields.
      console.warn("[pacifica] HTTP request failed",{endpoint:path,status:response.status,...diagnostic});
      throw error;
    }
    if(body===undefined)throw new PacificaError("response","Pacifica returned an unreadable response.",response.status,undefined,undefined,path);
    return body as T;
  }
  return {get:(path,params)=>request(path,{method:"GET"},params),post:(path,body)=>request(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})};
}
