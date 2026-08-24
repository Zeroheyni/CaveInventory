// Chamada pelo painel do mestre logo ao LIGAR o modo "sessão" de uma
// campanha (ver src/admin.js:setCampaignLiveSession / src/screens/admin.js).
// Enquanto a campanha ficou fora de sessão, edições no site não empurraram
// nada pro Discord (db/014_patch_discord_live_session.sql) -- ao ligar a
// sessão, força uma sincronização completa (área pública + cada personagem
// vinculado) de uma vez só, em vez de esperar a próxima edição de cada um
// ou depender de alguém clicar em "🔄 atualizar" em cada mensagem.
import { serviceClient, isAuthorized } from '../_shared/db.ts';
import { syncCharacter } from '../_shared/syncCharacter.ts';
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

    const client = serviceClient();
    const { data: chars } = await client.from('characters').select('id').eq('campaign_id', campaignId);
    const charIds = (chars ?? []).map((c: { id: string }) => c.id);
    const { data: configs } = charIds.length
      ? await client.from('discord_character_config').select('character_id').in('character_id', charIds)
      : { data: [] as { character_id: string }[] };

    await Promise.all([
      syncPublicArea(campaignId),
      ...(configs ?? []).map((c: { character_id: string }) => syncCharacter(c.character_id)),
    ]);
    return corsResponse('ok');
  } catch (err) {
    console.error(err);
    return corsResponse(String(err), { status: 500 });
  }
});
