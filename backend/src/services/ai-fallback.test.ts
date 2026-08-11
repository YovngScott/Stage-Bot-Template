import test from "node:test";
import assert from "node:assert/strict";
import { AIUnavailableError, runProviderFallback } from "./ai-fallback.js";

test("usa el segundo proveedor si el principal falla", async () => {
  const calls: string[] = [];
  const result = await runProviderFallback([
    async () => { calls.push("primary"); throw new Error("timeout"); },
    async () => { calls.push("fallback"); return "ok"; },
  ]);
  assert.equal(result, "ok");
  assert.deepEqual(calls, ["primary", "fallback"]);
});

test("si todos fallan lanza error y no fabrica respuesta", async () => {
  await assert.rejects(
    () => runProviderFallback([async () => { throw new Error("down"); }, async () => { throw new Error("down too"); }]),
    (error: unknown) => error instanceof AIUnavailableError && error.errors.length === 2,
  );
});
