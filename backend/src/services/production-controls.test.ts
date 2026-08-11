import test from "node:test";
import assert from "node:assert/strict";
import { evaluarHeuristica } from "./asistente/heuristica.js";

process.env.SUPABASE_URL ||= "https://tests.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role";
const { consentCommand, shouldAutoSend } = await import("./runtime-controls.js");
type RuntimePolicy = import("./runtime-controls.js").RuntimePolicy;

const policy: RuntimePolicy = {
  mode: "limited", autoSendPercentage: 25, monthlyMessages: 100,
  monthlyEmails: 100, monthlyTokens: 1000, monthlyCostUsd: 10,
  warningPercentage: 80, countryCode: "DO", requireConsent: true,
  retentionDays: 90, spamPerMinute: 10, pausedReason: null,
};

test("modo sombra nunca envía", () => {
  assert.equal(shouldAutoSend({ ...policy, mode: "shadow", autoSendPercentage: 100 }, "abc"), false);
});
test("modo live siempre envía", () => {
  assert.equal(shouldAutoSend({ ...policy, mode: "live", autoSendPercentage: 0 }, "abc"), true);
});
test("despliegue gradual es determinista por mensaje", () => {
  assert.equal(shouldAutoSend(policy, "message-42"), shouldAutoSend(policy, "message-42"));
});
test("exclusión y reactivación se reconocen sin ambigüedad", () => {
  assert.equal(consentCommand("STOP"), "opted_out");
  assert.equal(consentCommand("no me escriban."), "opted_out");
  assert.equal(consentCommand("INICIAR"), "opted_in");
  assert.equal(consentCommand("quiero información"), null);
});
test("auto respuestas, listas, newsletter y no-reply no llegan a la IA", () => {
  assert.equal(evaluarHeuristica({ from: "Mailer <no-reply@example.com>", subject: "x" }).procesar, false);
  assert.equal(evaluarHeuristica({ from: "a@example.com", subject: "x", autoSubmitted: "auto-replied" }).procesar, false);
  assert.equal(evaluarHeuristica({ from: "a@example.com", subject: "x", listUnsubscribe: "<mailto:x>" }).procesar, false);
  assert.equal(evaluarHeuristica({ from: "a@example.com", subject: "x", precedence: "bulk" }).procesar, false);
});
test("500 decisiones simultáneas mantienen resultado estable", async () => {
  const ids = Array.from({ length: 500 }, (_, i) => `load-${i % 100}`);
  const results = await Promise.all(ids.map(async (id) => shouldAutoSend(policy, id)));
  for (let i = 0; i < 100; i += 1) {
    const group = results.filter((_, index) => index % 100 === i);
    assert.equal(new Set(group).size, 1);
  }
});
