// Disparada pelo trigger discord_sync_character_trg (db/008_patch_discord_bot.sql)
// a cada insert/update em `characters`, ou manualmente pelo painel do mestre
// (supabase.functions.invoke) logo depois de vincular um canal.
import { isAuthorized } from '../_shared/db.ts';
import { syncCharacter } from '../_shared/syncCharacter.ts';
import { handleCorsPreflight, corsResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (!(await isAuthorized(req))) return corsResponse('unauthorized', { status: 401 });
  try {
    const body = await req.json();
    const characterId = body.character?.id ?? body.character_id;
    if (!characterId) return corsResponse('missing character id', { status: 400 });
    await syncCharacter(characterId);
    return corsResponse('ok');
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
