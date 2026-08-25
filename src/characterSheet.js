// Camada de dados da ficha de personagem (Fase 5) -- ver
// db/016_patch_character_sheet.sql. Status e HP/Estamina são fonte
// única de verdade aqui -- o rastreador de combate (src/combat.js)
// grava de volta pra cá quando o participante tem character_id.
import { supabase } from './supabaseClient.js';

export const SHEET_FIELDS =
  'id, campaign_id, owner_id, name, avatar_url, level, xp, status_points_unspent, status_confirmed, ' +
  'vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao, hp_current, estamina_current, sheet_data, ' +
  'is_npc, npc_sheet_type, npc_has_status, hp_max_override, estamina_max_override, npc_damage';

// os 7 atributos de status com ícone/cor -- usado por ficha.js (cards
// de status) e combat.js (resumo de status do mestre no combate).
export const STATUS_STATS = [
  { key: 'vitalidade', label: 'Vitalidade', icon: '❤', color: '#ff5a5a' },
  { key: 'forca', label: 'Força', icon: '💪', color: '#ff8a4c' },
  { key: 'agilidade', label: 'Agilidade', icon: '🏃', color: '#5ad4ff' },
  { key: 'destreza', label: 'Destreza', icon: '🎯', color: '#4ade80' },
  { key: 'inteligencia', label: 'Inteligência', icon: '🧠', color: '#b98bff' },
  { key: 'estamina', label: 'Estamina', icon: '⚡', color: '#ffd93d' },
  { key: 'observacao', label: 'Observação', icon: '👁', color: '#2dd4bf' },
];

// NPC de ficha simples sem status não tem vitalidade/estamina pra
// calcular pela fórmula -- hp_max_override/estamina_max_override
// (digitados direto pelo mestre) vencem quando presentes.
export function hpMax(char) {
  if (char.hp_max_override !== undefined && char.hp_max_override !== null) return char.hp_max_override;
  return (char.vitalidade || 0) * 4;
}
export function estaminaMax(char) {
  if (char.estamina_max_override !== undefined && char.estamina_max_override !== null) return char.estamina_max_override;
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
  return { idade: '', genero: '', sexualidade: '', raca: '', trabalho: '', historia: '', modulos: [] };
}
export function sheetDataOf(char) {
  return { ...emptySheetData(), ...(char.sheet_data || {}) };
}

export async function getCharacterSheet(characterId) {
  const { data, error } = await supabase.from('characters').select(SHEET_FIELDS).eq('id', characterId).maybeSingle();
  if (error) throw error;
  return data;
}

// dashboard do mestre (masterFicha.js) -- só player de verdade, NPC
// tem o próprio banco (npcBank.js).
export async function listCampaignCharacterSheets(campaignId) {
  const { data, error } = await supabase.from('characters').select(SHEET_FIELDS).eq('campaign_id', campaignId).eq('is_npc', false).order('name');
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
  // combat_participants guarda um snapshot da foto (evita join só pra
  // mostrar a fotinho no combate, ver db/018) -- sem isso, trocar a
  // foto depois de já estar em combate nunca reflete lá.
  await supabase.from('combat_participants').update({ avatar_url: url }).eq('character_id', characterId);
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

// ---- banco de NPCs (Fase 6) -- ver db/024_patch_npc_bank.sql ----
// NPC é uma linha de characters com owner_id nulo (não pertence a
// nenhum jogador) -- reaproveita 100% da ficha/inventário que já
// existe, só o mestre enxerga (RLS: "personagem: mestre gerencia npcs").
export async function listCampaignNpcs(campaignId) {
  const { data, error } = await supabase.from('characters').select(SHEET_FIELDS).eq('campaign_id', campaignId).eq('is_npc', true).order('name');
  if (error) throw error;
  return data;
}

// ficha completa: cria a linha com os defaults normais de player (10
// em todo status, já confirmado -- mestre não precisa "distribuir
// pontos" de um NPC) e devolve pra abrir a ficha/inventário na hora.
export async function createCompleteNpc(campaignId, name) {
  const { data, error } = await supabase
    .from('characters')
    .insert({
      campaign_id: campaignId,
      owner_id: null,
      is_npc: true,
      npc_sheet_type: 'completa',
      name: name || 'Novo NPC',
      status_confirmed: true,
      hp_current: 40,
      estamina_current: 10,
      data: {
        items: [], containers: [], order: [],
        equipSlots: [
          { key: 'mao', label: 'MÃO', icon: 'mao', reduceWeight: false },
          { key: 'vestindo', label: 'VESTINDO', icon: 'vestindo', reduceWeight: false },
          { key: 'bolso', label: 'BOLSO', icon: 'bolso', reduceWeight: false },
          { key: 'cabeca', label: 'CABEÇA', icon: 'cabeca', reduceWeight: false },
          { key: 'acessorios', label: 'ACESSÓRIOS', icon: 'acessorios', reduceWeight: false },
          { key: 'costas', label: 'COSTAS', icon: 'costas', reduceWeight: false },
        ],
        equip: { mao: '', vestindo: '', bolso: '', cabeca: '', acessorios: '', costas: '' },
        transportPersonal: [], transportPersonalMaxCarga: 100,
        theme: 'caverna-azul',
      },
    })
    .select(SHEET_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

// ficha simples: nome + HP/estamina digitados direto (sem fórmula) +
// dano solto, com status opcional.
export async function createSimpleNpc(campaignId, { name, hpMaxVal, estaminaMaxVal, damage, hasStatus }) {
  const { data, error } = await supabase
    .from('characters')
    .insert({
      campaign_id: campaignId,
      owner_id: null,
      is_npc: true,
      npc_sheet_type: 'simples',
      npc_has_status: !!hasStatus,
      name: name || 'Novo NPC',
      hp_max_override: hpMaxVal,
      estamina_max_override: estaminaMaxVal,
      hp_current: hpMaxVal,
      estamina_current: estaminaMaxVal,
      npc_damage: damage || null,
      status_confirmed: true,
    })
    .select(SHEET_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

export async function updateSimpleNpc(id, { name, hpMaxVal, estaminaMaxVal, damage, hasStatus }) {
  const { error } = await supabase
    .from('characters')
    .update({
      name,
      hp_max_override: hpMaxVal,
      estamina_max_override: estaminaMaxVal,
      npc_damage: damage || null,
      npc_has_status: !!hasStatus,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteNpc(id) {
  const { error } = await supabase.from('characters').delete().eq('id', id);
  if (error) throw error;
}
