// Tests de la signature des QR. Lancer : node --test supabase/tests/qr.test.ts  (Node ≥ 22.18)
import { test } from "node:test";
import assert from "node:assert/strict";
import { signTicketToken, verifyTicketToken } from "../functions/_shared/qr.ts";

const SECRET = "test-secret-0123456789abcdef0123456789";
const ID = "3f2b8c1e-9a4d-4e6f-b1c2-7d8e9f0a1b2c";
const NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("un jeton signé est vérifié et restitue ticket + nonce", async () => {
  const token = await signTicketToken(ID, NONCE, SECRET);
  assert.match(token, /^DB1\.[\w-]{22}\.[\w-]{22}\.[\w-]{43}$/);
  assert.deepEqual(await verifyTicketToken(token, SECRET), { ticketId: ID, nonce: NONCE });
});

test("le jeton ne contient pas l'identifiant en clair", async () => {
  const token = await signTicketToken(ID, NONCE, SECRET);
  assert.ok(!token.includes(ID) && !token.includes(NONCE));
});

test("un QR modifié à la main est refusé (chaque caractère)", async () => {
  const token = await signTicketToken(ID, NONCE, SECRET);
  for (let i = 4; i < token.length; i++) {
    if (token[i] === ".") continue;
    const c = token[i] === "A" ? "B" : "A";
    const forged = token.slice(0, i) + c + token.slice(i + 1);
    assert.equal(await verifyTicketToken(forged, SECRET), null, `position ${i}`);
  }
});

test("un autre ticket ne peut pas réutiliser la signature", async () => {
  const [p, , n, s] = (await signTicketToken(ID, NONCE, SECRET)).split(".");
  const [, otherId] = (await signTicketToken("00000000-0000-0000-0000-000000000001", NONCE, SECRET)).split(".");
  assert.equal(await verifyTicketToken([p, otherId, n, s].join("."), SECRET), null);
});

test("un QR signé avec un autre secret est refusé", async () => {
  const token = await signTicketToken(ID, NONCE, "autre-secret-0123456789abcdef012345678");
  assert.equal(await verifyTicketToken(token, SECRET), null);
});

test("entrées malformées refusées", async () => {
  for (const t of ["", "DB1", "DB1...", "DB2.a.b.c", ID, `DB1.${ID}.${NONCE}.x`, "DB1.!!!.???.***"]) {
    assert.equal(await verifyTicketToken(t, SECRET), null, t);
  }
});

test("secret trop court refusé", async () => {
  await assert.rejects(signTicketToken(ID, NONCE, "court"));
});
