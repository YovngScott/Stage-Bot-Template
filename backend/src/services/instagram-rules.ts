import { z } from "zod";
export const instagramRulesSchema = z.array(z.object({
  id: z.string().min(1).max(80),
  enabled: z.boolean(),
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
  match: z.enum(["exact", "word"]),
  reply: z.string().trim().min(1).max(1000),
}).strict()).max(50).refine(rules => new Set(rules.map(rule => rule.id)).size === rules.length);
export type InstagramRule = z.infer<typeof instagramRulesSchema>[number];
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function matchInstagramRule(rules: InstagramRule[], text: string): string | null {
  const normalized = normalize(text);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.keywords.some(keyword => {
      const key = normalize(keyword);
      return key && (rule.match === "exact" ? normalized === key : ` ${normalized} `.includes(` ${key} `));
    })) return rule.reply;
  }
  return null;
}
