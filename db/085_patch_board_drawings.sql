-- ============================================================================
-- Tabuleiro: DESENHOS DE INDICAÇÃO PERMANENTES (só o mestre cria/apaga; todo mundo da mesa vê)
--   Diferente do ping/desenho temporário (Broadcast efêmero, src/boardFx.js): estes ficam gravados no tabuleiro até o mestre apagar.
--   kind: free (traço livre) | arrow (seta) | circle (círculo) | pin (marcador com nome)
--   data: coordenadas em % do palco (igual tokens/paredes):
--     free   { pts: [[x,y],...] }     arrow { x1,y1,x2,y2 }     circle { x,y,r }     pin { x,y }
-- ============================================================================

create table if not exists board_drawings (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  kind text not null check (kind in ('free', 'arrow', 'circle', 'pin')),
  color text not null default '#ff5a5a' check (color ~ '^#[0-9a-fA-F]{6}$'),
  label text check (label is null or char_length(label) <= 40),
  data jsonb not null check (octet_length(data::text) <= 12000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists board_drawings_board_idx on board_drawings(board_id);

alter table board_drawings enable row level security;

drop policy if exists "desenho: campanha vê" on board_drawings;
create policy "desenho: campanha vê" on board_drawings
  for select using (is_member_of(campaign_id));

drop policy if exists "desenho: mestre mexe" on board_drawings;
create policy "desenho: mestre mexe" on board_drawings
  for all using (is_master_of(campaign_id)) with check (is_master_of(campaign_id));

-- Realtime (DELETE precisa do board_id na linha antiga pro filtro do cliente, por isso replica identity full)
alter table board_drawings replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_drawings') then
    alter publication supabase_realtime add table board_drawings;
  end if;
end $$;
