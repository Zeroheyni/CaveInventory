// Magias personalizadas do Magic Learning (db/081, db/082): lista/cria/edita/apaga. O RLS já esconde as de família de quem não é da família
// e as pessoais (private_to) de quem não é o criador/mestre.
import { supabase } from './supabaseClient.js';
import { normalizeCustomSpell } from './systems/msl-spells.js';

export async function listCustomSpells(campaignId) {
  const { data, error } = await supabase.from('msl_custom_spells').select('id, family, private_to, created_by, data').eq('campaign_id', campaignId).order('created_at');
  if (error) throw error;
  return (data || []).map((r) => ({ ...r.data, id: 'c_' + r.id, dbId: r.id, familia: r.family || '', privateTo: r.private_to || null, createdBy: r.created_by || null, custom: true }));
}

// opts: { userId, privateTo } -- jogador sempre cria "pessoal" (privateTo = id do personagem dele, sem família)
export async function saveCustomSpell(campaignId, spell, family, dbId, opts = {}) {
  const clean = normalizeCustomSpell(spell);
  if (!clean.nome) throw new Error('dê um nome à magia');
  const payload = { family: opts.privateTo ? null : family && family.trim() ? family.trim() : null, data: clean, updated_at: new Date().toISOString() };
  if (dbId) {
    const { error } = await supabase.from('msl_custom_spells').update(payload).eq('id', dbId);
    if (error) throw error;
    return dbId;
  }
  const row = { campaign_id: campaignId, ...payload, created_by: opts.userId || null, private_to: opts.privateTo || null };
  const { data, error } = await supabase.from('msl_custom_spells').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function deleteCustomSpell(dbId) {
  const { error } = await supabase.from('msl_custom_spells').delete().eq('id', dbId);
  if (error) throw error;
}
