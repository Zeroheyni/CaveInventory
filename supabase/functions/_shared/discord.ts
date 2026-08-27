// Cliente REST fino pro bot do Discord. Não usa Gateway/WebSocket — o bot só
// precisa enviar/editar/apagar mensagens em canais já conhecidos (o mestre
// vincula o ID do canal manualmente no site), então REST puro basta.

const API = 'https://discord.com/api/v10';

function botHeaders(): Record<string, string> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN não configurado');
  return { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
}

export function refreshButtonRow(customId: string) {
  return [
    {
      type: 1, // action row
      components: [
        { type: 2, style: 2, label: '🔄 atualizar', custom_id: customId }, // botão secundário
      ],
    },
  ];
}

function embedFor(content: string) {
  return {
    embeds: [
      {
        description: '```\n' + content + '\n```',
        color: 0x3aa0ff,
      },
    ],
  };
}

async function discordFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...botHeaders(), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API ${init.method ?? 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function sendMessage(channelId: string, content: string, customId: string): Promise<string> {
  const payload = { ...embedFor(content), components: refreshButtonRow(customId) };
  const msg = await discordFetch(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(payload) });
  return msg.id as string;
}

// Mensagem simples (texto puro, sem embed/botão de atualizar) -- pra avisos
// pontuais tipo passagem de turno (Fase 8), que não precisam de tracking
// pra editar depois. Menção de usuário específico (<@id>) já funciona sem
// allowed_mentions nem permissão extra -- o bot é bot real com token, não
// webhook, e o default do Discord já pinga qualquer <@id> no content.
export async function sendPlainMessage(channelId: string, content: string): Promise<string> {
  const msg = await discordFetch(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
  return msg.id as string;
}

// Editar tratava QUALQUER falha (rate limit 429, erro transitório 5xx, etc.)
// como "mensagem sumiu, apagada à mão" e recriava -- mas um 429/5xx não
// significa que a mensagem sumiu, e recriar nesse caso só deixa a mensagem
// antiga de sobra (raiz de duplicatas mesmo sem nenhuma concorrência
// envolvida). Agora só um 404 de verdade sinaliza "recria"; 429 espera o
// retry_after e tenta de novo; outros erros propagam sem recriar nada.
export async function editMessage(
  channelId: string,
  messageId: string,
  content: string,
  customId: string,
): Promise<{ ok: true } | { ok: false; notFound: boolean; error: string }> {
  const payload = { ...embedFor(content), components: refreshButtonRow(customId) };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: botHeaders(),
      body: JSON.stringify(payload),
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({ retry_after: 1 }));
      await sleep(Math.ceil((body.retry_after ?? 1) * 1000) + 50);
      continue;
    }
    if (res.ok) return { ok: true };
    if (res.status === 404) return { ok: false, notFound: true, error: '404' };
    if (res.status >= 500 && attempt < 4) {
      await sleep(300 * (attempt + 1));
      continue;
    }
    return { ok: false, notFound: false, error: `${res.status}: ${await res.text()}` };
  }
  return { ok: false, notFound: false, error: 'esgotou tentativas de rate limit' };
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  try {
    await discordFetch(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
  } catch {
    // mensagem já pode ter sido apagada manualmente no Discord — não é fatal
  }
}

let cachedBotUserId: string | null = null;
async function getBotUserId(): Promise<string> {
  if (cachedBotUserId) return cachedBotUserId;
  const me = await discordFetch('/users/@me', { method: 'GET' });
  cachedBotUserId = me.id as string;
  return cachedBotUserId;
}

export async function listChannelMessages(channelId: string, limit = 100, before?: string): Promise<{ id: string; author: { id: string } }[]> {
  const query = before ? `?limit=${limit}&before=${before}` : `?limit=${limit}`;
  return await discordFetch(`/channels/${channelId}/messages${query}`, { method: 'GET' });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Apagar mensagem é MUITO mais limitado (~5 a cada 5s por canal) do que
// editar/criar — disparar várias exclusões em paralelo (como o resto deste
// arquivo faz de propósito pra ficar rápido) só derruba quase tudo em 429.
// Aqui vai sequencial e respeita o retry_after que o próprio Discord manda.
async function deleteMessageRateLimited(channelId: string, messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, { method: 'DELETE', headers: botHeaders() });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({ retry_after: 1 }));
      await sleep(Math.ceil((body.retry_after ?? 1) * 1000) + 50);
      continue;
    }
    if (res.ok) return { ok: true };
    return { ok: false, error: `${res.status}: ${await res.text()}` };
  }
  return { ok: false, error: 'esgotou tentativas de rate limit' };
}

// Apaga só as PRÓPRIAS mensagens do bot num canal que não estejam no
// conjunto "manter" (os IDs que estão de verdade sendo usados agora pelas
// tabelas de rastreio) — nunca mexe em mensagem de outra pessoa. Serve pra
// limpar sobras de teste/relink sem apagar nada essencial.
export async function pruneChannel(channelId: string, keepIds: Set<string>): Promise<{ found: number; deleted: number; errors: string[] }> {
  const botId = await getBotUserId();
  let found = 0;
  let deleted = 0;
  const errors: string[] = [];
  // pagina pra trás (mais antiga) até o canal não ter mais 100 mensagens
  // pra devolver — um canal de teste bem usado facilmente passa desse limite
  let before: string | undefined;
  while (true) {
    const page = await listChannelMessages(channelId, 100, before);
    if (page.length === 0) break;
    const toDelete = page.filter((m) => m.author?.id === botId && !keepIds.has(m.id));
    found += toDelete.length;
    for (const m of toDelete) {
      const result = await deleteMessageRateLimited(channelId, m.id);
      if (result.ok) deleted++;
      else errors.push(result.error);
    }
    before = page[page.length - 1].id;
    if (page.length < 100) break;
  }
  return { found, deleted, errors: [...new Set(errors)] };
}

// Sincroniza uma lista de mensagens de uma "seção" (ex: inventário de um
// personagem, ou um compartimento público) contra o texto atual, já dividido
// em pedaços por splitIntoChunks. Edita as que já existem, cria as que
// faltam, apaga as que sobram. Retorna os IDs de mensagem atualizados, na
// ordem, pra persistir de volta no banco.
export async function syncMessageList(
  channelId: string,
  existingIds: string[],
  contents: string[],
  customIdFor: (index: number) => string,
): Promise<string[]> {
  const max = Math.max(existingIds.length, contents.length);
  // paralelo — cada índice mexe numa mensagem diferente, não há dependência
  // entre eles, e isso corta a latência total de N syncs sequenciais pra ~1
  const perIndex = await Promise.all(
    Array.from({ length: max }, async (_, i) => {
      const content = contents[i];
      const existingId = existingIds[i];
      if (content === undefined) {
        if (existingId) await deleteMessage(channelId, existingId);
        return null;
      }
      if (existingId) {
        const result = await editMessage(channelId, existingId, content, customIdFor(i));
        if (result.ok) return existingId;
        if (result.notFound) return await sendMessage(channelId, content, customIdFor(i)); // sumiu de verdade (apagada à mão) — recria
        console.error(`falha ao editar mensagem ${existingId} no canal ${channelId}: ${result.error}`);
        return existingId; // mantém o id antigo -- não duplica; a próxima sincronização tenta de novo
      }
      return await sendMessage(channelId, content, customIdFor(i));
    }),
  );
  return perIndex.filter((id): id is string => id !== null);
}
