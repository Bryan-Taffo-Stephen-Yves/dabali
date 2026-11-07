// Jetons QR signés — HMAC-SHA256 (Web Crypto, compatible Deno et Node ≥ 20).
// Format : DB1.<ticket_id 16 octets b64url>.<nonce 16 octets b64url>.<signature 32 octets b64url>
// Le secret (QR_HMAC_SECRET) n'existe que côté serveur. Un QR fabriqué ou modifié est rejeté.

const PREFIX = "DB1";
const enc = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("uuid invalide");
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("nonce invalide");
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("QR_HMAC_SECRET manquant ou trop court (≥ 32 caractères)");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const payload = (id: string, nonce: string) => enc.encode(`${PREFIX}.${id}.${nonce}`);

/** Signe un ticket. `nonce` = tickets.qr_nonce (32 caractères hexadécimaux). */
export async function signTicketToken(ticketId: string, nonce: string, secret: string): Promise<string> {
  const id = toB64url(uuidToBytes(ticketId));
  const n = toB64url(hexToBytes(nonce));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), payload(id, n)));
  return `${PREFIX}.${id}.${n}.${toB64url(sig)}`;
}

/** Vérifie la signature (comparaison à temps constant). Renvoie null si le jeton est invalide. */
export async function verifyTicketToken(
  token: string,
  secret: string,
): Promise<{ ticketId: string; nonce: string } | null> {
  const parts = (token ?? "").trim().split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const [, id, n, s] = parts;
  const idBytes = fromB64url(id), nBytes = fromB64url(n), sig = fromB64url(s);
  if (!idBytes || idBytes.length !== 16 || !nBytes || nBytes.length !== 16 || !sig || sig.length !== 32) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, payload(id, n));
  return ok ? { ticketId: bytesToUuid(idBytes), nonce: bytesToHex(nBytes) } : null;
}
