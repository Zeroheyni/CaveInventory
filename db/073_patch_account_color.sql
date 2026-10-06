-- ============================================================================
-- Cor da conta: cada jogador escolhe a própria. É a cor padrão da borda dos tokens dele, do desenho/ping no tabuleiro e
-- do cursor que os amigos veem. Gravada por RPC (muda também os tokens que ainda estavam na cor antiga/padrão).
-- ============================================================================
alter table profiles add column if not exists color text;
alter table profiles drop constraint if exists profiles_color_hex;
alter table profiles add constraint profiles_color_hex check (color is null or color ~ '^#[0-9a-f]{6}$');

create or replace function set_my_color(p_color text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_new text := lower(p_color);
  v_old text;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if v_new is null or v_new !~ '^#[0-9a-f]{6}$' then raise exception 'cor inválida'; end if;
  select lower(color) into v_old from profiles where id = auth.uid();
  update profiles set color = v_new where id = auth.uid();
  -- tokens dos meus personagens que ainda usavam a cor antiga (ou a cor padrão do sistema) acompanham a nova
  update board_tokens t set border_color = v_new
  where t.character_id in (select id from characters where owner_id = auth.uid())
    and lower(t.border_color) in (coalesce(v_old, '#5ad4ff'), '#5ad4ff');
end $$;
grant execute on function set_my_color(text) to authenticated;
