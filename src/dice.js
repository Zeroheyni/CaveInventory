// Fase 8 — camada de dados da rolagem de dados. Ver db/029_patch_dice_rolls.sql.
// Sem servidor calculando o resultado (não é dado sensível de verdade, é
// jogo de mesa) -- o client rola com Math.random e só grava o resultado.
import { supabase } from './supabaseClient.js';

const DICE_SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

export function rollValues(die, qty) {
  const sides = DICE_SIDES[die];
  return Array.from({ length: qty }, () => 1 + Math.floor(Math.random() * sides));
}

export async function rollDice(campaignId, rollerId, rollerName, die, qty, modifier) {
  const results = rollValues(die, qty);
  const total = results.reduce((a, b) => a + b, 0) + modifier;
  const { error } = await supabase.from('dice_rolls').insert({
    campaign_id: campaignId,
    roller_id: rollerId,
    roller_name: rollerName,
    die,
    qty,
    modifier,
    results,
    total,
  });
  if (error) throw error;
}

export async function listRecentRolls(campaignId, limit = 50) {
  const { data, error } = await supabase
    .from('dice_rolls')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export function subscribeDiceRolls(campaignId, onChange) {
  return supabase
    .channel('dice-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dice_rolls', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .subscribe();
}

export async function clearRolls(campaignId) {
  const { error } = await supabase.from('dice_rolls').delete().eq('campaign_id', campaignId);
  if (error) throw error;
}
