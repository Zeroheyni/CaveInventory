// Contas por papel/campanha (db/062+). Uma conta de jogador tem vários personagens (de campanhas
// diferentes) e escolhe quem joga ao entrar; o papel (mestre/jogador) vem de `campaign_members`,
// por campanha. `profiles.is_superadmin` é o ADM.
import { supabase } from './supabaseClient.js';

// ---- leitura ----

export async function listMyMemberships(userId) {
  const { data, error } = await supabase
    .from('campaign_members')
    .select('campaign_id, role, can_see_others_hp, can_see_hidden_initiative, is_transport_admin, campaigns(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data || []).filter((m) => m.campaigns);
}

// personagens (não-NPC) que a conta joga, com a campanha de cada um
export async function listMyCharacters(userId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, campaign_id, avatar_url, level, xp, vitalidade, hp_current, hp_max_override, sheet_data, updated_at, campaigns(id, name)')
    .eq('owner_id', userId)
    .eq('is_npc', false)
    .order('name');
  if (error) throw error;
  return data || [];
}

// membros da campanha no formato de "perfil" que as telas já esperavam
// ({ id, username, role, can_see_*, is_transport_admin }), mas o papel e as permissões
// vêm de campaign_members (por mesa) em vez de profiles (global).
export async function listCampaignMembers(campaignId) {
  const { data, error } = await supabase.rpc('list_campaign_members', { p_campaign_id: campaignId });
  if (error) throw error;
  return (data || []).map((m) => ({
    id: m.user_id,
    username: m.username,
    role: m.role,
    can_see_others_hp: !!m.can_see_others_hp,
    can_see_hidden_initiative: !!m.can_see_hidden_initiative,
    is_transport_admin: !!m.is_transport_admin,
    discord_user_id: m.discord_user_id || null,
  }));
}

// ---- contexto efetivo ----

// O resto do app lê `profile.role` / `profile.campaign_id` / flags. Em vez de reescrever ~25 pontos,
// o router monta um perfil "efetivo" pra cada contexto (mesa + papel) e entrega no lugar do perfil bruto.
// `asPlayer` = a conta está JOGANDO um personagem (mesmo que seja mestre da mesa, ali ela é jogador).
export function effectiveProfile(profile, campaign, membership, { asPlayer = false } = {}) {
  const isMaster =
    !asPlayer &&
    (!!profile.is_superadmin || membership?.role === 'master' || campaign?.master_id === profile.id);
  return {
    ...profile,
    role: isMaster ? 'master' : 'player',
    campaign_id: campaign ? campaign.id : null,
    can_see_others_hp: isMaster || !!membership?.can_see_others_hp,
    can_see_hidden_initiative: isMaster || !!membership?.can_see_hidden_initiative,
    is_transport_admin: !!membership?.is_transport_admin,
  };
}

// ---- escritas (RPCs de db/065 e db/066) ----

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const setMemberFlags = (campaignId, userId, flags) =>
  rpc('set_member_flags', {
    p_campaign_id: campaignId,
    p_user_id: userId,
    p_can_see_others_hp: flags.can_see_others_hp ?? null,
    p_can_see_hidden_initiative: flags.can_see_hidden_initiative ?? null,
    p_is_transport_admin: flags.is_transport_admin ?? null,
  });
export const createCampaignRpc = (name, masterId = null) => rpc('master_create_campaign', { p_name: name, p_master_id: masterId });
export const deleteCampaignRpc = (campaignId) => rpc('master_delete_campaign', { p_campaign_id: campaignId });
export const addMemberByNickname = (campaignId, nickname) => rpc('add_member_by_nickname', { p_campaign_id: campaignId, p_nickname: nickname });
export const removeMember = (campaignId, userId) => rpc('remove_member', { p_campaign_id: campaignId, p_user_id: userId });
export const createCharacterFor = (campaignId, name, ownerId) =>
  rpc('master_create_character', { p_campaign_id: campaignId, p_name: name, p_owner_id: ownerId });
export const assignCharacterOwner = (characterId, ownerId) => rpc('assign_character_owner', { p_character_id: characterId, p_owner_id: ownerId });
export const deleteCharacterRpc = (characterId) => rpc('master_delete_character', { p_character_id: characterId });
export const setCampaignMaster = (campaignId, masterId) => rpc('admin_set_campaign_master', { p_campaign_id: campaignId, p_master_id: masterId });
export const setPlayerDiscordId = (userId, discordUserId) => rpc('set_player_discord_id', { p_user_id: userId, p_discord_user_id: discordUserId });
export const setCharacterDiscordChannelRpc = (characterId, channelId) =>
  rpc('set_character_discord_channel', { p_character_id: characterId, p_channel_id: channelId });
export const requestDiscordSync = (kind, id) => rpc('request_discord_sync', { p_kind: kind, p_id: id });

// ---- Edge Function account-admin (service role; cria/exclui contas) ----

export async function accountAdmin(action, body) {
  const { data, error } = await supabase.functions.invoke('account-admin', { body: { action, ...body } });
  if (error) {
    // FunctionsHttpError traz a Response em error.context; a mensagem útil vem no JSON { error }
    let msg = error.message;
    try {
      const j = await error.context.json();
      if (j && j.error) msg = j.error;
    } catch (_) { /* mantém a mensagem genérica */ }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

export const createMasterAccount = (nickname, password) => accountAdmin('create_master', { nickname, password });
// conta de jogador NÃO é de mesa: campaignId é opcional (db/069); quem vincula à mesa é o personagem
export const createPlayerAccountFn = (nickname, password, campaignId = null) =>
  accountAdmin('create_player', { nickname, password, campaign_id: campaignId });
export async function listPlayerAccounts() {
  const { data, error } = await supabase.rpc('list_player_accounts');
  if (error) throw error;
  return data || [];
}
export const resetAccountPassword = (userId, password) => accountAdmin('reset_password', { user_id: userId, password });
export const setAccountKind = (userId, kind) => accountAdmin('set_account_kind', { user_id: userId, kind });
export const deleteAccount = (userId) => accountAdmin('delete_account', { user_id: userId });

// ---- última escolha de personagem (só conveniência, por navegador) ----

const lastKey = (userId) => 'cave.lastCharacter.' + userId;
export function rememberCharacter(userId, characterId) {
  try { localStorage.setItem(lastKey(userId), characterId); } catch (_) { /* sem storage: tudo bem */ }
}
export function lastCharacter(userId) {
  try { return localStorage.getItem(lastKey(userId)); } catch (_) { return null; }
}
export function forgetCharacter(userId) {
  try { localStorage.removeItem(lastKey(userId)); } catch (_) { /* idem */ }
}
