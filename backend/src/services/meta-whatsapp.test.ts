import test from "node:test";
import assert from "node:assert/strict";
import { parseMetaMessages, verifyMetaSignature } from "./meta-whatsapp.js";

function webhook(messages: any[]) {
  return { entry: [{ changes: [{ value: { contacts: [{ wa_id: "18095550000", profile: { name: "Cliente" } }], messages } }] }] };
}
test("normaliza texto, imagen, audio, documento y ubicación", () => {
  const result = parseMetaMessages(webhook([
    { id: "1", from: "18095550000", type: "text", text: { body: "Hola" } },
    { id: "2", from: "18095550000", type: "image", image: { id: "im" } },
    { id: "3", from: "18095550000", type: "audio", audio: { id: "au" } },
    { id: "4", from: "18095550000", type: "document", document: { id: "doc", filename: "x.pdf" } },
    { id: "5", from: "18095550000", type: "location", location: { latitude: 18.4, longitude: -69.9 } },
  ]));
  assert.deepEqual(result.map((x) => x.mediaType), ["text", "image", "audio", "document", "location"]);
  assert.ok(result.every((x) => x.text.length > 0));
});
test("el mismo webhook duplicado solo produce una entrada", () => {
  const result = parseMetaMessages(webhook([
    { id: "same", from: "18095550000", type: "text", text: { body: "Hola" } },
    { id: "same", from: "18095550000", type: "text", text: { body: "Hola" } },
  ]));
  assert.equal(result.length, 1);
});
test("firma inválida nunca pasa", () => {
  process.env.META_WHATSAPP_APP_SECRET = "secret";
  assert.equal(verifyMetaSignature(Buffer.from("payload"), "sha256=00"), false);
});
