// O painel do mestre chama discord-sync-character/discord-sync-public direto
// do navegador (supabase.functions.invoke) pra dar feedback imediato depois
// de vincular um canal — sem esses headers o preflight OPTIONS falha e o
// browser bloqueia a resposta antes mesmo dela chegar no código da função.
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  return null;
}

export function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, { ...init, headers: { ...CORS_HEADERS, ...(init.headers ?? {}) } });
}
