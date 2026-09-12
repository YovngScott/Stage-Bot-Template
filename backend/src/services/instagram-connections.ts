import { supabase } from "../lib/supabase.js";
import { descifrar } from "../lib/cripto.js";
import type { Tenant } from "../lib/tenants.js";
import type { InstagramCredentials } from "./instagram-context.js";

export async function getInstagramConnection(tenant: Tenant): Promise<InstagramCredentials | null> {
  const { data, error } = await supabase.from("instagram_connections").select("account_id,token_ciphertext,provider,enabled").eq("tenant_id", tenant.id).maybeSingle();
  if (error) throw new Error("instagram_connection_lookup_failed");
  if (data) return data.enabled ? { accountId: data.account_id, accessToken: descifrar(data.token_ciphertext), provider: data.provider } : null;
  // Legacy credentials belong exclusively to the explicitly configured pilot.
  if (tenant.config.slug !== process.env.META_INSTAGRAM_LEGACY_TENANT_SLUG) return null;
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID;
  const accessToken = process.env.META_INSTAGRAM_ACCESS_TOKEN;
  return accountId && accessToken ? { accountId, accessToken, webhookRecipientId: process.env.META_INSTAGRAM_WEBHOOK_RECIPIENT_ID, provider: "instagram" } : null;
}
