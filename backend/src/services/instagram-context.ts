import { AsyncLocalStorage } from "node:async_hooks";

export interface InstagramCredentials {
  accountId: string;
  accessToken: string;
  webhookRecipientId?: string;
  provider: "instagram" | "facebook";
}
export const instagramContext = new AsyncLocalStorage<InstagramCredentials>();
export function instagramCredential(name: string): string | undefined {
  const context = instagramContext.getStore();
  if (context) {
    if (name === "META_INSTAGRAM_ACCOUNT_ID") return context.accountId;
    if (name === "META_INSTAGRAM_ACCESS_TOKEN") return context.accessToken;
    if (name === "META_INSTAGRAM_WEBHOOK_RECIPIENT_ID") return context.webhookRecipientId;
  }
  return process.env[name]?.trim();
}
export function instagramGraphHost(): string {
  return instagramContext.getStore()?.provider === "facebook" ? "graph.facebook.com" : "graph.instagram.com";
}
