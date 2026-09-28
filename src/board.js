// Camada de dados do Tabuleiro -- ver db/054_patch_board_tabuleiro.sql
// e db/055_patch_board_token_owner_delete.sql (Fase 1), Fase 2 (marcador
// solto, redimensionar, cor/formato, camada) e Fase 3 abaixo (Realtime
// Broadcast pro que é efêmero: preview de arrasto/redimensionar ao
// vivo + cursor colorido de cada jogador -- NUNCA persistido no banco,
// primeiro uso de Broadcast neste projeto).
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

// marcador solto (Fase 2) -- token sem ficha vinculada, nome+imagem
// digitados na hora pelo mestre (ex: monstro avulso, objeto no
// cenário). Ao contrário de createTokenForCharacter, não tem de onde
// puxar label/image_url -- vem pronto de quem chama.
export async function createFreeformToken(boardId, campaignId, { label, imageUrl, x, y } = {}) {
  const { data, error } = await supabase
    .from('board_tokens')
    .insert({
      board_id: boardId,
      campaign_id: campaignId,
      character_id: null,
      label: label || 'Marcador',
      image_url: imageUrl || null,
      x: x ?? 50,
      y: y ?? 50,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// imagem do marcador solto -- mesmo bucket/padrão de
// uploadBoardBackground (nunca upsert/update em storage.objects
// nesse projeto). O path só depende do board, não do token -- dá pra
// subir a imagem ANTES de criar a linha do token (não precisa do id
// dele pra montar o caminho).
export async function uploadTokenImage(boardId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `boards/${boardId}/tokens/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl;
}

// atualização genérica de aparência (Fase 2) -- tamanho (redimensionar
// via alça de arrasto), formato, cor da borda, camada (z-index) e,
// pro marcador solto, nome/imagem. Um update só serve pra todos esses
// campos em vez de uma função por campo -- quem chama manda só o que
// mudou.
export async function updateTokenAppearance(tokenId, { size, shape, borderColor, zIndex, label, imageUrl } = {}) {
  const payload = { updated_at: new Date().toISOString() };
  if (size !== undefined) payload.size = size;
  if (shape !== undefined) payload.shape = shape;
  if (borderColor !== undefined) payload.border_color = borderColor;
  if (zIndex !== undefined) payload.z_index = zIndex;
  if (label !== undefined) payload.label = label;
  if (imageUrl !== undefined) payload.image_url = imageUrl;
  const { error } = await supabase.from('board_tokens').update(payload).eq('id', tokenId);
  if (error) throw error;
}

export async function deleteToken(tokenId) {
  const { error } = await supabase.from('board_tokens').delete().eq('id', tokenId);
  if (error) throw error;
}

// mesmo canal serve pra tudo do tabuleiro (persistido via
// postgres_changes E efêmero via Broadcast, Fase 3) -- Supabase deixa
// multiplexar os dois tipos de evento num canal só, não precisa de
// uma segunda assinatura/topic por tabuleiro só pra cursor/arrasto.
// onCursor/onDrag são opcionais -- quem só quer ouvir mudança
// persistida (ex: nenhum caso hoje, mas deixa a função flexível)
// simplesmente não passa.
export function subscribeBoard(boardId, { onChange, onCursor, onDrag } = {}) {
  const channel = supabase.channel('board-tokens-' + boardId);
  if (onChange) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'board_tokens', filter: `board_id=eq.${boardId}` }, onChange);
  }
  if (onCursor) channel.on('broadcast', { event: 'cursor' }, ({ payload }) => onCursor(payload));
  if (onDrag) channel.on('broadcast', { event: 'drag' }, ({ payload }) => onDrag(payload));
  channel.subscribe();
  return channel;
}

// posição do mouse de quem tá olhando o tabuleiro agora (% do
// tabuleiro, igual x/y de token) -- payload.leave=true quando o
// ponteiro sai da área (pra sumir o cursor na tela dos outros em vez
// de deixar ele "parado" pra sempre no último ponto).
export function broadcastCursor(channel, payload) {
  if (!channel) return;
  channel.send({ type: 'broadcast', event: 'cursor', payload }).catch(() => {});
}

// posição/tamanho de um token EM ANDAMENTO de arrasto/redimensionar
// (não a gravação final, que continua sendo updateTokenPosition/
// updateTokenAppearance de sempre) -- x/y e/ou size, só o que mudou.
export function broadcastDrag(channel, payload) {
  if (!channel) return;
  channel.send({ type: 'broadcast', event: 'drag', payload }).catch(() => {});
}

export function subscribeCampaignBoards(campaignId, onChange) {
  return supabase
    .channel('campaign-boards-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` }, onChange)
    .subscribe();
}
