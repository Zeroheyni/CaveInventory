-- Fase 7: caderno de anotações do player. Coluna PRÓPRIA (não dentro
-- de `data`) porque `data` já é escrito de forma independente pelo
-- autosave do inventário (character.js) -- se o caderno gravasse
-- dentro do mesmo JSON, uma aba podia sobrescrever silenciosamente o
-- que a outra acabou de salvar (mesmo problema que fez os campos de
-- NPC virarem colunas próprias em vez de entrar em `data`, ver 023/024).
alter table characters add column if not exists notebook_data jsonb not null default '{}'::jsonb;

-- "compartilhado opcional": o dono decide por página se o mestre pode
-- ler. RLS não filtra dentro de um JSONB (só linha inteira) -- e tanto
-- o mestre quanto o mestre global já têm select livre em `characters`
-- (policies "mestre vê todos da campanha" e "superadmin ve tudo"), ou
-- seja, um select direto sempre traria o caderno inteiro. Por isso a
-- filtragem de página privada só acontece de verdade passando pela RPC
-- abaixo -- o app nunca faz select direto de notebook_data pra
-- ninguém além do dono.
create or replace function get_notebook_shared_pages(p_character_id uuid)
returns jsonb
language plpgsql security definer stable as $$
declare
  v_char characters%rowtype;
  v_pages jsonb;
begin
  select * into v_char from characters where id = p_character_id;
  if v_char.id is null then
    raise exception 'personagem não encontrado';
  end if;

  if not (is_superadmin() or (is_master() and v_char.campaign_id = current_campaign_id())) then
    raise exception 'sem permissão pra ver esse caderno';
  end if;

  select coalesce(jsonb_agg(page), '[]'::jsonb) into v_pages
  from jsonb_array_elements(coalesce(v_char.notebook_data -> 'pages', '[]'::jsonb)) as page
  where (page ->> 'visibleToMaster')::boolean is true;

  return jsonb_build_object('theme', coalesce(v_char.notebook_data ->> 'theme', 'papel'), 'pages', v_pages);
end;
$$;
grant execute on function get_notebook_shared_pages(uuid) to authenticated;
