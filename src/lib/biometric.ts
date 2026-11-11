"use client";
// Face ID / empreinte (WebAuthn) : activation, confirmation (vérifiée par le serveur), déverrouillage hors ligne.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { edge, rpc } from "@/lib/supabase/client";

type Res = { ok: true } | { ok: false; message: string; cancelled?: boolean };
const CREDS_KEY = "dabali:bio-creds";

/** Nom affiché selon l'appareil */
export function biometricLabel(): string {
  if (typeof navigator === "undefined") return "Face ID";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  return "l'empreinte";
}

/** L'appareil a-t-il Face ID / une empreinte utilisable par le navigateur ? */
export async function biometricSupported(): Promise<boolean> {
  try {
    return typeof window !== "undefined" && !!window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

const why = (e: unknown): Res => {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return { ok: false, cancelled: true, message: "Confirmation annulée." };
  return { ok: false, message: "Face ID indisponible. Utilisez votre code PIN." };
};

type RegOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
let preparedReg: { options: RegOptions; at: number } | null = null;

/** Prépare l'activation (à appeler à l'ouverture du Profil) */
export async function prepareEnable(): Promise<void> {
  if (!navigator.onLine) return;
  const o = await edge<{ options: RegOptions }>("webauthn", { action: "register-options" });
  if (o.ok) preparedReg = { options: o.options, at: Date.now() };
}

/** Active Face ID sur ce téléphone (enregistre la clé de l'appareil) */
export async function enableBiometric(): Promise<Res> {
  let options = preparedReg && Date.now() - preparedReg.at < 4 * 60_000 ? preparedReg.options : null;
  preparedReg = null;
  if (!options) {
    const o = await edge<{ options: RegOptions }>("webauthn", { action: "register-options" });
    if (!o.ok) return { ok: false, message: o.message };
    options = o.options;
  }
  let response;
  try { response = await startRegistration({ optionsJSON: options }); } catch (e) { void prepareEnable(); return why(e); }
  const v = await edge("webauthn", { action: "register-verify", response, device_name: navigator.platform || "Téléphone" });
  if (!v.ok) return { ok: false, message: v.message };
  try { localStorage.setItem(CREDS_KEY, JSON.stringify([{ id: response.id, transports: response.response.transports ?? [] }])); } catch {}
  return { ok: true };
}

type AuthOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];
let prepared: { options: AuthOptions; at: number } | null = null;

/** À appeler dès l'affichage de l'écran : prépare la demande Face ID (le toucher la lance ensuite sans attendre le réseau) */
export async function prepareBiometric(): Promise<void> {
  if (!navigator.onLine) return;
  const o = await edge<{ options: AuthOptions }>("webauthn", { action: "auth-options" });
  if (o.ok) {
    prepared = { options: o.options, at: Date.now() };
    try { localStorage.setItem(CREDS_KEY, JSON.stringify(o.options.allowCredentials ?? [])); } catch {}
  }
}

/** Confirme une opération : Face ID vérifié par le serveur → autorisation de 2 min à usage unique */
export async function confirmBiometric(): Promise<Res> {
  let options = prepared && Date.now() - prepared.at < 4 * 60_000 ? prepared.options : null;
  prepared = null;
  if (!options) {
    const o = await edge<{ options: AuthOptions }>("webauthn", { action: "auth-options" });
    if (!o.ok) return { ok: false, message: o.message };
    options = o.options;
  }
  let response;
  try { response = await startAuthentication({ optionsJSON: options }); } catch (e) { void prepareBiometric(); return why(e); }
  const v = await edge("webauthn", { action: "auth-verify", response });
  return v.ok ? { ok: true } : { ok: false, message: v.message };
}

/** Code PIN en secours : vaut aussi confirmation pendant 2 min */
export async function confirmWithPin(pin: string): Promise<Res & { code?: string }> {
  const r = await rpc("check_my_pin", { p_pin: pin });
  return r.ok ? { ok: true } : { ok: false, message: r.message, code: r.code };
}

/** Déverrouillage de l'appli : vérifié par le serveur en ligne ; hors ligne, Face ID local (les QR restent accessibles) */
export async function unlockBiometric(): Promise<Res> {
  if (navigator.onLine) return confirmBiometric();
  let allow: { id: string; transports?: string[] }[] = [];
  try { allow = JSON.parse(localStorage.getItem(CREDS_KEY) ?? "[]"); } catch {}
  const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    await startAuthentication({ optionsJSON: { challenge, rpId: location.hostname, userVerification: "required", timeout: 60000,
      allowCredentials: allow.map((c) => ({ id: c.id, type: "public-key", transports: c.transports as AuthenticatorTransport[] })) } as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
    return { ok: true };
  } catch (e) { return why(e); }
}

/** Désactive Face ID (demande d'abord une confirmation Face ID) */
export async function disableBiometric(): Promise<Res> {
  const c = await confirmBiometric();
  if (!c.ok) return c;
  const r = await edge("webauthn", { action: "disable" });
  try { localStorage.removeItem(CREDS_KEY); } catch {}
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
