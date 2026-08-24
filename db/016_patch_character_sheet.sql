-- ============================================================
-- PATCH: Fase 5 -- ficha de personagem
--
-- Status (7 atributos), nível/XP, HP e Estamina persistentes (fonte
-- única de verdade -- o rastreador de combate da Fase 4 passa a
-- gravar de volta aqui pra personagens vinculados), foto de perfil, e
-- um blob solto pra bio/história/módulos (conteúdo livre demais pra
-- valer colunas próprias).
--
-- Pontos de status e XP passam por RPCs validadas (não por UPDATE
-- direto) -- confirm_status_allocation garante o teto por status e
-- que não gasta mais pontos do que tem; grant_xp já resolve o level up
-- automático (e os +3 pontos por nível) numa chamada só, pro menu de
-- XP em massa do mestre.
-- ============================================================

-- mestre (não-superadmin) hoje só tem SELECT nos personagens dos
-- outros jogadores da campanha -- a ficha precisa que ele edite
-- status/HP/XP/etc de qualquer personagem da própria campanha.
create policy "personagem: mestre edita todos da campanha" on characters
  for update using (is_master() and campaign_id = current_campaign_id())
  with check (is_master() and campaign_id = current_campaign_id());

alter table characters
  add column level integer not null default 1,
  add column xp integer not null default 0,
  add column status_points_unspent integer not null default 16,
  add column status_confirmed boolean not null default false,
  add column vitalidade integer not null default 10,
  add column forca integer not null default 10,
  add column agilidade integer not null default 10,
  add column destreza integer not null default 10,
  add column inteligencia integer not null default 10,
  add column estamina integer not null default 10,
  add column observacao integer not null default 10,
  add column hp_current integer not null default 40,
  add column estamina_current integer not null default 10,
  add column avatar_url text,
  add column sheet_data jsonb not null default '{}'::jsonb; -- idade, genero, sexualidade, historia, modulos: [{id,title,content}]

-- ---------- confirmar alocação de pontos de status ----------
-- Vale tanto pra alocação inicial (16 pontos, teto 16) quanto pra
-- realocação depois de subir de nível (3 pontos por nível, teto
-- 16+nível) -- o teto e o pool disponível já mudam sozinhos porque
-- status_points_unspent e level refletem o estado real.
create or replace function confirm_status_allocation(
  p_character_id uuid,
  p_vitalidade integer, p_forca integer, p_agilidade integer,
  p_destreza integer, p_inteligencia integer, p_estamina integer, p_observacao integer
) returns void language plpgsql security definer as $$
declare
  v_char characters%rowtype;
  v_cap integer;
  v_spent integer;
  v_first_confirm boolean;
begin
  select * into v_char from characters where id = p_character_id for update;
  if v_char.id is null then raise exception 'personagem não encontrado'; end if;
  if v_char.owner_id <> auth.uid() and not is_master() and not is_superadmin() then
    raise exception 'sem permissão pra editar esse personagem';
  end if;
  if v_char.status_points_unspent <= 0 then
    raise exception 'nenhum ponto de status pra distribuir agora';
  end if;

  v_first_confirm := not v_char.status_confirmed;
  v_cap := case when v_first_confirm then 16 else 16 + v_char.level end;

  if p_vitalidade < 10 or p_forca < 10 or p_agilidade < 10 or p_destreza < 10
     or p_inteligencia < 10 or p_estamina < 10 or p_observacao < 10 then
    raise exception 'nenhum status pode ficar abaixo de 10';
  end if;
  if p_vitalidade > v_cap or p_forca > v_cap or p_agilidade > v_cap or p_destreza > v_cap
     or p_inteligencia > v_cap or p_estamina > v_cap or p_observacao > v_cap then
    raise exception 'nenhum status pode passar de %', v_cap;
  end if;

  v_spent := (p_vitalidade - v_char.vitalidade) + (p_forca - v_char.forca) + (p_agilidade - v_char.agilidade)
           + (p_destreza - v_char.destreza) + (p_inteligencia - v_char.inteligencia)
           + (p_estamina - v_char.estamina) + (p_observacao - v_char.observacao);
  if v_spent < 0 then
    raise exception 'não dá pra reduzir status, só distribuir os pontos disponíveis';
  end if;
  if v_spent > v_char.status_points_unspent then
    raise exception 'você só tem % pontos disponíveis', v_char.status_points_unspent;
  end if;

  update characters set
    vitalidade = p_vitalidade, forca = p_forca, agilidade = p_agilidade,
    destreza = p_destreza, inteligencia = p_inteligencia, estamina = p_estamina, observacao = p_observacao,
    status_points_unspent = v_char.status_points_unspent - v_spent,
    status_confirmed = true,
    -- primeira confirmação (criação do personagem) já entra com vida/estamina cheias;
    -- realocações depois disso não curam de graça, só evita ficar acima do novo máximo
    hp_current = case when v_first_confirm then p_vitalidade * 4 else least(v_char.hp_current, p_vitalidade * 4) end,
    estamina_current = case when v_first_confirm then p_estamina else least(v_char.estamina_current, p_estamina) end
  where id = p_character_id;
end;
$$;
grant execute on function confirm_status_allocation(uuid,integer,integer,integer,integer,integer,integer,integer) to authenticated;

-- ---------- dar XP em massa (menu do mestre) ----------
-- level up automático (pode subir mais de 1 nível numa chamada só, se
-- a quantidade de XP for grande) -- cada nível libera +3 pontos de
-- status pra distribuir depois.
create or replace function grant_xp(p_character_ids uuid[], p_amount integer)
returns void language plpgsql security definer as $$
declare
  v_char_id uuid;
  v_char characters%rowtype;
  v_new_xp integer;
  v_new_level integer;
  v_gained_points integer;
begin
  if not is_master() and not is_superadmin() then
    raise exception 'só o mestre pode dar XP';
  end if;
  if p_amount <= 0 then
    raise exception 'quantidade de XP precisa ser positiva';
  end if;

  foreach v_char_id in array p_character_ids loop
    select * into v_char from characters where id = v_char_id for update;
    if v_char.id is null then continue; end if;
    if not is_superadmin() and v_char.campaign_id <> current_campaign_id() then
      raise exception 'personagem % não é da sua campanha', v_char.name;
    end if;

    v_new_xp := v_char.xp + p_amount;
    v_new_level := v_char.level;
    v_gained_points := 0;
    while v_new_xp >= 10 * v_new_level loop
      v_new_xp := v_new_xp - 10 * v_new_level;
      v_new_level := v_new_level + 1;
      v_gained_points := v_gained_points + 3;
    end loop;

    update characters set
      xp = v_new_xp,
      level = v_new_level,
      status_points_unspent = status_points_unspent + v_gained_points
    where id = v_char_id;
  end loop;
end;
$$;
grant execute on function grant_xp(uuid[], integer) to authenticated;

-- ---------- estamina no rastreador de combate (Fase 4) ----------
-- mesmo tratamento do HP: por padrão só rastreio de batalha (NPCs),
-- mas pra participante vinculado a personagem, o combat.js escreve
-- aqui E em characters.estamina_current ao mesmo tempo (fonte única
-- de verdade continua sendo a ficha).
alter table combat_participants
  add column stamina_current integer not null default 0,
  add column stamina_max integer not null default 0;

-- ---------- avatar (foto de perfil) ----------
-- IMPORTANTE -- feito à mão, fora deste arquivo (uma vez só): o bucket
-- "avatars" (público) precisa ser criado pela API de Storage de
-- verdade (supabase.storage.createBucket(...), via um client com a
-- service role), não por INSERT direto em storage.buckets -- um
-- INSERT cru cria a linha, mas o serviço de Storage não reconhece o
-- bucket depois disso (dá "Bucket not found" mesmo com a linha lá).
-- Mesma lógica pro storage.objects.upload() com upsert:true/.update():
-- nesse projeto elas sempre batem em "new row violates row-level
-- security policy" mesmo com a policy certa (confirmado testando a
-- mesma condição via RPC, que retorna true) -- por isso o cliente
-- (characterSheet.js:uploadAvatar) apaga o arquivo antigo e sobe de
-- novo como inserção nova em vez de tentar upsert/update, e por isso
-- não existe policy de UPDATE aqui, só INSERT e DELETE.

-- tenta o cast pra uuid sem estourar exceção pra path que não é UUID
-- (evita que um path malformado vire erro de política em vez de "nega
-- limpo") -- primeiro segmento do path precisa ser o character_id.
create or replace function storage_owns_avatar_path(p_name text) returns boolean
language plpgsql stable as $$
declare
  v_char_id uuid;
begin
  begin
    v_char_id := (storage.foldername(p_name))[1]::uuid;
  exception when others then
    return false;
  end;
  return exists(select 1 from characters where id = v_char_id and owner_id = auth.uid());
end;
$$;

create policy "avatares: dono ou mestre sobe" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars' and (storage_owns_avatar_path(name) or is_master() or is_superadmin())
  );
create policy "avatares: dono ou mestre remove" on storage.objects
  for delete to authenticated using (
    bucket_id = 'avatars' and (storage_owns_avatar_path(name) or is_master() or is_superadmin())
  );
