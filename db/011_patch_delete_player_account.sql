-- ============================================================
-- PATCH: mestre consegue excluir uma conta de jogador (sem precisar
-- apagar a campanha inteira)
--
-- Excluir a linha de auth.users já é suficiente -- profiles.id e
-- characters.owner_id referenciam auth.users(id) on delete cascade
-- (ver schema.sql), então perfil, personagem e vínculos do bot no
-- Discord (discord_character_config.character_id references
-- characters(id) on delete cascade) somem juntos automaticamente.
-- Só falta uma forma seguro do CLIENTE disparar isso -- o browser
-- não tem permissão de escrever direto em auth.users, então precisa
-- de uma função SECURITY DEFINER, restrita ao mestre global.
-- ============================================================

create or replace function delete_player_account(p_character_id uuid)
returns void language plpgsql security definer as $$
declare
  v_owner_id uuid;
begin
  if not is_superadmin() then
    raise exception 'só o mestre pode excluir contas de jogador';
  end if;
  select owner_id into v_owner_id from characters where id = p_character_id;
  if v_owner_id is null then
    raise exception 'personagem não encontrado';
  end if;
  if v_owner_id = auth.uid() then
    raise exception 'não é possível excluir a própria conta por aqui';
  end if;
  delete from auth.users where id = v_owner_id;
end;
$$;
grant execute on function delete_player_account(uuid) to authenticated;
