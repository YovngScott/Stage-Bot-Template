import assert from "node:assert/strict";
import test from "node:test";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

const { ejecutarTool } = await import("./executor.js");

const tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  config: { behavior: "sales" },
} as any;

test("bloquea herramientas con un cliente de otro tenant antes de tocar la base", async () => {
  const result = await ejecutarTool(
    "etiquetar_cliente",
    { estado: "interesado" },
    tenant,
    {
      id: "22222222-2222-4222-8222-222222222222",
      tenant_id: "33333333-3333-4333-8333-333333333333",
      telefono: "+10000000000",
      nombre: "Intruso",
    } as any,
  );
  assert.equal(result.esError, true);
  assert.match(result.resultado, /Aislamiento de tenant/);
});

test("rechaza un tenant_id inyectado dentro de argumentos de herramienta", async () => {
  const result = await ejecutarTool(
    "consultar_catalogo",
    { busqueda: "servicio", tenant_id: "33333333-3333-4333-8333-333333333333" },
    tenant,
    {
      id: "22222222-2222-4222-8222-222222222222",
      tenant_id: tenant.id,
      telefono: "+10000000000",
      nombre: "Cliente",
    } as any,
  );
  assert.equal(result.esError, true);
  assert.match(result.resultado, /inválidos|incompletos/i);
});
