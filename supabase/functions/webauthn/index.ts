// POST /functions/v1/webauthn  { action, response?, device_name? }
// Face ID / empreinte (WebAuthn, clé de l'appareil) pour Dabali.
//   register-options / register-verify : enregistre la clé de ce téléphone et active Face ID sur le compte
//   auth-options / auth-verify         : vérifie Face ID → autorisation de 2 min à usage unique (profiles.biometric_ok_until)
//   disable                            : supprime les clés et désactive (exige une vérification Face ID récente)
// Le visage ne quitte jamais le téléphone : seule la signature de l'appareil est vérifiée ici.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.3.3";
import { adminClient, corsHeaders, fail, json, requestUser } from "../_shared/http.ts";

const ALLOWED_HOSTS = ["dabalix.netlify.app", "localhost"];
const GRANT_SECONDS = 120;

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("METHOD", "POST uniquement", 405);
  const user = await requestUser(req);
  if (!user) return fail("AUTH_REQUIRED", "Connexion requise.", 401);

  // Origine de l'appli (sert d'identifiant du « site » pour la clé : rpID = nom de domaine)
  const origin = req.headers.get("Origin") ?? "";
  let host = "";
  try { host = new URL(origin).hostname; } catch { /* vide */ }
  if (!ALLOWED_HOSTS.includes(host)) return fail("BAD_ORIGIN", "Origine non autorisée.", 403);
  const rpID = host;

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  const db = adminClient();
  const { data: me } = await db.from("profiles").select("id, full_name, short_code, biometric_enabled, is_blocked").eq("id", user.id).single();
  if (!me || me.is_blocked) return fail("FORBIDDEN", "Compte indisponible.", 403);
  const { data: creds } = await db.from("webauthn_credentials").select("*").eq("user_id", user.id);

  const saveChallenge = (challenge: string, kind: string) =>
    db.from("webauthn_challenges").upsert({ user_id: user.id, challenge, kind, created_at: new Date().toISOString() });
  const takeChallenge = async (kind: string) => {
    const { data } = await db.from("webauthn_challenges").select("*").eq("user_id", user.id).maybeSingle();
    await db.from("webauthn_challenges").delete().eq("user_id", user.id);
    if (!data || data.kind !== kind || Date.now() - new Date(data.created_at).getTime() > 5 * 60_000) return null;
    return data.challenge as string;
  };

  try {
    if (action === "register-options") {
      const options = await generateRegistrationOptions({
        rpName: "Dabali", rpID, userName: me.short_code, userDisplayName: me.full_name,
        userID: new TextEncoder().encode(user.id), attestationType: "none",
        excludeCredentials: (creds ?? []).map((c) => ({ id: c.credential_id, transports: c.transports })),
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      });
      await saveChallenge(options.challenge, "register");
      return json({ ok: true, options });
    }

    if (action === "register-verify") {
      const challenge = await takeChallenge("register");
      if (!challenge) return fail("EXPIRED", "Demande expirée, réessayez.");
      const v = await verifyRegistrationResponse({
        response: body.response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return fail("NOT_VERIFIED", "Face ID n'a pas pu être enregistré.");
      const c = v.registrationInfo.credential;
      await db.from("webauthn_credentials").insert({
        user_id: user.id, credential_id: c.id, public_key: b64url(c.publicKey), counter: c.counter,
        transports: c.transports ?? [], device_name: String(body.device_name ?? "").slice(0, 60) || null,
      });
      await db.from("profiles").update({ biometric_enabled: true }).eq("id", user.id);
      await db.rpc("_audit", { p_action: "biometric_enabled", p_target: user.id, p_payload: {}, p_actor: user.id });
      return json({ ok: true });
    }

    if (action === "auth-options") {
      if (!creds?.length) return fail("NO_CREDENTIAL", "Face ID n'est pas activé sur ce compte.");
      const options = await generateAuthenticationOptions({
        rpID, userVerification: "required", allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports })),
      });
      await saveChallenge(options.challenge, "auth");
      return json({ ok: true, options });
    }

    if (action === "auth-verify") {
      const challenge = await takeChallenge("auth");
      if (!challenge) return fail("EXPIRED", "Demande expirée, réessayez.");
      const cred = creds?.find((c) => c.credential_id === body.response?.id);
      if (!cred) return fail("NO_CREDENTIAL", "Cet appareil n'est pas enregistré pour Face ID.");
      const v = await verifyAuthenticationResponse({
        response: body.response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: cred.credential_id, publicKey: fromB64url(cred.public_key), counter: Number(cred.counter), transports: cred.transports },
      });
      if (!v.verified) return fail("NOT_VERIFIED", "Face ID non reconnu.");
      await db.from("webauthn_credentials").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", cred.id);
      await db.from("profiles").update({ biometric_ok_until: new Date(Date.now() + GRANT_SECONDS * 1000).toISOString() }).eq("id", user.id);
      return json({ ok: true, valid_seconds: GRANT_SECONDS });
    }

    if (action === "disable") {
      // Il faut avoir confirmé Face ID juste avant (autorisation consommée ici)
      const { data: p } = await db.from("profiles").select("biometric_ok_until").eq("id", user.id).single();
      if (me.biometric_enabled && !(p?.biometric_ok_until && new Date(p.biometric_ok_until).getTime() > Date.now())) {
        return fail("BIOMETRIC_REQUIRED", "Confirmez avec Face ID pour le désactiver.");
      }
      await db.from("webauthn_credentials").delete().eq("user_id", user.id);
      await db.from("profiles").update({ biometric_enabled: false, biometric_ok_until: null }).eq("id", user.id);
      return json({ ok: true });
    }

    return fail("BAD_ACTION", "Action inconnue.");
  } catch (e) {
    return fail("WEBAUTHN_ERROR", e instanceof Error ? e.message : "Erreur Face ID.");
  }
});
