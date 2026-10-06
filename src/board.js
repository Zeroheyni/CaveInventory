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
// tamanho natural de uma imagem (arquivo ou URL) -- o "palco" do tabuleiro
// usa a proporção dela (ver board.js, Fase 0 de paredes/iluminação).
export function readImageSize(source) {
  return new Promise((resolve, reject) => {
    const isFile = typeof source !== 'string';
    const url = isFile ? URL.createObjectURL(source) : source;
    const img = new Image();
    img.onload = () => {
      if (isFile) URL.revokeObjectURL(url);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve({ w: img.naturalWidth, h: img.naturalHeight });
      else reject(new Error('imagem sem tamanho'));
    };
    img.onerror = () => {
      if (isFile) URL.revokeObjectURL(url);
      reject(new Error('não consegui ler a imagem'));
    };
    img.src = url;
  });
}

// grava o tamanho natural (boards antigos só ganham isso quando o mestre abre)
export async function updateBoardDims(boardId, w, h) {
  const { error } = await supabase.from('boards').update({ bg_width: w, bg_height: h }).eq('id', boardId);
  if (error) throw error;
}

export async function uploadBoardBackground(boardId, file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `boards/${boardId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: false, cacheControl: '3600' });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = data.publicUrl;
  const payload = { background_image_url: url, bg_width: null, bg_height: null };
  try {
    const dims = await readImageSize(file);
    payload.bg_width = dims.w;
    payload.bg_height = dims.h;
  } catch (_) {
    // sem medida: o board.js mede pela URL ao abrir
  }
  const { error } = await supabase.from('boards').update(payload).eq('id', boardId);
  if (error) throw error;
  return url;
}

// ---------------------------------------------------------------
// Paredes (db/060) -- segmentos desenhados pelo mestre. Coordenadas
// em % do palco (igual aos tokens). Ver boardWalls.js (editor) e
// boardGeometry.js (colisão/luz).
// ---------------------------------------------------------------

// o que cada tipo de parede bloqueia por padrão (o mestre pode ajustar
// as flags de uma parede específica depois)
export const WALL_KIND_DEFAULTS = {
  parede: { blocks_move: true, blocks_light: true },
  janela: { blocks_move: true, blocks_light: false },
  porta: { blocks_move: true, blocks_light: true },
  invisivel: { blocks_move: true, blocks_light: false },
};

export async function listBoardWalls(boardId) {
  const { data, error } = await supabase.from('board_walls').select('*').eq('board_id', boardId).order('created_at');
  if (error) throw error;
  return data;
}

// rows: [{ x1, y1, x2, y2, kind, blocks_move?, blocks_light?, door_open? }]
export async function insertWalls(boardId, campaignId, rows) {
  if (!rows.length) return [];
  const payload = rows.map((r) => ({
    board_id: boardId,
    campaign_id: campaignId,
    x1: r.x1,
    y1: r.y1,
    x2: r.x2,
    y2: r.y2,
    kind: r.kind || 'parede',
    blocks_move: r.blocks_move ?? WALL_KIND_DEFAULTS[r.kind || 'parede'].blocks_move,
    blocks_light: r.blocks_light ?? WALL_KIND_DEFAULTS[r.kind || 'parede'].blocks_light,
    door_open: !!r.door_open,
  }));
  const { data, error } = await supabase.from('board_walls').insert(payload).select();
  if (error) throw error;
  return data;
}

export async function deleteWalls(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from('board_walls').delete().in('id', ids);
  if (error) throw error;
}

// updates: [{ id, fields }] -- um update por parede (campos diferentes por linha)
export async function updateWalls(updates) {
  const results = await Promise.all(updates.map((u) => supabase.from('board_walls').update(u.fields).eq('id', u.id)));
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// ---------------------------------------------------------------
// Luzes (db/060) -- presas a um token (token_id) ou fixas no cenário
// (token_id null + x/y). Raio em % da largura do palco. Ver
// boardLighting.js (render) e LIGHT_PRESETS (tipos).
// ---------------------------------------------------------------
export async function listBoardLights(boardId) {
  const { data, error } = await supabase.from('board_lights').select('*').eq('board_id', boardId).order('created_at');
  if (error) throw error;
  return data;
}

// fields: { token_id? | x,y, kind, radius, dim_radius, color, angle, direction, intensity, flicker, pulse, enabled }
export async function insertLight(boardId, campaignId, fields) {
  const { data, error } = await supabase
    .from('board_lights')
    .insert({ ...fields, board_id: boardId, campaign_id: campaignId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLight(id, fields) {
  const { error } = await supabase.from('board_lights').update(fields).eq('id', id);
  if (error) throw error;
}

export async function deleteLight(id) {
  const { error } = await supabase.from('board_lights').delete().eq('id', id);
  if (error) throw error;
}

// o jogador acende/apaga a PRÓPRIA luz e a lanterna lembra a direção
// (a RLS não restringe coluna: a função só deixa mexer nesses dois campos,
// e só em luz presa a token de personagem dele)
export async function updateMyLight(lightId, { enabled = null, direction = null } = {}) {
  const { error } = await supabase.rpc('update_my_light', { p_light_id: lightId, p_enabled: enabled, p_direction: direction });
  if (error) throw error;
}

// ajustes do tabuleiro (colisão, iluminação, escuridão...) -- só o mestre
export async function updateBoardSettings(boardId, fields) {
  const { error } = await supabase.from('boards').update(fields).eq('id', boardId);
  if (error) throw error;
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
  const { data: char, error: charError } = await supabase.from('characters').select('name, avatar_url, owner_id').eq('id', characterId).single();
  if (charError) throw charError;
  // borda padrão = cor da conta do dono do personagem (db/073); sem cor escolhida, fica a padrão do sistema
  let borderColor = null;
  if (char.owner_id) {
    const { data: prof } = await supabase.from('profiles').select('color').eq('id', char.owner_id).maybeSingle();
    if (prof && /^#[0-9a-f]{6}$/i.test(prof.color || '')) borderColor = prof.color.toLowerCase();
  }
  const { data, error } = await supabase
    .from('board_tokens')
    .insert({
      board_id: boardId,
      campaign_id: campaignId,
      character_id: characterId,
      label: char.name,
      image_url: char.avatar_url || null,
      ...(borderColor ? { border_color: borderColor } : {}),
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
export function subscribeBoard(boardId, { onChange, onCursor, onDrag, onWalls, onLights, onFx } = {}) {
  const channel = supabase.channel('board-tokens-' + boardId);
  if (onChange) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'board_tokens', filter: `board_id=eq.${boardId}` }, onChange);
  }
  if (onWalls) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'board_walls', filter: `board_id=eq.${boardId}` }, onWalls);
  }
  if (onLights) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'board_lights', filter: `board_id=eq.${boardId}` }, onLights);
  }
  if (onCursor) channel.on('broadcast', { event: 'cursor' }, ({ payload }) => onCursor(payload));
  if (onDrag) channel.on('broadcast', { event: 'drag' }, ({ payload }) => onDrag(payload));
  if (onFx) channel.on('broadcast', { event: 'fx' }, ({ payload }) => onFx(payload)); // ping e desenhos temporários (boardFx.js)
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

// ping / desenho temporário -- efêmero, não toca no banco (ver boardFx.js)
export function broadcastFx(channel, payload) {
  if (!channel) return;
  channel.send({ type: 'broadcast', event: 'fx', payload }).catch(() => {});
}

// ---- memória do mapa (db/072): o que ESTE jogador já explorou ----
export async function getMyBoardMemory(boardId, userId) {
  const { data, error } = await supabase.from('board_memory').select('epoch, cells').eq('board_id', boardId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
export async function saveMyBoardMemory(boardId, userId, epoch, cells) {
  const { error } = await supabase
    .from('board_memory')
    .upsert({ board_id: boardId, user_id: userId, epoch, cells, updated_at: new Date().toISOString() }, { onConflict: 'board_id,user_id' });
  if (error) throw error;
}
export async function resetBoardMemory(boardId) {
  const { error } = await supabase.rpc('reset_board_memory', { p_board_id: boardId });
  if (error) throw error;
}

export function subscribeCampaignBoards(campaignId, onChange) {
  return supabase
    .channel('campaign-boards-' + campaignId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards', filter: `campaign_id=eq.${campaignId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` }, onChange)
    .subscribe();
}
