// Camada de dados do rastreador de combate (Fase 4) -- ver
// db/015_patch_combat.sql. Sem rolagem/dano automático ainda (isso
// depende da ficha de status da Fase 5) -- aqui é só HP + ordem de
// iniciativa, que o mestre e os jogadores ajustam manualmente.
import { supabase } from './supabaseClient.js';
import { logEvent } from './battleLog.js';

// catálogo fixo de condições (Fase 8, db/031_patch_combat_conditions.sql) --
// fórmula/catálogo em vez de texto livre, mesmo espírito de STATUS_STATS
// (characterSheet.js). Só o mestre aplica/remove (ver RPCs abaixo).
export const CONDITION_TYPES = [
  { key: 'envenenado', label: 'Envenenado', icon: '☠', color: '#4ade80' },
  { key: 'atordoado', label: 'Atordoado', icon: '💫', color: '#ffd93d' },
  { key: 'sangrando', label: 'Sangrando', icon: '🩸', color: '#ff5a5a' },
  { key: 'queimando', label: 'Queimando', icon: '🔥', color: '#ff8a4c' },
  { key: 'congelado', label: 'Congelado', icon: '❄', color: '#5ad4ff' },
  { key: 'amedrontado', label: 'Amedrontado', icon: '😨', color: '#b98bff' },
  { key: 'cego', label: 'Cego', icon: '🙈', color: '#9db4c7' },
  { key: 'imobilizado', label: 'Imobilizado', icon: '⛓', color: '#c9b878' },
];

export async function getCombatState(campaignId) {
  const { data, error } = await supabase.from('campaign_combat').select('*').eq('campaign_id', campaignId).maybeSingle();
  if (error) throw error;
  return data || { campaign_id: campaignId, active: false, round: 1, turns_passed_this_round: 0, fixed_initiative: false, current_turn_id: null };
}

export async function getParticipants(campaignId) {
  const { data, error } = await supabase.from('combat_participants').select('*').eq('campaign_id', campaignId).order('position');
  if (error) throw error;
  return data;
}

export function subscribeCombat(campaignId, onChange) {
  return supabase
    .channel('combat-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'combat_participants', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_combat', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .subscribe();
}

export async function startCombat(campaignId) {
  const { error } = await supabase
    .from('campaign_combat')
    .upsert({ campaign_id: campaignId, active: true, round: 1, turns_passed_this_round: 0, fixed_initiative: false, current_turn_id: null });
  if (error) throw error;
}

export async function endCombat(campaignId) {
  const { error: e1 } = await supabase.from('combat_participants').delete().eq('campaign_id', campaignId);
  if (e1) throw e1;
  // log de batalha é só da luta ATUAL -- some junto com os participantes.
  const { error: e0 } = await supabase.from('battle_log').delete().eq('campaign_id', campaignId);
  if (e0) throw e0;
  const { error: e2 } = await supabase
    .from('campaign_combat')
    .upsert({ campaign_id: campaignId, active: false, round: 1, turns_passed_this_round: 0, fixed_initiative: false, current_turn_id: null });
  if (e2) throw e2;
}

// "Passar o turno" -- quem está primeiro na lista vai pro final, todo
// mundo sobe uma posição. Rodada != turno: uma rodada só fecha depois
// que TODOS os participantes já tiveram seu turno passado uma vez
// (turns_passed_this_round chega no total de participantes) -- aí a
// rodada avança sozinha e a contagem de turnos zera de novo.
// `newOrder` já vem pronto (rotacionado) de quem chamou -- não
// recalcula aqui pra não rotacionar de novo em cima da atualização
// otimista que a tela já aplicou nos mesmos objetos.
//
// As posições são gravadas ANTES do update de campaign_combat (não em
// paralelo com Promise.all) de propósito: o trigger de aviso de turno do
// Discord (db/033_patch_discord_turn_notify.sql) lê "quem está na
// position=0" assim que campaign_combat muda -- se as duas escritas
// disparassem juntas, o trigger podia rodar antes da rotação de posições
// confirmar no banco e anunciar o participante ERRADO (o de antes de
// passar o turno, não o novo). Esperar as posições confirmarem primeiro
// garante que o trigger sempre vê a ordem já rotacionada.
export async function passTurn(campaignId, newOrder, combatState) {
  if (newOrder.length === 0) return;
  const posResults = await Promise.all(newOrder.map((p, i) => supabase.from('combat_participants').update({ position: i }).eq('id', p.id)));
  const posFailed = posResults.find((r) => r.error);
  if (posFailed) throw posFailed.error;

  const turnsPassed = (combatState.turns_passed_this_round || 0) + 1;
  const cycleComplete = turnsPassed >= newOrder.length;
  const nextState = cycleComplete
    ? { round: combatState.round + 1, turns_passed_this_round: 0 }
    : { turns_passed_this_round: turnsPassed };
  const { error } = await supabase
    .from('campaign_combat')
    .update({ ...nextState, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId);
  if (error) throw error;
}

// Variante de "passar o turno" pro modo iniciativa fixa -- não mexe em
// nenhuma position (a lista fica parada), só avança o ponteiro de
// quem tem a vez (current_turn_id) -- a borda verde caminha sozinha.
export async function passTurnFixed(campaignId, nextTurnId, participantCount, combatState) {
  const turnsPassed = (combatState.turns_passed_this_round || 0) + 1;
  const cycleComplete = turnsPassed >= participantCount;
  const nextState = cycleComplete
    ? { round: combatState.round + 1, turns_passed_this_round: 0 }
    : { turns_passed_this_round: turnsPassed };
  const { error } = await supabase
    .from('campaign_combat')
    .update({ ...nextState, current_turn_id: nextTurnId, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId);
  if (error) throw error;
}

// mestre ou jogador -- validado dentro da função (RPC SECURITY
// DEFINER, ver db/018_patch_combat_fixed_initiative.sql).
export async function toggleFixedInitiative(campaignId) {
  const { error } = await supabase.rpc('toggle_fixed_initiative', { p_campaign_id: campaignId });
  if (error) throw error;
}

// só o mestre (validado dentro da RPC security definer, ver
// db/031_patch_combat_conditions.sql) -- duração em rodadas, vazia/null =
// manual (só some quando o mestre clicar pra remover).
export async function applyCondition(participantId, conditionKey, durationRounds) {
  const { error } = await supabase.rpc('apply_combat_condition', {
    p_participant_id: participantId,
    p_condition_key: conditionKey,
    p_duration_rounds: durationRounds ?? null,
  });
  if (error) throw error;
}

export async function removeCondition(participantId, conditionId) {
  const { error } = await supabase.rpc('remove_combat_condition', { p_participant_id: participantId, p_condition_id: conditionId });
  if (error) throw error;
}

// hiddenMode: 'visible' | 'countdown' | 'always'
// Pra NPC (characterId nulo), hpCurrent/staminaCurrent/staminaMax vêm
// digitados pelo mestre. Pra personagem vinculado, quem chama já deve
// ter puxado esses valores da ficha (characterSheet.js) -- HP e
// Estamina de personagem são persistentes, não é o combate que decide
// o valor inicial.
export async function addParticipant(
  campaignId,
  { characterId, displayName, team, hpMax, hpCurrent, staminaMax, staminaCurrent, initiative, hiddenMode, revealInRounds, currentRound, avatarUrl, damage },
  position,
) {
  const hidden = hiddenMode !== 'visible';
  const reveal_at_round = hiddenMode === 'countdown' ? currentRound + Math.max(1, revealInRounds || 1) : null;
  const { error } = await supabase.from('combat_participants').insert({
    campaign_id: campaignId,
    character_id: characterId || null,
    display_name: displayName,
    team,
    hp_current: hpCurrent ?? hpMax,
    hp_max: hpMax,
    stamina_current: staminaCurrent ?? staminaMax ?? 0,
    stamina_max: staminaMax ?? 0,
    initiative: initiative === '' || initiative === null || initiative === undefined ? null : initiative,
    position,
    hidden,
    reveal_at_round,
    manually_revealed: false,
    avatar_url: avatarUrl || null,
    damage: damage || null,
  });
  if (error) throw error;
  logEvent(campaignId, { type: 'entrada', participantName: displayName, actorCharacterId: characterId || null }).catch(() => {});
}

// dano de NPC -- texto livre digitado pelo mestre (ver db/023). Se o
// participante está vinculado a um NPC do banco (ver db/024), grava
// também lá -- mesma lógica de HP: mantém o valor padrão do NPC
// atualizado pra próxima vez que ele for usado.
export async function updateParticipantDamage(id, damage, characterId) {
  const writes = [supabase.from('combat_participants').update({ damage }).eq('id', id)];
  if (characterId) writes.push(supabase.from('characters').update({ npc_damage: damage }).eq('id', characterId));
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export async function removeParticipant(id) {
  const { data: row } = await supabase.from('combat_participants').select('campaign_id, display_name, character_id').eq('id', id).maybeSingle();
  const { error } = await supabase.from('combat_participants').delete().eq('id', id);
  if (error) throw error;
  if (row) logEvent(row.campaign_id, { type: 'saida', participantName: row.display_name, actorCharacterId: row.character_id }).catch(() => {});
}

// Pra participante vinculado a personagem, grava também em
// characters.hp_current -- a ficha é a fonte única de verdade, o
// combate só reflete/edita ela em tempo real.
export async function updateParticipantHp(id, hpCurrent, characterId) {
  // consulta o valor anterior antes de escrever, só pra saber o delta pro
  // log de batalha (dano vs cura) -- não bloqueia a UI otimista, que já
  // atualizou a tela antes de chamar esta função.
  const { data: prevRow } = await supabase.from('combat_participants').select('campaign_id, display_name, hp_current').eq('id', id).maybeSingle();
  const writes = [supabase.from('combat_participants').update({ hp_current: hpCurrent }).eq('id', id)];
  if (characterId) writes.push(supabase.from('characters').update({ hp_current: hpCurrent }).eq('id', characterId));
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  if (prevRow && prevRow.hp_current !== hpCurrent) {
    const delta = hpCurrent - prevRow.hp_current;
    logEvent(prevRow.campaign_id, {
      type: delta < 0 ? 'dano' : 'cura',
      participantName: prevRow.display_name,
      actorCharacterId: characterId || null,
      amount: Math.abs(delta),
      detail: 'hp',
    }).catch(() => {});
  }
}

export async function updateParticipantStamina(id, staminaCurrent, characterId) {
  const { data: prevRow } = await supabase.from('combat_participants').select('campaign_id, display_name, stamina_current').eq('id', id).maybeSingle();
  const writes = [supabase.from('combat_participants').update({ stamina_current: staminaCurrent }).eq('id', id)];
  if (characterId) writes.push(supabase.from('characters').update({ estamina_current: staminaCurrent }).eq('id', characterId));
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
  if (prevRow && prevRow.stamina_current !== staminaCurrent) {
    const delta = staminaCurrent - prevRow.stamina_current;
    logEvent(prevRow.campaign_id, {
      type: delta < 0 ? 'dano' : 'cura',
      participantName: prevRow.display_name,
      actorCharacterId: characterId || null,
      amount: Math.abs(delta),
      detail: 'estamina',
    }).catch(() => {});
  }
}

export async function updateParticipantInitiative(id, initiative) {
  const { error } = await supabase.from('combat_participants').update({ initiative }).eq('id', id);
  if (error) throw error;
}

export async function forceReveal(id) {
  const { error } = await supabase.from('combat_participants').update({ manually_revealed: true }).eq('id', id);
  if (error) throw error;
}

export async function hideAgain(id) {
  const { error } = await supabase.from('combat_participants').update({ manually_revealed: false }).eq('id', id);
  if (error) throw error;
}

// grava a ordem inteira de uma vez (posições 0,1,2,... na ordem dada)
// -- chamado depois de um drag-and-drop soltar num novo lugar.
export async function reorderParticipants(orderedIds) {
  await Promise.all(orderedIds.map((id, i) => supabase.from('combat_participants').update({ position: i }).eq('id', id)));
}

export async function setPlayerCombatPermission(profileId, field, value) {
  const { error } = await supabase.from('profiles').update({ [field]: value }).eq('id', profileId);
  if (error) throw error;
}

// true se esse participante deveria aparecer pro jogador `viewerProfile`
// agora (mestre sempre vê tudo -- essa função só é chamada pra jogador).
export function isVisibleToPlayer(participant, viewerProfile, myCharacterId, combatRound) {
  if (participant.character_id && participant.character_id === myCharacterId) return true; // sempre vê a própria entrada
  if (viewerProfile.can_see_hidden_initiative) return true;
  if (!participant.hidden) return true;
  if (participant.manually_revealed) return true;
  if (participant.reveal_at_round !== null && combatRound >= participant.reveal_at_round) return true;
  return false;
}
