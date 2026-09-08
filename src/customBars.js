// Fase 8 (extra) — barra customizada por personagem, igual HP/Estamina
// mas definida pelo mestre. Ver db/041_patch_custom_bars.sql pro porquê
// de ser duas tabelas: custom_bars (definição: nome, cor, "personalizável"
// com máximo fixo, ou "fórmula" calculada a partir de um status, ex: 2x
// Força, Inteligência/2 -- só o mestre mexe) e character_custom_bars
// (atribuição a um personagem específico + valor atual, que o dono do
// personagem também pode ajustar).
import { supabase } from './supabaseClient.js';
import { STATUS_STATS } from './characterSheet.js';

export async function listCustomBars(campaignId) {
  const { data, error } = await supabase.from('custom_bars').select('*').eq('campaign_id', campaignId).order('created_at');
  if (error) throw error;
  return data;
}

export async function createCustomBar(campaignId, { name, color, mode, manualMax, formulaStat, formulaOp, formulaValue }) {
  const { data, error } = await supabase
    .from('custom_bars')
    .insert({
      campaign_id: campaignId,
      name,
      color,
      mode,
      manual_max: mode === 'manual' ? manualMax : null,
      formula_stat: mode === 'formula' ? formulaStat : null,
      formula_op: mode === 'formula' ? formulaOp : null,
      formula_value: mode === 'formula' ? formulaValue : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCustomBar(id) {
  const { error } = await supabase.from('custom_bars').delete().eq('id', id);
  if (error) throw error;
}

// todas as atribuições da campanha de uma vez, com a definição
// embutida -- usado pelo combate (várias fichas na tela ao mesmo tempo).
// Duas queries + join no client (em vez de embedding do PostgREST,
// `select('*, bar:custom_bars(*)')`) -- sem login de teste disponível
// nesse ambiente pra confirmar a sintaxe de embedding na hora, então
// fica com o padrão simples/garantido que o resto do projeto já usa.
export async function listCharacterCustomBars(campaignId) {
  const [{ data: assignments, error: e1 }, { data: bars, error: e2 }] = await Promise.all([
    supabase.from('character_custom_bars').select('*').eq('campaign_id', campaignId),
    supabase.from('custom_bars').select('*').eq('campaign_id', campaignId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const barsById = Object.fromEntries((bars || []).map((b) => [b.id, b]));
  return (assignments || []).map((a) => ({ ...a, bar: barsById[a.custom_bar_id] }));
}

// só de UM personagem -- usado pela ficha.
export async function listCharacterCustomBarsFor(characterId) {
  const { data: assignments, error } = await supabase.from('character_custom_bars').select('*').eq('character_id', characterId);
  if (error) throw error;
  const barIds = [...new Set((assignments || []).map((a) => a.custom_bar_id))];
  if (barIds.length === 0) return [];
  const { data: bars, error: e2 } = await supabase.from('custom_bars').select('*').in('id', barIds);
  if (e2) throw e2;
  const barsById = Object.fromEntries((bars || []).map((b) => [b.id, b]));
  return assignments.map((a) => ({ ...a, bar: barsById[a.custom_bar_id] }));
}

export async function assignCustomBar(campaignId, customBarId, characterId, initialValue = 0) {
  const { error } = await supabase
    .from('character_custom_bars')
    .insert({ campaign_id: campaignId, custom_bar_id: customBarId, character_id: characterId, current_value: initialValue });
  if (error) throw error;
}

export async function unassignCustomBar(id) {
  const { error } = await supabase.from('character_custom_bars').delete().eq('id', id);
  if (error) throw error;
}

export async function updateCharacterCustomBarValue(id, value) {
  const { error } = await supabase.from('character_custom_bars').update({ current_value: value }).eq('id', id);
  if (error) throw error;
}

// máximo da barra -- fixo (modo 'manual') ou calculado ao vivo a partir
// de um status do personagem (modo 'formula'), mesmo espírito de
// hpMax()/estaminaMax() em characterSheet.js (nunca fica salvo, sempre
// recalcula em cima do status bruto atual).
export function customBarMax(bar, character) {
  if (!bar) return 0;
  if (bar.mode === 'manual') return bar.manual_max || 0;
  const statValue = (character && character[bar.formula_stat]) || 0;
  const factor = bar.formula_value || 1;
  return Math.round(bar.formula_op === 'div' ? statValue / factor : statValue * factor);
}

export function customBarFormulaLabel(bar) {
  if (!bar) return '';
  if (bar.mode === 'manual') return `máx ${bar.manual_max ?? 0} (fixo)`;
  const stat = STATUS_STATS.find((s) => s.key === bar.formula_stat);
  const statLabel = stat ? stat.label : bar.formula_stat;
  return bar.formula_op === 'div' ? `${statLabel} ÷ ${bar.formula_value}` : `${statLabel} × ${bar.formula_value}`;
}
