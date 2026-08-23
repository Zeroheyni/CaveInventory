// Dá pro bot a capacidade de apagar as PRÓPRIAS mensagens que sobraram nos
// canais vinculados (de testes antigos, relink de canal, etc.) — mantém só
// o que está de verdade rastreado agora (discord_character_config e
// discord_public_messages), sem nunca tocar em mensagem de outra pessoa.
// Chamada sob demanda (painel do mestre ou manualmente), não é agendada.
import { serviceClient, isAuthorized } from '../_shared/db.ts';
import { pruneChannel } from '../_shared/discord.ts';
import { handleCorsPreflight, corsResponse } from '../_shared/cors.ts';

export async function pruneAllChannels(): Promise<Record<string, number>> {
  const client = serviceClient();
  const byChannelKeep = new Map<string, Set<string>>();

  const { data: charConfigs } = await client
    .from('discord_character_config')
    .select('channel_id, inventory_message_ids, transport_message_ids');
  for (const c of charConfigs ?? []) {
    const set = byChannelKeep.get(c.channel_id) ?? new Set<string>();
    (c.inventory_message_ids ?? []).forEach((id: string) => set.add(id));
    (c.transport_message_ids ?? []).forEach((id: string) => set.add(id));
    byChannelKeep.set(c.channel_id, set);
  }

  const { data: pubConfigs } = await client.from('discord_config').select('campaign_id, channel_id');
  const { data: pubMessages } = await client.from('discord_public_messages').select('campaign_id, message_ids');
  const campaignToChannel = new Map((pubConfigs ?? []).map((c: any) => [c.campaign_id, c.channel_id]));
  for (const section of pubMessages ?? []) {
    const channelId = campaignToChannel.get(section.campaign_id);
    if (!channelId) continue;
    const set = byChannelKeep.get(channelId) ?? new Set<string>();
    (section.message_ids ?? []).forEach((id: string) => set.add(id));
    byChannelKeep.set(channelId, set);
  }

  const results: Record<string, number> = {};
  for (const [channelId, keepIds] of byChannelKeep) {
    results[channelId] = await pruneChannel(channelId, keepIds);
  }
  return results;
}

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (!(await isAuthorized(req))) return corsResponse('unauthorized', { status: 401 });
  try {
    const results = await pruneAllChannels();
    return corsResponse(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
