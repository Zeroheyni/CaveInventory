-- Fase 7 (refinamento): personagem agora tem VÁRIOS cadernos
-- (notebook_data.notebooks é uma lista, cada um com seu tema/material/
-- fonte/páginas) em vez de um só -- ver src/notebook.js. A RPC de
-- leitura do mestre precisa acompanhar o novo formato: em vez de
-- devolver só a lista de páginas compartilhadas, devolve uma lista de
-- cadernos (só os que têm ao menos 1 página compartilhada), cada um
-- com suas páginas visíveis.
create or replace function get_notebook_shared_pages(p_character_id uuid)
returns jsonb
language plpgsql security definer stable as $$
declare
  v_char characters%rowtype;
  v_all jsonb;
  v_result jsonb;
begin
  select * into v_char from characters where id = p_character_id;
  if v_char.id is null then
    raise exception 'personagem não encontrado';
  end if;

  if not (is_superadmin() or (is_master() and v_char.campaign_id = current_campaign_id())) then
    raise exception 'sem permissão pra ver esse caderno';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'notebookId', nb ->> 'id',
      'notebookName', coalesce(nb ->> 'name', 'Caderno'),
      'themeId', coalesce(nb ->> 'themeId', 'papel'),
      'pages', (
        select coalesce(jsonb_agg(page), '[]'::jsonb)
        from jsonb_array_elements(coalesce(nb -> 'pages', '[]'::jsonb)) as page
        where (page ->> 'visibleToMaster')::boolean is true
      )
    )
  ), '[]'::jsonb) into v_all
  from jsonb_array_elements(coalesce(v_char.notebook_data -> 'notebooks', '[]'::jsonb)) as nb;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
  from jsonb_array_elements(v_all) as x
  where jsonb_array_length(x -> 'pages') > 0;

  return v_result;
end;
$$;
