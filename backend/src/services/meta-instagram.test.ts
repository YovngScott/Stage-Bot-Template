import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { parseInstagramMessages, verifyInstagramChallenge, verifyInstagramSignature } from "./meta-instagram.js";

test("normaliza DMs y excluye los ecos del bot", () => {
  const messages = parseInstagramMessages({ entry: [{ id: "account", messaging: [
    { sender: { id: "person" }, recipient: { id: "account" }, message: { mid: "one", text: "Hola" } },
    { sender: { id: "account" }, recipient: { id: "person" }, message: { mid: "two", is_echo: true, text: "Respuesta" } },
    { sender: { id: "person" }, recipient: { id: "account" }, message: { mid: "one", text: "Duplicado" } },
  ] }] });
  assert.deepEqual(messages, [{ id: "one", senderId: "person", recipientId: "account", text: "Hola", mediaType: "text" }]);
});

test("challenge y firma requieren los secretos correctos", () => {
  process.env.META_INSTAGRAM_VERIFY_TOKEN = "verify";
  process.env.META_INSTAGRAM_APP_SECRET = "app-secret";
  assert.equal(verifyInstagramChallenge("subscribe", "verify", "challenge"), "challenge");
  const raw = Buffer.from("payload");
  const signature = `sha256=${crypto.createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
  assert.equal(verifyInstagramSignature(raw, signature), true);
  assert.equal(verifyInstagramSignature(raw, "sha256=bad"), false);
});
