// Magias personalizadas do Magic Learning (db/081): lista/cria/edita/apaga. O RLS já esconde as de família de quem não é da família.
import { supabase } from './supabaseClient.js';
import { normalizeCustomSpell } from './systems/msl-spells.js';

export async function listCustomSpells(campaignId) {
  const { data, error } = await supabase.from('msl_custom_spells').select('id, family, data').eq('campaign_id', campaignId).order('created_at');
  if (error) throw error;
  return (data || []).map((r) => ({ ...r.data, id: 'c_' + r.id, dbId: r.id, familia: r.family || '', custom: true }));
}

export async function saveCustomSpell(campaignId, spell, family, dbId) {
  const clean = normalizeCustomSpell(spell);
  if (!clean.nome) throw new Error('dê um nome à magia');
  const payload = { family: family && family.trim() ? family.trim() : null, data: clean, updated_at: new Date().toISOString() };
  if (dbId) {
    const { error } = await supabase.from('msl_custom_spells').update(payload).eq('id', dbId);
    if (error) throw error;
    return dbId;
  }
  const { data, error } = await supabase.from('msl_custom_spells').insert({ campaign_id: campaignId, ...payload }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteCustomSpell(dbId) {
  const { error } = await supabase.from('msl_custom_spells').delete().eq('id', dbId);
  if (error) throw error;
}
