-- ============================================================
-- PATCH: mestre cria conta de jogador já vinculada a uma campanha
--
-- admin.js chama supabase.auth.signUp() pra criar o usuário; isso troca
-- a sessão do navegador pra sessão do usuário novo (auth.uid() já é o id
-- do jogador recém-criado). Mas não existe política de INSERT direta em
-- profiles/characters -- só dá pra criar essas linhas via função
-- SECURITY DEFINER, mesmo padrão de create_campaign/join_campaign em
-- 001_patch_auth_flow.sql. Essa função substitui o antigo join_campaign
-- (por código de convite) nesse ponto do fluxo: o mestre já escolhe a
-- campanha na hora de criar a conta, então só falta gravar perfil +
-- personagem do jogador novo.
-- ============================================================

create or replace function complete_player_account(p_campaign_id uuid, p_username text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from campaigns where id = p_campaign_id) then
    raise exception 'Campanha não encontrada.';
  end if;

  insert into profiles (id, campaign_id, username, role)
    values (auth.uid(), p_campaign_id, p_username, 'player')
  on conflict (id) do update
    set campaign_id = excluded.campaign_id, username = excluded.username;

  insert into characters (campaign_id, owner_id, name)
    values (p_campaign_id, auth.uid(), p_username);
end;
$$;

grant execute on function complete_player_account(uuid, text) to authenticated;
