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

export async function editMessage(channelId: string, messageId: string, content: string, customId: string): Promise<void> {
  const payload = { ...embedFor(content), components: refreshButtonRow(customId) };
  await discordFetch(`/channels/${channelId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  try {
    await discordFetch(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
  } catch {
    // mensagem já pode ter sido apagada manualmente no Discord — não é fatal
  }
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
  const result: string[] = [];
  const max = Math.max(existingIds.length, contents.length);
  for (let i = 0; i < max; i++) {
    const content = contents[i];
    const existingId = existingIds[i];
    if (content === undefined) {
      if (existingId) await deleteMessage(channelId, existingId);
      continue;
    }
    if (existingId) {
      try {
        await editMessage(channelId, existingId, content, customIdFor(i));
        result.push(existingId);
      } catch {
        // mensagem sumiu (apagada à mão) — recria
        const newId = await sendMessage(channelId, content, customIdFor(i));
        result.push(newId);
      }
    } else {
      const newId = await sendMessage(channelId, content, customIdFor(i));
      result.push(newId);
    }
  }
  return result;
}
