// Fase 8 — camada de dados do log de batalha. Ver db/030_patch_battle_log.sql.
// Mecanismo único de eventos (coluna `type`), gravado direto pelas mesmas
// chamadas que já mexem em combat_participants (src/combat.js) e também
// pelas RPCs de condição (db/031) via `insert` interno na função.
import { supabase } from './supabaseClient.js';

export async function logEvent(campaignId, { type, participantName, actorCharacterId, amount, detail }) {
  const { error } = await supabase.from('battle_log').insert({
    campaign_id: campaignId,
    type,
    participant_name: participantName,
    actor_character_id: actorCharacterId || null,
    amount: amount ?? null,
    detail: detail || null,
  });
  if (error) throw error;
}

export async function listRecentEvents(campaignId, limit = 100) {
  const { data, error } = await supabase
    .from('battle_log')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export function subscribeBattleLog(campaignId, onChange) {
  return supabase
    .channel('battlelog-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_log', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .subscribe();
}

export async function clearBattleLog(campaignId) {
  const { error } = await supabase.from('battle_log').delete().eq('campaign_id', campaignId);
  if (error) throw error;
}
