import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { instagramMessagesEndpoint, parseInstagramMessages, summarizeInstagramWebhook, verifyInstagramChallenge, verifyInstagramSignature } from "./meta-instagram.js";

test("normaliza DMs y excluye los ecos del bot", () => {
  const messages = parseInstagramMessages({ entry: [{ id: "account", messaging: [
    { sender: { id: "person" }, recipient: { id: "account" }, message: { mid: "one", text: "Hola" } },
    { sender: { id: "account" }, recipient: { id: "person" }, message: { mid: "two", is_echo: true, text: "Respuesta" } },
    { sender: { id: "person" }, recipient: { id: "account" }, message: { mid: "one", text: "Duplicado" } },
  ] }] });
  assert.deepEqual(messages, [{ id: "one", senderId: "person", recipientId: "account", text: "Hola", mediaType: "text" }]);
});

test("normaliza el formato field/value usado por la prueba de Meta", () => {
  const messages = parseInstagramMessages({
    field: "messages",
    value: {
      sender: { id: "12334" },
      recipient: { id: "23245" },
      timestamp: "1527459824",
      message: { mid: "random_mid", text: "random_text" },
    },
  });
  assert.deepEqual(messages, [{ id: "random_mid", senderId: "12334", recipientId: "23245", text: "random_text", mediaType: "text" }]);
});

test("normaliza messages dentro de entry.changes", () => {
  const messages = parseInstagramMessages({
    entry: [{
      id: "account",
      changes: [{
        field: "messages",
        value: { sender: { id: "person" }, message: { mid: "change-one", text: "Hola desde changes" } },
      }],
    }],
  });
  assert.deepEqual(messages, [{ id: "change-one", senderId: "person", recipientId: "account", text: "Hola desde changes", mediaType: "text" }]);
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

test("envía con el Graph de Instagram Login y codifica la ruta", () => {
  assert.equal(
    instagramMessagesEndpoint("stage/account", "v26.0"),
    "https://graph.instagram.com/v26.0/stage%2Faccount/messages",
  );
});

test("el diagnóstico de webhooks no expone contenido ni identificadores", () => {
  const summary = summarizeInstagramWebhook({
    object: "instagram",
    entry: [{
      id: "secret-account-id",
      messaging: [{
        sender: { id: "secret-sender-id" },
        recipient: { id: "secret-recipient-id" },
        message: { mid: "secret-message-id", text: "contenido privado", is_echo: true },
      }],
    }],
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("contenido privado"), false);
  assert.equal(serialized.includes("secret-"), false);
  assert.equal(serialized.includes('"isEcho":true'), true);
  assert.equal(serialized.includes('"hasText":true'), true);
});
