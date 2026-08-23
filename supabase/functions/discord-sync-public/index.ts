// Disparada pelos triggers discord_sync_public_*_trg (db/008_patch_discord_bot.sql)
// a cada mudança em public_items/public_containers/public_compartments/public_currency,
// ou manualmente pelo painel do mestre.
import { isAuthorized } from '../_shared/db.ts';
import { syncPublicArea } from '../_shared/syncPublic.ts';
import { handleCorsPreflight, corsResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (!(await isAuthorized(req))) return corsResponse('unauthorized', { status: 401 });
  try {
    const body = await req.json();
    const campaignId = body.campaign_id;
    if (!campaignId) return corsResponse('missing campaign_id', { status: 400 });
    await syncPublicArea(campaignId);
    return corsResponse('ok');
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
