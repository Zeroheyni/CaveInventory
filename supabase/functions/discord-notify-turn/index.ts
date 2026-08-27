// Disparada pelo trigger discord_notify_turn_trg (db/033_patch_discord_turn_notify.sql)
// a cada passagem de turno de verdade no combate -- sempre automático, sem
// gate de discord_live_session (esse gate é só pra sync de inventário).
// Não precisa de serviceClient nem de ler nada do banco: o trigger já manda
// tudo pronto no body (o Postgres é quem sabe o estado, essa function só
// fala com a API do Discord).
import { isAuthorized } from '../_shared/db.ts';
import { sendPlainMessage } from '../_shared/discord.ts';
import { handleCorsPreflight, corsResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (!(await isAuthorized(req))) return corsResponse('unauthorized', { status: 401 });
  try {
    const body = await req.json();
    const channelId = body.channel_id as string | undefined;
    const discordUserId = body.discord_user_id as string | undefined;
    const displayName = body.display_name as string | undefined;
    if (!channelId || !discordUserId || !displayName) return corsResponse('missing channel_id/discord_user_id/display_name', { status: 400 });
    await sendPlainMessage(channelId, `<@${discordUserId}> — sua vez, **${displayName}**!`);
    return corsResponse('ok');
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
