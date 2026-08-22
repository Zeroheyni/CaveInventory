import { supabase } from './supabaseClient.js';

export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCampaign(campaignId) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createCampaign(name, username) {
  const { data, error } = await supabase
    .rpc('create_campaign', { p_name: name, p_username: username })
    .single();
  if (error) throw error;
  return data;
}

export async function joinCampaign(inviteCode, username) {
  const { data, error } = await supabase.rpc('join_campaign', {
    p_invite_code: inviteCode,
    p_username: username,
  });
  if (error) throw error;
  return data;
}
