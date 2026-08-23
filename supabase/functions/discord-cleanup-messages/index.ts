// Disparada pelos triggers discord_cleanup_character_trg/discord_cleanup_campaign_trg
// (db/012_patch_discord_auto_cleanup.sql) logo ANTES de um personagem ou uma
// campanha ser excluído — o trigger já manda os IDs de mensagem prontos no
// corpo (não dá pra reconsultar o banco depois: as tabelas de rastreio têm
// "on delete cascade" e já teriam sumido).
import { isAuthorized } from '../_shared/db.ts';
import { deleteMessage } from '../_shared/discord.ts';
import { handleCorsPreflight, corsResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (!(await isAuthorized(req))) return corsResponse('unauthorized', { status: 401 });
  try {
    const body = await req.json();
    const channelId = body.channel_id;
    const messageIds: string[] = Array.isArray(body.message_ids) ? body.message_ids : [];
    if (!channelId || messageIds.length === 0) return corsResponse('nada pra limpar');
    await Promise.all(messageIds.map((id) => deleteMessage(channelId, id)));
    return corsResponse('ok');
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
