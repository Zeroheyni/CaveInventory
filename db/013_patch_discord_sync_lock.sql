-- ============================================================
-- PATCH: trava a sincronização do Discord por personagem/campanha
--
-- Causa raiz da "sobra" de mensagens (encontrada depois que o mestre
-- reportou várias "ESPAÇO PESSOAL" duplicadas pros 5 personagens reais,
-- e o discord-prune achou 59 mensagens órfãs no total): syncCharacter
-- lê os IDs de mensagem já existentes NO INÍCIO, gasta um tempo real
-- fazendo chamadas HTTP pro Discord, e só grava os novos IDs no fim.
-- O trigger dispara a cada UPDATE em characters (qualquer campo, não só
-- os relevantes pro Discord) -- então autosave rápido (o jogador
-- mexendo no inventário logo depois do mestre vincular o canal, por
-- exemplo) dispara VÁRIAS execuções de syncCharacter em paralelo pro
-- MESMO personagem. Todas leem a mesma lista de IDs (ainda vazia, se o
-- canal acabou de ser vinculado), e cada uma cria sua PRÓPRIA mensagem
-- nova em vez de editar a mesma -- só a última a terminar de gravar no
-- banco "vence", as outras ficam de sobra pra sempre.
--
-- A trava é uma linha numa tabela simples (não pg_advisory_lock -- esse
-- é preso à conexão, e o pooler do Supabase reusa conexões entre
-- chamadas via PostgREST, então travar numa e destravar em outra nunca
-- funcionaria de verdade). "Rouba" a trava sozinha depois de 30s pra
-- nunca travar pra sempre se uma execução cair no meio do caminho.
-- ============================================================

create table discord_sync_locks (
  key text primary key,
  acquired_at timestamptz not null default now()
);

alter table discord_sync_locks enable row level security;
create policy "discord sync lock: superadmin mexe" on discord_sync_locks
  for all using (is_superadmin()) with check (is_superadmin());
