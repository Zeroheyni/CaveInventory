-- ============================================================================
-- Tabuleiro: MEMÓRIA DO MAPA (o que o jogador já explorou fica meio apagado, em vez de voltar ao preto total)
--   * o mestre liga/desliga por tabuleiro (boards.memory_enabled; padrão desligado)
--   * cada jogador guarda o PRÓPRIO mapa explorado (board_memory: grade 100x100 em base64, 1 bit por célula de 1% x 1%)
--   * "zerar memória" (mestre): apaga as linhas e sobe memory_epoch -- quem estiver com o tabuleiro aberto descarta a cópia local
-- Ping e desenhos temporários NÃO usam o banco (são Broadcast efêmero, ver src/boardFx.js).
-- ============================================================================

alter table boards
  add column if not exists memory_enabled boolean not null default false,
  add column if not exists memory_epoch integer not null default 0;

create table if not exists board_memory (
  board_id uuid not null references boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  epoch integer not null default 0,
  cells text not null default '',
  updated_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
alter table board_memory enable row level security;

drop policy if exists "memória do mapa: o jogador lê a própria" on board_memory;
create policy "memória do mapa: o jogador lê a própria" on board_memory for select
  using (user_id = auth.uid());

drop policy if exists "memória do mapa: o jogador grava a própria" on board_memory;
create policy "memória do mapa: o jogador grava a própria" on board_memory for insert
  with check (user_id = auth.uid() and exists (select 1 from boards b where b.id = board_id and is_member_of(b.campaign_id)));

drop policy if exists "memória do mapa: o jogador atualiza a própria" on board_memory;
create policy "memória do mapa: o jogador atualiza a própria" on board_memory for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from boards b where b.id = board_id and is_member_of(b.campaign_id)));

drop policy if exists "memória do mapa: o jogador apaga a própria" on board_memory;
create policy "memória do mapa: o jogador apaga a própria" on board_memory for delete
  using (user_id = auth.uid());

-- limita o tamanho (100x100 bits = 1250 bytes = 1668 caracteres base64)
alter table board_memory drop constraint if exists board_memory_cells_len;
alter table board_memory add constraint board_memory_cells_len check (char_length(cells) <= 2000);

create or replace function reset_board_memory(p_board_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_camp uuid;
begin
  select campaign_id into v_camp from boards where id = p_board_id;
  if v_camp is null then raise exception 'tabuleiro não encontrado'; end if;
  if not is_master_of(v_camp) then raise exception 'só o mestre da campanha zera a memória do mapa'; end if;
  delete from board_memory where board_id = p_board_id;
  update boards set memory_epoch = memory_epoch + 1 where id = p_board_id;
end $$;
grant execute on function reset_board_memory(uuid) to authenticated;
