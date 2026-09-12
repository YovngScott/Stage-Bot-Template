// Isolated visual-test transport. Never imported by the production app.
let rules: unknown[] = [];
export async function adminFetch(path: string, options?: RequestInit) {
  if (options?.method === 'PUT') rules = JSON.parse(String(options.body)).rules;
  return Response.json(path.endsWith('/rules') ? { rules } : { connection: null, legacyConnected: true, facebookReady: false });
}
