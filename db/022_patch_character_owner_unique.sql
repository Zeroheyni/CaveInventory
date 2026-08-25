-- Trava contra corrida no loadState() de character.js: quando o jogador
-- ainda não tinha personagem, a tela fazia um SELECT por
-- campaign_id+owner_id e, se não achasse nada, dava INSERT. Duas cargas
-- rápidas da tela (dois reloads em sequência, ou duas abas abrindo ao
-- mesmo tempo) podiam rodar o SELECT antes do INSERT da outra ficar
-- visível -- cada uma criava sua própria linha em characters pro mesmo
-- dono+campanha. Depois disso, qual das duas linhas o app usa é
-- não-determinístico (o SELECT usa .limit(1) sem order by), então o
-- inventário podia parecer "resetar" trocando de linha entre um load e
-- outro.
--
-- ANTES de rodar o "alter table" abaixo em produção: rode a query a
-- seguir pra conferir se já existe alguma duplicata. Se aparecer
-- qualquer linha, PARE -- não rode o alter table ainda, decida à mão
-- (com o dono do dado) qual das linhas duplicadas fica antes de
-- mesclar/apagar as outras. O alter table também falha sozinho com erro
-- de unique violation se houver duplicata, então não há risco de ele
-- apagar ou corromper nada -- só não vai aplicar até o dado ser limpo.
--
--   select campaign_id, owner_id, count(*), array_agg(id order by updated_at)
--     from characters
--     group by campaign_id, owner_id
--     having count(*) > 1;

alter table characters
  add constraint characters_campaign_owner_unique unique (campaign_id, owner_id);

-- complete_player_account (db/006_patch_player_account_creation.sql) também
-- insere em characters pra cada conta nova criada pelo mestre; com a
-- constraint acima, um duplo-clique/retry nesse fluxo passaria a estourar
-- unique violation em vez de criar duplicata. Deixa esse insert idempotente
-- também, já que agora tem a constraint pra apoiar o on conflict.
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
    values (p_campaign_id, auth.uid(), p_username)
  on conflict (campaign_id, owner_id) do nothing;
end;
$$;
