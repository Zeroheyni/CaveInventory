-- Teste de ISOLAMENTO entre campanhas (roda inteiro dentro de um DO que termina em EXCEPTION => rollback
-- garantido: nenhuma conta/campanha de teste fica gravada). O resultado aparece na mensagem de erro.
-- Papéis testados: mestre B (conta nova, só mestre da Mesa B), jogador B, Mestre (dono da campanha atual),
-- Zeroh (ADM). Cada um conta o que enxerga e tenta invadir a campanha "A" (a real).
do $$
declare
  a_camp uuid; a_char uuid;
  mestre uuid; zeroh uuid;
  mb uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); cb uuid := gen_random_uuid(); charb uuid := gen_random_uuid();
  labels text[]; uids uuid[];
  tabelas text[] := array['characters','campaigns','profiles','game_high_scores','character_backups','public_items','boards','dice_rolls','combat_participants'];
  i int; t text; n bigint; res text := ''; msg text; rc int;
begin
  select id into a_camp from campaigns order by created_at limit 1;
  select id into a_char from characters where campaign_id = a_camp and not is_npc limit 1;
  select id into mestre from profiles where lower(username) = 'mestre';
  select id into zeroh from profiles where lower(username) = 'zeroh';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (mb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tmb@teste.invalid', now(), now()),
         (pb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpb@teste.invalid', now(), now());
  insert into profiles (id, username, role) values (mb, 'TesteMestreB', 'player'), (pb, 'TestePlayerB', 'player');
  insert into campaigns (id, name, master_id) values (cb, 'Mesa B (teste)', mb);
  insert into campaign_members (campaign_id, user_id, role) values (cb, mb, 'master'), (cb, pb, 'player');
  insert into characters (id, campaign_id, owner_id, name) values (charb, cb, pb, 'Heroi B (teste)');

  labels := array['mestreB','jogadorB','Mestre','Zeroh(ADM)'];
  uids := array[mb, pb, mestre, zeroh];

  for i in 1 .. 4 loop
    perform set_config('request.jwt.claims', json_build_object('sub', uids[i], 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', uids[i]::text, true);
    execute 'set local role authenticated';
    res := res || E'\n[' || labels[i] || '] ';
    foreach t in array tabelas loop
      execute format('select count(*) from %I', t) into n;
      res := res || t || '=' || n || ' ';
    end loop;

    -- ataques à campanha A (a real): só pras contas SEM direito (mestreB e jogadorB); o mestre real e o ADM não precisam ser testados aqui
    if i <= 2 then
    begin
      update characters set name = name || '!' where campaign_id = a_camp;
      get diagnostics rc = row_count;
      res := res || '| UPDATE chars de A: ' || rc || ' linhas ';
    exception when others then res := res || '| UPDATE chars de A: erro ';
    end;
    begin
      insert into public_compartments (campaign_id, name) values (a_camp, 'invasao');
      res := res || '| INSERT compartimento em A: PASSOU(!) ';
    exception when others then res := res || '| INSERT compartimento em A: bloqueado ';
    end;
    begin
      perform grant_xp(array[a_char], 5);
      res := res || '| grant_xp em A: PASSOU ';
    exception when others then res := res || '| grant_xp em A: bloqueado ';
    end;
    begin
      perform confirm_status_allocation(a_char, 10, 10, 10, 10, 10, 10, 10);
      res := res || '| status em A: PASSOU(ou sem pontos) ';
    exception when others then res := res || '| status em A: ' || left(sqlerrm, 30) || ' ';
    end;
    end if;
    res := res || '| avatar path A: ' || storage_can_write_avatar_path(a_char::text || '/x.png')::text
                || ' | avatar path B: ' || storage_can_write_avatar_path(charb::text || '/x.png')::text
                || ' | admin=' || is_admin()::text || ' masterOf(A)=' || is_master_of(a_camp)::text || ' masterOf(B)=' || is_master_of(cb)::text;
    execute 'reset role';
  end loop;

  -- furo antigo (ainda aberto até o corte): o jogador consegue se promover?
  perform set_config('request.jwt.claims', json_build_object('sub', pb, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', pb::text, true);
  execute 'set local role authenticated';
  begin
    update profiles set is_superadmin = true where id = pb;
    get diagnostics rc = row_count;
    res := res || E'\n[FURO LEGADO] jogador se promove a ADM: ' || case when rc > 0 then 'SIM (a fechar no corte)' else 'nao' end;
  exception when others then res := res || E'\n[FURO LEGADO] jogador se promove a ADM: nao (' || left(sqlerrm, 30) || ')';
  end;
  execute 'reset role';

  raise exception E'RESULTADOS (rollback garantido):%', res;
end $$;
