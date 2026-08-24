// Camada de dados da ficha de personagem (Fase 5) -- ver
// db/016_patch_character_sheet.sql. Status e HP/Estamina são fonte
// única de verdade aqui -- o rastreador de combate (src/combat.js)
// grava de volta pra cá quando o participante tem character_id.
import { supabase } from './supabaseClient.js';

export const SHEET_FIELDS =
  'id, campaign_id, owner_id, name, avatar_url, level, xp, status_points_unspent, status_confirmed, ' +
  'vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao, hp_current, estamina_current, sheet_data';

export function hpMax(char) {
  return (char.vitalidade || 0) * 4;
}
export function estaminaMax(char) {
  return char.estamina || 0;
}
export function xpNeeded(level) {
  return 10 * level;
}
// classe da barra de HP (combat.css) por faixa de porcentagem --
// usada por ficha.js, masterFicha.js e combat.js, todos com a mesma
// barra .combat-hp-fill.
export function hpBarClass(pct) {
  if (pct < 20) return 'low';
  if (pct < 50) return 'mid';
  return '';
}
export function emptySheetData() {
  return { idade: '', genero: '', sexualidade: '', historia: '', modulos: [] };
}
export function sheetDataOf(char) {
  return { ...emptySheetData(), ...(char.sheet_data || {}) };
}

export async function getCharacterSheet(characterId) {
  const { data, error } = await supabase.from('characters').select(SHEET_FIELDS).eq('id', characterId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCampaignCharacterSheets(campaignId) {
  const { data, error } = await supabase.from('characters').select(SHEET_FIELDS).eq('campaign_id', campaignId).order('name');
  if (error) throw error;
  return data;
}

export function subscribeCharacterSheet(characterId, onChange) {
  return supabase
    .channel('sheet-' + characterId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${characterId}` }, onChange)
    .subscribe();
}

export function subscribeCampaignSheets(campaignId, onChange) {
  return supabase
    .channel('sheets-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .subscribe();
}

// ---- edição livre (bio, história, módulos, HP/estamina atuais, avatar) ----
export async function updateSheetData(characterId, sheetData) {
  const { error } = await supabase.from('characters').update({ sheet_data: sheetData }).eq('id', characterId);
  if (error) throw error;
}

export async function updateHpCurrent(characterId, hpCurrent) {
  const { error } = await supabase.from('characters').update({ hp_current: hpCurrent }).eq('id', characterId);
  if (error) throw error;
}

export async function updateEstaminaCurrent(characterId, estaminaCurrent) {
  const { error } = await supabase.from('characters').update({ estamina_current: estaminaCurrent }).eq('id', characterId);
  if (error) throw error;
}

export async function setAvatarUrl(characterId, url) {
  const { error } = await supabase.from('characters').update({ avatar_url: url }).eq('id', characterId);
  if (error) throw error;
}

export async function uploadAvatar(characterId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  // upsert:true, o método update() dedicado, e até apagar-e-reenviar
  // pro MESMO caminho batem numa inconsistência do storage nesse
  // ambiente (a exclusão some da listagem, mas o objeto físico
  // continua existindo por baixo, e o upload seguinte pro mesmo
  // caminho reclama "already exists") -- em vez de brigar com isso,
  // cada envio usa um nome de arquivo novo (nunca colide, sempre uma
  // inserção limpa). O arquivo antigo fica órfão no bucket -- sem
  // problema pra esse uso (poucas fotos, bucket pequeno).
  const path = `${characterId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = data.publicUrl;
  await setAvatarUrl(characterId, url);
  return url;
}

// mestre edita status/nível/etc diretamente, sem passar pela validação
// de pontos da RPC (já tem permissão plena via RLS de mestre-edita-campanha)
export async function masterUpdateStats(characterId, stats) {
  const { error } = await supabase.from('characters').update(stats).eq('id', characterId);
  if (error) throw error;
}

// ---- RPCs validadas ----
export async function confirmStatusAllocation(characterId, stats) {
  const { error } = await supabase.rpc('confirm_status_allocation', {
    p_character_id: characterId,
    p_vitalidade: stats.vitalidade,
    p_forca: stats.forca,
    p_agilidade: stats.agilidade,
    p_destreza: stats.destreza,
    p_inteligencia: stats.inteligencia,
    p_estamina: stats.estamina,
    p_observacao: stats.observacao,
  });
  if (error) throw error;
}

export async function grantXp(characterIds, amount) {
  const { error } = await supabase.rpc('grant_xp', { p_character_ids: characterIds, p_amount: amount });
  if (error) throw error;
}

// ---- módulos (blocos de texto livre com título) ----
export function addModuleToSheetData(sheetData, title, content) {
  const modulos = [...(sheetData.modulos || []), { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title, content }];
  return { ...sheetData, modulos };
}
export function removeModuleFromSheetData(sheetData, moduleId) {
  return { ...sheetData, modulos: (sheetData.modulos || []).filter((m) => m.id !== moduleId) };
}
export function updateModuleInSheetData(sheetData, moduleId, patch) {
  return { ...sheetData, modulos: (sheetData.modulos || []).map((m) => (m.id === moduleId ? { ...m, ...patch } : m)) };
}
