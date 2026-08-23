import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Service role: bypassa RLS de propósito — essas functions rodam fora do
// contexto de um usuário logado (disparadas por trigger do Postgres, ou
// pelo mestre global), e precisam ler characters/public_* de qualquer
// campanha pra montar o texto do Discord.
export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

// Autoriza uma chamada de duas formas:
// 1. Segredo compartilhado (x-sync-secret) — usado pelos triggers do Postgres.
// 2. JWT de usuário com is_superadmin — usado pelo painel do mestre (via
//    supabase.functions.invoke, que já manda o Authorization automaticamente).
export async function isAuthorized(req: Request): Promise<boolean> {
  const sharedSecret = Deno.env.get('DISCORD_SYNC_SHARED_SECRET');
  const givenSecret = req.headers.get('x-sync-secret');
  if (sharedSecret && givenSecret && givenSecret === sharedSecret) return true;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const jwt = authHeader.slice('Bearer '.length);
  const client = serviceClient();
  const { data: userData, error } = await client.auth.getUser(jwt);
  if (error || !userData?.user) return false;
  const { data: profile } = await client.from('profiles').select('is_superadmin').eq('id', userData.user.id).single();
  return !!profile?.is_superadmin;
}
