// Lê o Baú Compartilhado de verdade (publicArea.js/tabelas public_*) — não o
// transportPublic legado de character.js. Compartilhada entre
// discord-sync-public (trigger/painel do mestre) e discord-interactions.
import { serviceClient } from './db.ts';
import { syncMessageList, deleteMessage } from './discord.ts';
import { withSyncLock } from './lock.ts';
import { buildPublicCompartmentText, buildPublicAvulsoText, splitIntoChunks, type PublicItem, type PublicContainer } from './format.ts';

export async function syncPublicArea(campaignId: string) {
  // mesma race de syncCharacter: sem a trava, mudanças rápidas em
  // itens/compartimentos da área pública disparam sincronizações em
  // paralelo que duplicam mensagem (ver db/013_patch_discord_sync_lock.sql).
  await withSyncLock(`public:${campaignId}`, () => syncPublicAreaInner(campaignId));
}

async function syncPublicAreaInner(campaignId: string) {
  const client = serviceClient();
  const { data: config } = await client.from('discord_config').select('channel_id').eq('campaign_id', campaignId).maybeSingle();
  if (!config) return; // mestre ainda não vinculou o canal de transporte pra essa campanha

  const [{ data: compartments }, { data: items }, { data: containers }, { data: currency }, { data: sections }] = await Promise.all([
    client.from('public_compartments').select('id, name, currency').eq('campaign_id', campaignId),
    client.from('public_items').select('id, name, weight, qty, tag, durability, max_durability, container_id, compartment_id, position').eq('campaign_id', campaignId),
    client.from('public_containers').select('id, name, own_weight, max_slots, parent_container_id, compartment_id, position').eq('campaign_id', campaignId),
    client.from('public_currency').select('*').eq('campaign_id', campaignId).maybeSingle(),
    client.from('discord_public_messages').select('*').eq('campaign_id', campaignId),
  ]);

  const itemsList = (items ?? []) as PublicItem[];
  const containersList = (containers ?? []) as PublicContainer[];
  const sectionByCompartment = new Map<string | null, { id: string; message_ids: string[] }>();
  (sections ?? []).forEach((s: any) => sectionByCompartment.set(s.compartment_id, { id: s.id, message_ids: Array.isArray(s.message_ids) ? s.message_ids : [] }));

  const targetCompartmentIds = new Set((compartments ?? []).map((c: any) => c.id));

  // apaga seções órfãs (compartimento excluído) — em paralelo, uma seção não depende da outra
  const orphanSections = Array.from(sectionByCompartment.entries()).filter(([compId]) => compId !== null && !targetCompartmentIds.has(compId));
  await Promise.all(
    orphanSections.map(async ([compId, section]) => {
      await Promise.all(section.message_ids.map((msgId) => deleteMessage(config.channel_id, msgId)));
      await client.from('discord_public_messages').delete().eq('id', section.id);
      sectionByCompartment.delete(compId);
    }),
  );

  // grava o novo array de message_ids de uma seção — atualiza se já existe
  // linha de rastreio, insere se for a primeira vez (evita depender de
  // upsert/onConflict, que não cobre bem o índice parcial do caso "avulso")
  async function saveSection(compartmentId: string | null, section: { id: string; message_ids: string[] } | undefined, ids: string[]) {
    if (section) {
      await client.from('discord_public_messages').update({ message_ids: ids, updated_at: new Date().toISOString() }).eq('id', section.id);
    } else {
      await client.from('discord_public_messages').insert({ campaign_id: campaignId, compartment_id: compartmentId, message_ids: ids });
    }
  }

  // avulso + cada compartimento em paralelo — seções independentes, sem
  // motivo pra esperar uma terminar antes de começar a próxima
  const avulsoTask = (async () => {
    const avulsoText = buildPublicAvulsoText(itemsList, containersList, currency ?? null);
    const avulsoChunks = splitIntoChunks(avulsoText);
    const avulsoSection = sectionByCompartment.get(null);
    const avulsoIds = await syncMessageList(config.channel_id, avulsoSection?.message_ids ?? [], avulsoChunks, (i) => `rp:avulso:${campaignId}:${i}`);
    await saveSection(null, avulsoSection, avulsoIds);
  })();

  const compartmentTasks = (compartments ?? []).map(async (comp) => {
    const text = buildPublicCompartmentText(comp.name, comp.id, itemsList, containersList, comp.currency ?? null);
    const chunks = splitIntoChunks(text);
    const section = sectionByCompartment.get(comp.id);
    const ids = await syncMessageList(config.channel_id, section?.message_ids ?? [], chunks, (i) => `rp:${comp.id}:${campaignId}:${i}`);
    await saveSection(comp.id, section, ids);
  });

  await Promise.all([avulsoTask, ...compartmentTasks]);
}
