-- Proteção em camadas contra inventário apagado (continuação de
-- db/047). Depois do zeramento do inventário do Craig (28/08):
--
-- 1) TRAVA NO BANCO: gravação que deixa o inventário SEM item e SEM
--    recipiente, quando ele tinha algo, é RECUSADA (exceção
--    'inventario_zerado_bloqueado') a não ser que traga a confirmação
--    explícita `wipeConfirmed: true` dentro do próprio `data` -- que o
--    app só manda depois de o usuário confirmar num diálogo. A chave é
--    removida do `data` pelo trigger, nunca chega a ser gravada. É a
--    camada que vale mesmo com app antigo em cache, aba desatualizada,
--    bug novo ou SQL na mão. (Bypass legítimo: restaurar/importar
--    backup usa `app.skip_backup`.)
-- 2) ALERTA: backup 'zerado' ou 'reducao' avisa no canal do Discord
--    (mesmo canal/segredo do aviso de recorde, sem @menção) -- sem isso
--    o Craig ficou ~3 semanas sem ninguém perceber.
-- 3) AUDITORIA: cada foto guarda `changed_by` (auth.uid() de quem
--    gravou a versão que SUBSTITUIU a foto), `new_items_count` e
--    `character_name`. Na investigação do Craig, o tema salvo dentro do
--    inventário foi a única pista de "quem gravou".
-- 4) BACKUPS SOBREVIVEM À EXCLUSÃO do personagem: FK vira `on delete set
--    null` e um trigger BEFORE DELETE guarda uma foto 'excluido'. (Sem
--    isso, apagar o personagem apagava junto os backups dele.)
-- 5) IMPORTAR de arquivo (RPC), pro caso de perder o projeto: o app passa
--    a exportar todos os inventários num JSON que fica fora do Supabase.

alter table character_backups add column if not exists changed_by uuid;
alter table character_backups add column if not exists character_name text;
alter table character_backups add column if not exists new_items_count integer;
update character_backups b set character_name = c.name from characters c where c.id = b.character_id and b.character_name is null;

alter table character_backups drop constraint if exists character_backups_character_id_fkey;
alter table character_backups alter column character_id drop not null;
alter table character_backups add constraint character_backups_character_id_fkey
  foreign key (character_id) references characters(id) on delete set null;
alter table character_backups drop constraint if exists character_backups_reason_check;
alter table character_backups add constraint character_backups_reason_check
  check (reason in ('inicial', 'periodico', 'reducao', 'zerado', 'manual', 'antes_de_restaurar', 'excluido'));

create or replace function trg_backup_character_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old_n integer; v_new_n integer;
  v_old_i integer; v_new_i integer; v_wipe boolean;
  v_old_coins numeric; v_new_coins numeric;
  v_reason text; v_last timestamptz;
  v_confirmed boolean;
  v_channel_id text; v_secret text;
begin
  -- confirmação de "pode zerar" viaja dentro do próprio data; nunca é gravada
  v_confirmed := coalesce((new.data ->> 'wipeConfirmed') = 'true', false);
  if new.data is not null and jsonb_typeof(new.data) = 'object' and new.data ? 'wipeConfirmed' then
    new.data := new.data - 'wipeConfirmed';
  end if;

  -- restaurar/importar backup grava a própria foto e pode restaurar até um estado vazio
  if current_setting('app.skip_backup', true) = '1' then return new; end if;
  if new.data is not distinct from old.data and new.currency is not distinct from old.currency then return new; end if;

  v_old_i := inv_items_count(old.data);
  v_new_i := inv_items_count(new.data);
  v_old_n := v_old_i + inv_containers_count(old.data);
  v_new_n := v_new_i + inv_containers_count(new.data);
  -- 'zerar' = ficar sem NENHUM item (mesmo que sobre um recipiente vazio) ou sem nada
  v_wipe := (v_old_i > 0 and v_new_i = 0) or (v_old_n > 0 and v_new_n = 0);
  v_old_coins := inv_coins(old.currency);
  v_new_coins := inv_coins(new.currency);

  if v_wipe and not v_confirmed then
    raise exception 'inventario_zerado_bloqueado: a gravação deixaria o inventário sem nenhum item (tinha % item(ns)/recipiente(s)) e não veio confirmada', v_old_n
      using errcode = 'P0001';
  end if;

  if v_old_n = 0 and v_old_coins = 0 then return new; end if; -- nada a proteger

  if v_wipe or (v_new_n = 0 and v_new_coins = 0) then
    v_reason := 'zerado';
  elsif v_old_n > 0 and v_new_n * 2 < v_old_n then
    v_reason := 'reducao';
  else
    select max(created_at) into v_last from character_backups where character_id = old.id;
    if v_last is null or v_last < now() - interval '15 minutes' then v_reason := 'periodico'; end if;
  end if;

  if v_reason is not null then
    insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name, new_items_count)
    values (old.id, old.campaign_id, v_reason, coalesce(old.data, '{}'::jsonb), old.currency,
            inv_items_count(old.data), inv_containers_count(old.data), old.inventory_updated_at, auth.uid(), old.name, v_new_n);
    delete from character_backups
      where character_id = old.id
        and ((reason = 'periodico' and created_at < now() - interval '14 days') or created_at < now() - interval '180 days');

    if v_reason in ('zerado', 'reducao') then
      select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'discord_sync_shared_secret';
      select combat_channel_id into v_channel_id from discord_config where campaign_id = old.campaign_id;
      if v_secret is not null and v_channel_id is not null then
        perform net.http_post(
          url := 'https://oswkabxzlnytgspxizyn.functions.supabase.co/discord-notify-roll',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
          body := jsonb_build_object(
            'channel_id', v_channel_id,
            'content', '⚠️ O inventário de **' || regexp_replace(coalesce(old.name, 'um personagem'), '[@<>*_~`|\\]', '', 'g')
              || '** caiu de ' || v_old_n || ' para ' || v_new_n || ' item(ns)/recipiente(s). Uma cópia foi guardada -- o mestre pode restaurar em Inventário > Backups.'
          )
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- excluir personagem: guarda uma foto final (o backup sobrevive por causa do FK set null)
create or replace function trg_backup_character_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- excluir a CAMPANHA apaga os personagens em cascata: nesse caso a campanha
  -- já não existe mais e o insert abaixo violaria o FK -- não faz backup.
  if not exists (select 1 from campaigns where id = old.campaign_id) then return old; end if;
  if inv_items_count(old.data) + inv_containers_count(old.data) > 0 or inv_coins(old.currency) > 0 then
    insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
    values (old.id, old.campaign_id, 'excluido', coalesce(old.data, '{}'::jsonb), old.currency,
            inv_items_count(old.data), inv_containers_count(old.data), old.inventory_updated_at, auth.uid(), old.name);
  end if;
  return old;
end;
$$;
drop trigger if exists character_delete_backup_trg on characters;
create trigger character_delete_backup_trg
  before delete on characters
  for each row execute function trg_backup_character_before_delete();

create or replace function restore_character_backup(p_backup_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b character_backups%rowtype;
  c characters%rowtype;
begin
  select * into b from character_backups where id = p_backup_id;
  if b.id is null then raise exception 'backup não encontrado'; end if;
  if not (is_superadmin() or (is_master() and b.campaign_id = current_campaign_id())) then
    raise exception 'só o mestre restaura backup de inventário';
  end if;
  if b.character_id is null then raise exception 'esse personagem foi excluído -- o backup está guardado, mas precisa ser recriado à mão'; end if;
  select * into c from characters where id = b.character_id for update;
  if c.id is null then raise exception 'personagem não existe mais'; end if;

  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
  values (c.id, c.campaign_id, 'antes_de_restaurar', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at, auth.uid(), c.name);

  perform set_config('app.skip_backup', '1', true);
  update characters
    set data = b.data,
        currency = coalesce(b.currency, c.currency),
        inventory_updated_at = now(),
        updated_at = now()
    where id = c.id;
  perform set_config('app.skip_backup', '0', true);
end;
$$;
grant execute on function restore_character_backup(uuid) to authenticated;

create or replace function create_character_backup(p_character_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c characters%rowtype;
begin
  select * into c from characters where id = p_character_id;
  if c.id is null then raise exception 'personagem não encontrado'; end if;
  if not (is_superadmin() or (is_master() and c.campaign_id = current_campaign_id())) then
    raise exception 'só o mestre cria backup de inventário';
  end if;
  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
  values (c.id, c.campaign_id, 'manual', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at, auth.uid(), c.name);
end;
$$;
grant execute on function create_character_backup(uuid) to authenticated;

-- importar de arquivo exportado pelo app (só mestre); valida o formato e
-- guarda o estado atual como backup antes de sobrescrever
create or replace function import_character_inventory(p_character_id uuid, p_data jsonb, p_currency jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c characters%rowtype;
begin
  select * into c from characters where id = p_character_id for update;
  if c.id is null then raise exception 'personagem não encontrado'; end if;
  if not (is_superadmin() or (is_master() and c.campaign_id = current_campaign_id())) then
    raise exception 'só o mestre importa inventário';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data -> 'items') is distinct from 'array'
     or jsonb_typeof(p_data -> 'containers') is distinct from 'array' then
    raise exception 'dados do arquivo inválidos (esperado um inventário com items e containers)';
  end if;

  insert into character_backups (character_id, campaign_id, reason, data, currency, items_count, containers_count, inventory_updated_at, changed_by, character_name)
  values (c.id, c.campaign_id, 'antes_de_restaurar', coalesce(c.data, '{}'::jsonb), c.currency,
          inv_items_count(c.data), inv_containers_count(c.data), c.inventory_updated_at, auth.uid(), c.name);

  perform set_config('app.skip_backup', '1', true);
  update characters
    set data = p_data - 'wipeConfirmed',
        currency = coalesce(p_currency, c.currency),
        inventory_updated_at = now(),
        updated_at = now()
    where id = c.id;
  perform set_config('app.skip_backup', '0', true);
end;
$$;
grant execute on function import_character_inventory(uuid, jsonb, jsonb) to authenticated;

-- 6) devolver do Baú Compartilhado pro Espaço Pessoal: o app fazia
--    "lê o inventário, monta um data novo INTEIRO e grava" (publicArea.js:
--    updateCharacterData) sem a trava de versão -- se o inventário tivesse
--    mudado desde o carregamento da tela, o data velho sobrescrevia o novo
--    e o inventário aberto em outra aba nem percebia (a versão não
--    mudava). Agora o banco só ACRESCENTA a entrada, sobre a linha atual,
--    e avança inventory_updated_at (as outras abas recarregam).
create or replace function append_personal_inventory_entry(p_kind text, p_entry jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  c characters%rowtype;
  v_key text;
  d jsonb;
begin
  if p_kind not in ('item', 'container') then raise exception 'tipo inválido'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or (p_entry ->> 'id') is null then
    raise exception 'entrada inválida';
  end if;
  select * into c from characters
    where owner_id = auth.uid() and campaign_id = current_campaign_id()
    limit 1 for update;
  if c.id is null then raise exception 'você não tem personagem nessa campanha'; end if;

  v_key := case when p_kind = 'item' then 'items' else 'containers' end;
  d := case when jsonb_typeof(c.data) = 'object' then c.data else '{}'::jsonb end;
  d := jsonb_set(d, array[v_key],
        (case when jsonb_typeof(d -> v_key) = 'array' then d -> v_key else '[]'::jsonb end) || jsonb_build_array(p_entry));
  d := jsonb_set(d, '{transportPersonal}',
        (case when jsonb_typeof(d -> 'transportPersonal') = 'array' then d -> 'transportPersonal' else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object('type', p_kind, 'id', p_entry ->> 'id')));

  update characters set data = d, inventory_updated_at = now(), updated_at = now() where id = c.id;
end;
$$;
grant execute on function append_personal_inventory_entry(text, jsonb) to authenticated;
