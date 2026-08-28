// Fase 8 — camada de dados da rolagem de dados. Ver db/029_patch_dice_rolls.sql.
// Sem servidor calculando o resultado (não é dado sensível de verdade, é
// jogo de mesa) -- o client rola com Math.random e só grava o resultado.
import { supabase } from './supabaseClient.js';

// presets fixos + dado customizado ("d" + valor digitado, ex: d132) --
// qualquer "d<N>" é aceito, não só esses; ver db/036_patch_dice_d100_custom.sql
// (o check da tabela virou validação de formato, não lista fixa).
export const DICE_PRESETS = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

export function sidesFromDie(die) {
  const m = /^d(\d+)$/.exec(die || '');
  return m ? parseInt(m[1], 10) : 0;
}

// normaliza o valor digitado no campo de dado customizado -- 2 a 1000
// lados (bate com o check de formato, "d" + até 4 dígitos). Retorna
// null se o valor não faz sentido (vazio, 0, negativo, etc).
export function normalizeCustomDie(rawValue) {
  const n = parseInt(rawValue, 10);
  if (!Number.isFinite(n) || n < 2 || n > 1000) return null;
  return 'd' + n;
}

export function rollValues(die, qty) {
  const sides = sidesFromDie(die);
  return Array.from({ length: qty }, () => 1 + Math.floor(Math.random() * sides));
}

// label opcional (ex: "Força") -- usado pelo botão de teste de atributo
// da ficha (db/039_patch_dice_roll_label.sql); null pra rolagem solta
// normal. Também é o que aparece (ou não) no aviso de rolagem no Discord.
export async function rollDice(campaignId, rollerId, rollerName, die, qty, modifier, label) {
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
    label: label || null,
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
