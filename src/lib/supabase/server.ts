import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => cookieStore.getAll(), setAll(cookiesToSet: {name:string;value:string;options:CookieOptions}[]) { try { cookiesToSet.forEach(({name,value,options})=>cookieStore.set(name,value,options)); } catch {} } } });
}
