import "server-only";
import { readPacificaConfig } from "./config";
import { PacificaError } from "./errors";

export type PacificaClient={get<T>(path:string,params?:Record<string,string>):Promise<T>;post<T>(path:string,body:unknown):Promise<T>};
export function createPacificaClient(fetchImpl:typeof fetch=fetch,timeoutMs=7000):PacificaClient {
  const {baseUrl}=readPacificaConfig();
  async function request<T>(path:string,init:RequestInit={},params?:Record<string,string>):Promise<T>{
    const url=new URL(path,baseUrl);if(params)Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
    let response:Response;
    try{response=await fetchImpl(url,{...init,signal:AbortSignal.timeout(timeoutMs),headers:{accept:"application/json",...init.headers}});}
    catch(error){if(error instanceof Error&&error.name==="TimeoutError")throw new PacificaError("timeout","Pacifica testnet request timed out.");throw new PacificaError("network","Pacifica testnet could not be reached.");}
    let body:unknown;try{body=await response.json();}catch{throw new PacificaError("response","Pacifica returned an unreadable response.",response.status);}
    if(!response.ok)throw new PacificaError("http",`Pacifica testnet returned HTTP ${response.status}.`,response.status);
    return body as T;
  }
  return {get:(path,params)=>request(path,{method:"GET"},params),post:(path,body)=>request(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})};
}
