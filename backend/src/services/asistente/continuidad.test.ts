import assert from "node:assert/strict";
import test from "node:test";

// Este archivo prueba solamente reglas puras. El cliente de Supabase se crea al
// cargar el mÃ³dulo, por eso usamos valores locales no conectados antes del import.
process.env.SUPABASE_URL ||= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
const { followupRequired, inferFollowupType, promisesFutureAction } = await import("./continuidad.js");

const correo: any = { id: "m1", hiloId: "t1", cuerpo: "¿Cuándo podemos reunirnos por Google Meet?", recibidoEn: new Date().toISOString(), encabezados: { from: "client@example.com", subject: "Reunión" } };
const classification: any = { requiereAccion: true, justificacion: "Pide agenda", tarea: null, borrador: { cuerpo: "Voy a verificar mi disponibilidad y le informaré." } };

test("detecta promesas futuras que necesitan memoria", () => {
  assert.equal(promisesFutureAction(classification.borrador.cuerpo), true);
  assert.equal(followupRequired(classification, correo), true);
});

test("clasifica solicitudes de agenda como continuidad de calendario", () => {
  assert.equal(inferFollowupType(null, correo), "calendar");
});
