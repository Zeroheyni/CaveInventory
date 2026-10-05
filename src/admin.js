import { supabase } from './supabaseClient.js';
import { requestDiscordSync, setPlayerDiscordId, setCharacterDiscordChannelRpc, createCampaignRpc, deleteCampaignRpc } from './accounts.js';

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
  // painel admin (contas de jogador: canal do Discord, Discord user id,
  // excluir conta) -- NPC do banco (is_npc=true, owner_id=null) não é
  // conta de jogador, não deve aparecer aqui (ver banco de NPCs, Fase 6).
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_npc', false)
    .order('name');
  if (error) throw error;
  return data;
}

// ---- vínculo com o bot do Discord (Fase 3) ----

export async function listDiscordConfigs() {
  const { data, error } = await supabase.from('discord_config').select('campaign_id, channel_id, combat_channel_id');
  if (error) throw error;
  return data;
}

export async function setCampaignDiscordChannel(campaignId, channelId) {
  const { error } = await supabase.from('discord_config').upsert({ campaign_id: campaignId, channel_id: channelId });
  if (error) throw error;
  // dispara uma sincronização imediata pra dar feedback na hora ao mestre
  await requestDiscordSync('public', campaignId);
}

// canal DEDICADO do aviso de turno (Fase 8, db/033_patch_discord_turn_notify.sql)
// -- separado do canal de sync de inventário/transporte acima. Sem sync
// imediata pra disparar aqui (não tem "estado atual" pra sincronizar, só
// dispara quando um turno passa de verdade).
export async function setCampaignCombatChannel(campaignId, channelId) {
  const { error } = await supabase.from('discord_config').upsert({ campaign_id: campaignId, combat_channel_id: channelId });
  if (error) throw error;
}

// ID da conta Discord do jogador (Fase 8) -- cadastrado pelo mestre, pra o
// bot poder @mencionar quando chega a vez dele no combate.
export async function setPlayerDiscordUserId(profileId, discordUserId) {
  await setPlayerDiscordId(profileId, discordUserId);
}

export async function listCharacterDiscordConfigs(characterIds) {
  if (!characterIds.length) return [];
  const { data, error } = await supabase
    .from('discord_character_config')
    .select('character_id, channel_id')
    .in('character_id', characterIds);
  if (error) throw error;
  return data;
}

export async function setCharacterDiscordChannel(characterId, channelId) {
  await setCharacterDiscordChannelRpc(characterId, channelId); // grava e já pede a sincronização
}

export async function createCampaignAsAdmin(name, masterId = null) {
  return createCampaignRpc(name, masterId);
}

export async function deleteCampaignAsAdmin(campaignId) {
  await deleteCampaignRpc(campaignId);
}

// Fora de sessão, o Discord só atualiza no clique manual de "🔄 atualizar"
// (menos ruído/edições constantes no canal); em sessão, volta a sincronizar
// em tempo real a cada mudança -- ver db/014_patch_discord_live_session.sql.
export async function setCampaignLiveSession(campaignId, live) {
  const { error } = await supabase.from('campaigns').update({ discord_live_session: live }).eq('id', campaignId);
  if (error) throw error;
  if (live) await syncCampaignAll(campaignId);
}

// Força uma sincronização completa (área pública + cada personagem
// vinculado) de uma vez -- chamado ao ligar a sessão, pra corrigir o que
// ficou desatualizado sem esperar a próxima edição de cada personagem.
// (pedido pelo banco com o segredo do Vault: vale pra qualquer mestre DA mesa, db/065)
export async function syncCampaignAll(campaignId) {
  await requestDiscordSync('campaign', campaignId);
}

// contagem de membros por campanha (campaign_members; o RLS já limita ao que a conta enxerga)
export async function countMembersByCampaign() {
  const { data, error } = await supabase.from('campaign_members').select('campaign_id');
  if (error) throw error;
  const m = new Map();
  for (const r of data || []) m.set(r.campaign_id, (m.get(r.campaign_id) || 0) + 1);
  return m;
}
