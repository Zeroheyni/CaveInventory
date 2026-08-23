// Disparada pelos triggers discord_sync_public_*_trg (db/008_patch_discord_bot.sql)
// a cada mudança em public_items/public_containers/public_compartments/public_currency,
// ou manualmente pelo painel do mestre.
import { isAuthorized } from '../_shared/db.ts';
import { syncPublicArea } from '../_shared/syncPublic.ts';

Deno.serve(async (req) => {
  if (!(await isAuthorized(req))) return new Response('unauthorized', { status: 401 });
  try {
    const body = await req.json();
    const campaignId = body.campaign_id;
    if (!campaignId) return new Response('missing campaign_id', { status: 400 });
    await syncPublicArea(campaignId);
    return new Response('ok');
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
