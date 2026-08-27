// Fase 8 — camada de dados do diário de sessão. Ver
// db/032_patch_session_journal.sql. Por campanha (não por personagem) --
// só o mestre grava, todo mundo lê.
import { supabase } from './supabaseClient.js';

export async function listEntries(campaignId) {
  const { data, error } = await supabase
    .from('session_journal')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('session_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createEntry(campaignId, userId, { sessionDate, title, summary }) {
  const { error } = await supabase.from('session_journal').insert({
    campaign_id: campaignId,
    session_date: sessionDate,
    title,
    summary: summary || '',
    created_by: userId,
  });
  if (error) throw error;
}

export async function updateEntry(id, { sessionDate, title, summary }) {
  const { error } = await supabase
    .from('session_journal')
    .update({ session_date: sessionDate, title, summary: summary || '', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteEntry(id) {
  const { error } = await supabase.from('session_journal').delete().eq('id', id);
  if (error) throw error;
}

export function subscribeJournal(campaignId, onChange) {
  return supabase
    .channel('journal-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'session_journal', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .subscribe();
}
