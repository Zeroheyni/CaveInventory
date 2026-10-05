import { supabase } from './supabaseClient.js';
import { listCampaignMembers, setMemberFlags } from './accounts.js';

export async function fetchPublicArea(campaignId) {
  const [items, containers, compartments, currencyRes, permissions, profiles] = await Promise.all([
    supabase.from('public_items').select('*').eq('campaign_id', campaignId).order('position'),
    supabase.from('public_containers').select('*').eq('campaign_id', campaignId).order('position'),
    supabase.from('public_compartments').select('*').eq('campaign_id', campaignId).order('created_at'),
    supabase.from('public_currency').select('*').eq('campaign_id', campaignId).maybeSingle(),
    supabase.from('compartment_permissions').select('*'),
    listCampaignMembers(campaignId),
  ]);
  for (const r of [items, containers, compartments, permissions]) if (r.error) throw r.error;
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
    profiles,
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_members', filter: `campaign_id=eq.${campaignId}` }, onChange)
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

// ---- capacidade máxima do público (só o mestre mexe) ----
export async function updateCampaignMaxCarga(campaignId, value) {
  const { error } = await supabase.from('campaigns').update({ max_carga_publico: value }).eq('id', campaignId);
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
export async function setTransportAdmin(campaignId, userId, value) {
  await setMemberFlags(campaignId, userId, { is_transport_admin: value });
}

// ---- mover entre Pessoal <-> Público ----
// uma conta pode ter vários personagens na mesma campanha: quem chama diz QUAL (characterId)
export async function getMyCharacter(campaignId, userId, characterId) {
  let q = supabase.from('characters').select('*').eq('campaign_id', campaignId).eq('owner_id', userId);
  if (characterId) q = q.eq('id', characterId);
  const { data, error } = await q.order('id').limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}
// acrescenta UMA entrada (item ou recipiente) ao inventário pessoal, direto
// na linha atual do banco (db/048). Antes o app regravava o `data` inteiro
// a partir de uma cópia lida antes -- se o inventário mudasse nesse meio
// tempo, a cópia velha sobrescrevia tudo.
export async function appendPersonalEntry(kind, entry, characterId = null) {
  const { error } = await supabase.rpc('append_personal_inventory_entry', { p_kind: kind, p_entry: entry, p_character_id: characterId });
  if (error) throw error;
}

// ---- transferir moeda: pessoal -> avulso (público) ou pessoal -> outro jogador ----
// débito+crédito atômicos via função do banco (db/010_patch_currency_transfer.sql) —
// evita transferência "pela metade" que uma escrita em duas etapas do cliente sofre.
export async function listCampaignPlayers(campaignId) {
  const { data, error } = await supabase.rpc('list_campaign_players', { p_campaign_id: campaignId });
  if (error) throw error;
  return data;
}
export async function transferCurrencyRpc(fromCharacterId, { toCharacterId = null, toAvulso = false }, amounts) {
  const { error } = await supabase.rpc('transfer_currency', {
    p_from_character_id: fromCharacterId,
    p_to_character_id: toCharacterId,
    p_to_avulso: toAvulso,
    p_bronze: amounts.bronze || 0,
    p_silver: amounts.silver || 0,
    p_gold: amounts.gold || 0,
    p_platinum: amounts.platinum || 0,
  });
  if (error) throw error;
}
