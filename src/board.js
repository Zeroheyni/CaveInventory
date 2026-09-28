// Camada de dados do Tabuleiro (Fase 1) -- ver db/054_patch_board_tabuleiro.sql.
// Só CRUD de tabuleiro + posicionar/mover token de personagem por
// enquanto -- marcador solto, redimensionar e reordenar camada são
// Fase 2; arrasto ao vivo com preview (Broadcast) é Fase 3.
import { supabase } from './supabaseClient.js';

export async function listBoards(campaignId) {
  const { data, error } = await supabase.from('boards').select('*').eq('campaign_id', campaignId).order('created_at');
  if (error) throw error;
  return data;
}

export async function createBoard(campaignId, name) {
  const { data, error } = await supabase.from('boards').insert({ campaign_id: campaignId, name: name || 'Tabuleiro' }).select().single();
  if (error) throw error;
  return data;
}

export async function renameBoard(boardId, name) {
  const { error } = await supabase.from('boards').update({ name }).eq('id', boardId);
  if (error) throw error;
}

export async function deleteBoard(boardId) {
  const { error } = await supabase.from('boards').delete().eq('id', boardId);
  if (error) throw error;
}

// se o tabuleiro ativo for apagado, campaigns.active_board_id já cai
// pra null sozinho (on delete set null) -- quem chama não precisa
// tratar esse caso à parte.
export async function setActiveBoard(campaignId, boardId) {
  const { error } = await supabase.from('campaigns').update({ active_board_id: boardId }).eq('id', campaignId);
  if (error) throw error;
}

// mesmo padrão de characterSheet.js/notebook.js: nunca upsert/update
// em storage.objects nesse projeto (upsert falha a RLS de forma
// inconsistente aqui) -- sempre nome de arquivo novo. Bucket
// `avatars` reaproveitado: a policy de INSERT já dá ao mestre upload
// livre em qualquer prefixo, então não precisa de bucket/policy novo.
export async function uploadBoardBackground(boardId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `boards/${boardId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = data.publicUrl;
  const { error } = await supabase.from('boards').update({ background_image_url: url }).eq('id', boardId);
  if (error) throw error;
  return url;
}

export async function listBoardTokens(boardId) {
  const { data, error } = await supabase.from('board_tokens').select('*').eq('board_id', boardId).order('z_index');
  if (error) throw error;
  return data;
}

// snapshota nome/avatar do personagem em label/image_url no momento
// da criação -- mesmo motivo de combat_participants.display_name
// (db/015): a policy de `characters` só deixa o DONO ou o MESTRE
// selecionar a linha (não os outros jogadores da campanha), então um
// token que dependesse de `characters.avatar_url` via join ficaria
// sem nome/foto pra qualquer um que não fosse o dono do personagem.
// Só o mestre cria token (permissão já checada pela RLS de
// board_tokens), e o mestre tem select em qualquer personagem da
// campanha, então o snapshot sempre consegue ser lido aqui.
// (Igual ao display_name do combate, o snapshot não atualiza sozinho
// se o personagem mudar de nome/foto depois -- aceitável por ora.)
export async function createTokenForCharacter(boardId, campaignId, characterId, { x, y } = {}) {
  const { data: char, error: charError } = await supabase.from('characters').select('name, avatar_url').eq('id', characterId).single();
  if (charError) throw charError;
  const { data, error } = await supabase
    .from('board_tokens')
    .insert({
      board_id: boardId,
      campaign_id: campaignId,
      character_id: characterId,
      label: char.name,
      image_url: char.avatar_url || null,
      x: x ?? 50,
      y: y ?? 50,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// grava a posição final -- chamado uma vez no soltar do arrasto (não
// a cada pixel movido; o preview durante o arrasto é só local por
// enquanto, sem escrever no banco a cada frame).
export async function updateTokenPosition(tokenId, x, y) {
  const { error } = await supabase.from('board_tokens').update({ x, y, updated_at: new Date().toISOString() }).eq('id', tokenId);
  if (error) throw error;
}

export async function deleteToken(tokenId) {
  const { error } = await supabase.from('board_tokens').delete().eq('id', tokenId);
  if (error) throw error;
}

export function subscribeBoard(boardId, onChange) {
  return supabase
    .channel('board-tokens-' + boardId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_tokens', filter: `board_id=eq.${boardId}` }, onChange)
    .subscribe();
}

export function subscribeCampaignBoards(campaignId, onChange) {
  return supabase
    .channel('campaign-boards-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` }, onChange)
    .subscribe();
}
