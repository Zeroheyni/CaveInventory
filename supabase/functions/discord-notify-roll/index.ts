// Disparada pelo trigger discord_notify_dice_roll_trg (db/035_patch_discord_dice_notify.sql)
// a cada rolagem de dado. O trigger já monta o texto pronto (nome de
// quem rolou + fórmula + resultado, sem @menção) -- essa function só
// posta no canal.
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
    const content = body.content as string | undefined;
    if (!channelId || !content) return corsResponse('missing channel_id/content', { status: 400 });
    await sendPlainMessage(channelId, content);
    return corsResponse('ok');
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
