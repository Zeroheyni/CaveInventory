// Camada de dados do rastreador de combate (Fase 4) -- ver
// db/015_patch_combat.sql. Sem rolagem/dano automático ainda (isso
// depende da ficha de status da Fase 5) -- aqui é só HP + ordem de
// iniciativa, que o mestre e os jogadores ajustam manualmente.
import { supabase } from './supabaseClient.js';

export async function getCombatState(campaignId) {
  const { data, error } = await supabase.from('campaign_combat').select('*').eq('campaign_id', campaignId).maybeSingle();
  if (error) throw error;
  return data || { campaign_id: campaignId, active: false, round: 1 };
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
  const { error } = await supabase.from('campaign_combat').upsert({ campaign_id: campaignId, active: true, round: 1 });
  if (error) throw error;
}

export async function endCombat(campaignId) {
  const { error: e1 } = await supabase.from('combat_participants').delete().eq('campaign_id', campaignId);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from('campaign_combat').upsert({ campaign_id: campaignId, active: false, round: 1 });
  if (e2) throw e2;
}

export async function advanceRound(campaignId, currentRound) {
  const { error } = await supabase.from('campaign_combat').update({ round: currentRound + 1, updated_at: new Date().toISOString() }).eq('campaign_id', campaignId);
  if (error) throw error;
}

// hiddenMode: 'visible' | 'countdown' | 'always'
export async function addParticipant(campaignId, { characterId, displayName, team, hpMax, initiative, hiddenMode, revealInRounds, currentRound }, position) {
  const hidden = hiddenMode !== 'visible';
  const reveal_at_round = hiddenMode === 'countdown' ? currentRound + Math.max(1, revealInRounds || 1) : null;
  const { error } = await supabase.from('combat_participants').insert({
    campaign_id: campaignId,
    character_id: characterId || null,
    display_name: displayName,
    team,
    hp_current: hpMax,
    hp_max: hpMax,
    initiative: initiative === '' || initiative === null || initiative === undefined ? null : initiative,
    position,
    hidden,
    reveal_at_round,
    manually_revealed: false,
  });
  if (error) throw error;
}

export async function removeParticipant(id) {
  const { error } = await supabase.from('combat_participants').delete().eq('id', id);
  if (error) throw error;
}

export async function updateParticipantHp(id, hpCurrent) {
  const { error } = await supabase.from('combat_participants').update({ hp_current: hpCurrent }).eq('id', id);
  if (error) throw error;
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
