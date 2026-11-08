"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

let client: SupabaseClient | undefined;

/** Client navigateur unique (session dans les cookies, partagée avec le middleware). */
export function supabase(): SupabaseClient {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export type RpcResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; code: string; message: string; [k: string]: unknown };

/** Identifiant de l'utilisateur connecté, lu sur le téléphone (marche hors ligne, contrairement à getUser()). */
export async function myId(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

const OFFLINE = "Pas de connexion internet. Vos QR restent disponibles ; réessayez quand le réseau revient.";
export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Appel RPC : renvoie toujours { ok, … } — y compris pour une erreur réseau. */
export async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  if (isOffline()) return { ok: false, code: "OFFLINE", message: OFFLINE };
  try {
    const { data, error } = await supabase().rpc(fn, args);
    if (error) return { ok: false, code: "NETWORK", message: humanError(error.message) };
    return data as RpcResult<T>;
  } catch {
    return { ok: false, code: "NETWORK", message: OFFLINE };
  }
}

/** Appel d'une Edge Function avec le JWT de l'utilisateur. */
export async function edge<T = Record<string, unknown>>(name: string, body: Record<string, unknown>): Promise<RpcResult<T>> {
  if (isOffline()) return { ok: false, code: "OFFLINE", message: OFFLINE };
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (error) {
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) return (await ctx.json()) as RpcResult<T>;
    } catch {}
    return { ok: false, code: "NETWORK", message: "Connexion impossible. Vérifiez votre réseau." };
  }
  return data as RpcResult<T>;
}

function humanError(msg: string) {
  if (/fetch|network/i.test(msg)) return "Connexion impossible. Vérifiez votre réseau.";
  return "Une erreur est survenue. Réessayez.";
}
