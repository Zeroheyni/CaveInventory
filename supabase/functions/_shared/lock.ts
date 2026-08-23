// Trava simples (linha numa tabela, não pg_advisory_lock -- ver
// db/013_patch_discord_sync_lock.sql pro motivo) pra impedir que duas
// sincronizações do MESMO alvo (personagem ou campanha) rodem em paralelo e
// criem mensagens duplicadas no Discord (cada uma lê os IDs de mensagem
// antigos antes da outra terminar de gravar os novos).
import { serviceClient } from './db.ts';

const STALE_MS = 30_000; // depois disso, uma trava emperrada (execução anterior caiu) pode ser "roubada"

// Roda fn() só se conseguir a trava pra essa key; se outra sincronização do
// mesmo alvo já estiver rodando de verdade, pula (retorna null) -- a próxima
// mudança nesse personagem/campanha dispara um novo sync que lê o estado
// atual do zero, então nada fica esquecido por muito tempo.
export async function withSyncLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = serviceClient();
  const { error: insertError } = await client.from('discord_sync_locks').insert({ key });
  if (insertError) {
    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
    const { data: stolen } = await client
      .from('discord_sync_locks')
      .update({ acquired_at: new Date().toISOString() })
      .eq('key', key)
      .lt('acquired_at', staleBefore)
      .select();
    if (!stolen || stolen.length === 0) return null; // outra sincronização rodando de verdade agora -- pula essa
  }
  try {
    return await fn();
  } finally {
    await client.from('discord_sync_locks').delete().eq('key', key);
  }
}
