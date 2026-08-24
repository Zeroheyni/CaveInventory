// Camada de dados do rastreador de combate (Fase 4) -- ver
// db/015_patch_combat.sql. Sem rolagem/dano automático ainda (isso
// depende da ficha de status da Fase 5) -- aqui é só HP + ordem de
// iniciativa, que o mestre e os jogadores ajustam manualmente.
import { supabase } from './supabaseClient.js';

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
export async function passTurn(campaignId, newOrder, combatState) {
  if (newOrder.length === 0) return;
  const writes = newOrder.map((p, i) => supabase.from('combat_participants').update({ position: i }).eq('id', p.id));

  const turnsPassed = (combatState.turns_passed_this_round || 0) + 1;
  const cycleComplete = turnsPassed >= newOrder.length;
  const nextState = cycleComplete
    ? { round: combatState.round + 1, turns_passed_this_round: 0 }
    : { turns_passed_this_round: turnsPassed };
  writes.push(supabase.from('campaign_combat').update({ ...nextState, updated_at: new Date().toISOString() }).eq('campaign_id', campaignId));

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
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

// hiddenMode: 'visible' | 'countdown' | 'always'
// Pra NPC (characterId nulo), hpCurrent/staminaCurrent/staminaMax vêm
// digitados pelo mestre. Pra personagem vinculado, quem chama já deve
// ter puxado esses valores da ficha (characterSheet.js) -- HP e
// Estamina de personagem são persistentes, não é o combate que decide
// o valor inicial.
export async function addParticipant(
  campaignId,
  { characterId, displayName, team, hpMax, hpCurrent, staminaMax, staminaCurrent, initiative, hiddenMode, revealInRounds, currentRound, avatarUrl },
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
  });
  if (error) throw error;
}

export async function removeParticipant(id) {
  const { error } = await supabase.from('combat_participants').delete().eq('id', id);
  if (error) throw error;
}

// Pra participante vinculado a personagem, grava também em
// characters.hp_current -- a ficha é a fonte única de verdade, o
// combate só reflete/edita ela em tempo real.
export async function updateParticipantHp(id, hpCurrent, characterId) {
  const writes = [supabase.from('combat_participants').update({ hp_current: hpCurrent }).eq('id', id)];
  if (characterId) writes.push(supabase.from('characters').update({ hp_current: hpCurrent }).eq('id', characterId));
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export async function updateParticipantStamina(id, staminaCurrent, characterId) {
  const writes = [supabase.from('combat_participants').update({ stamina_current: staminaCurrent }).eq('id', id)];
  if (characterId) writes.push(supabase.from('characters').update({ estamina_current: staminaCurrent }).eq('id', characterId));
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
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
