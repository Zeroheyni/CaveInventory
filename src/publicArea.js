import { supabase } from './supabaseClient.js';

export async function fetchPublicArea(campaignId) {
  const [items, containers, compartments, currencyRes, permissions, profiles] = await Promise.all([
    supabase.from('public_items').select('*').eq('campaign_id', campaignId).order('position'),
    supabase.from('public_containers').select('*').eq('campaign_id', campaignId).order('position'),
    supabase.from('public_compartments').select('*').eq('campaign_id', campaignId).order('created_at'),
    supabase.from('public_currency').select('*').eq('campaign_id', campaignId).maybeSingle(),
    supabase.from('compartment_permissions').select('*'),
    supabase.from('profiles').select('*').eq('campaign_id', campaignId),
  ]);
  for (const r of [items, containers, compartments, permissions, profiles]) if (r.error) throw r.error;
  if (currencyRes.error) throw currencyRes.error;

  let currency = currencyRes.data;
  if (!currency) {
    const { data: created, error } = await supabase
      .from('public_currency')
      .insert({ campaign_id: campaignId })
      .select()
      .single();
    if (error) throw error;
    currency = created;
  }

  return {
    items: items.data,
    containers: containers.data,
    compartments: compartments.data,
    currency,
    permissions: permissions.data,
    profiles: profiles.data,
  };
}

export function subscribePublicArea(campaignId, onChange) {
  const channel = supabase
    .channel('public-area-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_items', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_containers', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_compartments', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'public_currency', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'compartment_permissions' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .subscribe();
  return channel;
}

// ---- itens ----
export async function createPublicItem(payload) {
  const { data, error } = await supabase.from('public_items').insert(payload).select().single();
  if (error) throw error;
  return data;
}
export async function updatePublicItem(id, patch) {
  const { error } = await supabase
    .from('public_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
export async function deletePublicItem(id) {
  const { error } = await supabase.from('public_items').delete().eq('id', id);
  if (error) throw error;
}

// ---- recipientes ----
export async function createPublicContainer(payload) {
  const { data, error } = await supabase.from('public_containers').insert(payload).select().single();
  if (error) throw error;
  return data;
}
export async function updatePublicContainer(id, patch) {
  const { error } = await supabase
    .from('public_containers')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
export async function deletePublicContainer(id) {
  const { error } = await supabase.from('public_containers').delete().eq('id', id);
  if (error) throw error;
}

// ---- compartimentos ----
export async function createCompartment(campaignId, name, userId) {
  const { data, error } = await supabase
    .from('public_compartments')
    .insert({ campaign_id: campaignId, name, created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data;
}
export async function updateCompartment(id, patch) {
  const { error } = await supabase
    .from('public_compartments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
export async function deleteCompartment(id) {
  const { error } = await supabase.from('public_compartments').delete().eq('id', id);
  if (error) throw error;
}

// ---- moeda pública (avulsa) ----
export async function updatePublicCurrency(campaignId, currency) {
  const { error } = await supabase
    .from('public_currency')
    .update({ ...currency, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId);
  if (error) throw error;
}

// ---- permissões de compartimento ----
export async function grantCompartmentPermission(compartmentId, userId, grantedBy) {
  const { error } = await supabase
    .from('compartment_permissions')
    .insert({ compartment_id: compartmentId, user_id: userId, granted_by: grantedBy });
  if (error) throw error;
}
export async function revokeCompartmentPermission(compartmentId, userId) {
  const { error } = await supabase
    .from('compartment_permissions')
    .delete()
    .eq('compartment_id', compartmentId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ---- transport admin ----
export async function setTransportAdmin(profileId, value) {
  const { error } = await supabase.from('profiles').update({ is_transport_admin: value }).eq('id', profileId);
  if (error) throw error;
}

// ---- mover entre Pessoal <-> Público ----
export async function getMyCharacter(campaignId, userId) {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function updateCharacterData(characterId, data) {
  const { error } = await supabase
    .from('characters')
    .update({ data, updated_at: new Date().toISOString() })
    .eq('id', characterId);
  if (error) throw error;
}
