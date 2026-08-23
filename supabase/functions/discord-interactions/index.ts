// Endpoint público chamado pelo próprio Discord (Interactions Endpoint URL,
// configurado no Developer Portal) — não usa Gateway/WebSocket, só HTTP.
// Recebe o PING de verificação e os cliques no botão "🔄 atualizar" de
// cada mensagem, reaproveitando a mesma lógica de sync dos triggers.
import { verifyKey } from 'https://esm.sh/discord-interactions@3.4.0';
import { syncCharacter } from '../_shared/syncCharacter.ts';
import { syncPublicArea } from '../_shared/syncPublic.ts';

const PUBLIC_KEY = Deno.env.get('DISCORD_PUBLIC_KEY') ?? '';

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 };
const InteractionResponseType = { PONG: 1, DEFERRED_UPDATE_MESSAGE: 6 };

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

// custom_id: "rc:<characterId>:<i>" (inventário), "rt:<characterId>:<i>"
// (espaço pessoal) ou "rp:<compartmentId|avulso>:<campaignId>:<i>" (público).
// Clicar em qualquer botão de um personagem/campanha resincroniza o grupo
// inteiro (mais simples e barato do que só a mensagem clicada).
async function handleRefresh(customId: string) {
  try {
    const [kind, a, b] = customId.split(':');
    if (kind === 'rc' || kind === 'rt') {
      await syncCharacter(a);
    } else if (kind === 'rp') {
      await syncPublicArea(b);
    }
  } catch (err) {
    console.error('refresh falhou', customId, err);
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get('X-Signature-Ed25519');
  const timestamp = req.headers.get('X-Signature-Timestamp');
  const rawBody = await req.text();
  if (!signature || !timestamp || !PUBLIC_KEY || !(await verifyKey(rawBody, signature, timestamp, PUBLIC_KEY))) {
    return new Response('invalid request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === InteractionType.PING) {
    return json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId: string = interaction.data?.custom_id ?? '';
    const task = handleRefresh(customId);
    // @ts-ignore -- EdgeRuntime existe no runtime de Edge Functions do Supabase
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(task);
    else await task;
    return json({ type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE });
  }

  return new Response('unhandled interaction type', { status: 400 });
});
