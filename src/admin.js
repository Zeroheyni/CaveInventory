import { supabase } from './supabaseClient.js';

export async function listAllCampaigns() {
  const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listAllProfiles() {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  return data;
}

export async function listCharactersInCampaign(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createCampaignAsAdmin(name) {
  const { data, error } = await supabase.from('campaigns').insert({ name }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCampaignAsAdmin(campaignId) {
  const { error } = await supabase.from('campaigns').delete().eq('id', campaignId);
  if (error) throw error;
}
