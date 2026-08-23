// Lógica compartilhada entre discord-sync-character (trigger/painel do
// mestre) e discord-interactions (clique no botão "🔄 atualizar").
import { serviceClient } from './db.ts';
import { syncMessageList } from './discord.ts';
import { buildCharacterInventoryText, buildCharacterTransportPersonalText, splitIntoChunks } from './format.ts';

export async function syncCharacter(characterId: string) {
  const client = serviceClient();
  const { data: character, error } = await client.from('characters').select('id, max_carga, currency, data').eq('id', characterId).single();
  if (error || !character) return; // personagem sumiu (excluído) — nada a fazer

  const { data: config } = await client.from('discord_character_config').select('*').eq('character_id', characterId).maybeSingle();
  if (!config) return; // ninguém vinculou canal pra esse personagem ainda

  const data = character.data ?? {};

  const invText = buildCharacterInventoryText(character.max_carga, data, character.currency);
  const invChunks = splitIntoChunks(invText);
  const invIds = await syncMessageList(
    config.channel_id,
    Array.isArray(config.inventory_message_ids) ? config.inventory_message_ids : [],
    invChunks,
    (i) => `rc:${characterId}:${i}`,
  );

  const transText = buildCharacterTransportPersonalText(data.transportPersonalMaxCarga ?? 100, data);
  const transChunks = splitIntoChunks(transText);
  const transIds = await syncMessageList(
    config.channel_id,
    Array.isArray(config.transport_message_ids) ? config.transport_message_ids : [],
    transChunks,
    (i) => `rt:${characterId}:${i}`,
  );

  await client
    .from('discord_character_config')
    .update({ inventory_message_ids: invIds, transport_message_ids: transIds, updated_at: new Date().toISOString() })
    .eq('character_id', characterId);
}
