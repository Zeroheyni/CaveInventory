// Ficha do personagem no Discord (canal da FICHA, db/084_patch_discord_sheet.sql) -- separado do canal do INVENTÁRIO
// (discord-sync-character). Chamada pelo banco (trigger em sessão ao vivo / request_discord_sync) com o segredo
// compartilhado, e pelo botão "🔄 atualizar" da própria mensagem (via discord-interactions, custom_id "rs:<id>:0").
//
// AUTOCONTIDA DE PROPÓSITO (um arquivo só, sem ../_shared): é o que dá pra colar no editor do Dashboard do Supabase.
// O bloco GENERATED-DATA é gerado por `node scripts/gen-discord-sheet-data.mjs` a partir de src/systems/* -- não editar à mão.
//
// Cada sistema de regras tem seu "formato de ficha" em SHEET_BUILDERS; sistema novo = uma função nova + a linha no mapa.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// <GENERATED-DATA>
// (gerado por scripts/gen-discord-sheet-data.mjs -- não editar à mão)
type MslAttr = { key: string; label: string; short: string; group: string; sub: string | null };
type Perk = { name: string; level: number; bonus?: Record<string, number> };
const MSL: { attributes: MslAttr[]; subgroups: { id: string; label: string; icon: string }[]; advantages: Record<string, Perk>; disadvantages: Record<string, Perk> } = {"attributes":[{"key":"forca","label":"Força","short":"Força","group":"basico","sub":"potencia"},{"key":"poder_magico","label":"Poder Mágico","short":"Poder Mágico","group":"basico","sub":"potencia"},{"key":"agilidade","label":"Agilidade","short":"Agilidade","group":"basico","sub":"mobilidade"},{"key":"reflexos","label":"Reflexos","short":"Reflexos","group":"basico","sub":"mobilidade"},{"key":"res_fisica","label":"Resistência Física","short":"Física","group":"basico","sub":"resistencia"},{"key":"res_magica","label":"Resistência Mágica","short":"Mágica","group":"basico","sub":"resistencia"},{"key":"intelecto","label":"Intelecto","short":"Intelecto","group":"basico","sub":"foco"},{"key":"disciplina","label":"Disciplina","short":"Disciplina","group":"basico","sub":"foco"},{"key":"prec_fisica","label":"Precisão Física","short":"Física","group":"basico","sub":"precisao"},{"key":"prec_magica","label":"Precisão Mágica","short":"Mágica","group":"basico","sub":"precisao"},{"key":"estamina","label":"Estamina","short":"Estamina","group":"basico","sub":"vigor"},{"key":"vitalidade","label":"Vitalidade","short":"Vitalidade","group":"basico","sub":"vigor"},{"key":"ameacar","label":"Ameaçar","short":"Ameaçar","group":"social","sub":null},{"key":"acalmar","label":"Acalmar","short":"Acalmar","group":"social","sub":null},{"key":"enganacao","label":"Enganação","short":"Enganação","group":"social","sub":null},{"key":"perspicacia","label":"Perspicácia","short":"Perspicácia","group":"social","sub":null},{"key":"autocontrole","label":"Autocontrole","short":"Autocontrole","group":"social","sub":null},{"key":"armazenamento","label":"Armazenamento","short":"Armazenamento","group":"magico","sub":null},{"key":"canalizacao","label":"Canalização","short":"Canalização","group":"magico","sub":null},{"key":"controle","label":"Controle","short":"Controle","group":"magico","sub":null},{"key":"moldagem","label":"Moldagem","short":"Moldagem","group":"magico","sub":null},{"key":"sensitividade","label":"Sensitividade","short":"Sensitividade","group":"magico","sub":null},{"key":"interpretacao","label":"Interpretação","short":"Interpretação","group":"magico","sub":null}],"subgroups":[{"id":"potencia","label":"Potência","icon":"⚡"},{"id":"mobilidade","label":"Mobilidade","icon":"🏃"},{"id":"resistencia","label":"Resistência","icon":"🛡️"},{"id":"precisao","label":"Precisão","icon":"🎯"},{"id":"foco","label":"Foco","icon":"🧠"},{"id":"vigor","label":"Vigor","icon":"🔥"}],"advantages":{"sentidos_agucados":{"name":"Sentidos Aguçados","level":1},"observador":{"name":"Observador","level":1},"memoria_visual":{"name":"Memória Visual","level":1},"faro_mentiras":{"name":"Faro para Mentiras","level":1},"carismatico":{"name":"Carismático","level":1},"boa_reputacao":{"name":"Boa Reputação Local","level":1},"linguista":{"name":"Linguista","level":1},"pes_ligeiros":{"name":"Pés Ligeiros","level":1},"mao_firme":{"name":"Mão Firme","level":1},"rastreador":{"name":"Rastreador","level":1},"resistente":{"name":"Resistente","level":1},"sangue_frio":{"name":"Sangue Frio","level":1},"resistencia_mental":{"name":"Resistência Mental","level":1},"esquiva_instintiva":{"name":"Esquiva Instintiva","level":2,"bonus":{"reflexos":2}},"robusto":{"name":"Robusto","level":2,"bonus":{"vitalidade":2}},"folego_de_aco":{"name":"Fôlego de Aço","level":2,"bonus":{"estamina":2}},"pele_grossa":{"name":"Pele Grossa","level":2},"foco_de_batalha":{"name":"Foco de Batalha","level":2},"tecnica_precisa":{"name":"Técnica Precisa","level":2},"resistencia_magia":{"name":"Resistência à Magia","level":2,"bonus":{"res_magica":2}},"estavel":{"name":"Estável","level":2},"mestre_em_fuga":{"name":"Mestre em Fuga","level":2},"famoso":{"name":"Famoso","level":2},"aprendiz_de_magia":{"name":"Aprendiz de Magia","level":2},"memoria_muscular":{"name":"Memória Muscular","level":2},"critico_aprimorado":{"name":"Crítico Aprimorado","level":3},"resistencia_elemental":{"name":"Resistência Elemental","level":3},"heranca_arcana":{"name":"Herança Arcana","level":3},"aprendiz_rapido":{"name":"Aprendiz Rápido","level":3},"mestre_em_armas":{"name":"Mestre em Armas","level":3},"ambidestria":{"name":"Ambidestria","level":3},"vontade_de_ferro":{"name":"Vontade de Ferro","level":3},"maos_rapidas":{"name":"Mãos Rápidas","level":3},"olho_do_falcao":{"name":"Olho do Falcão","level":3},"especialista_escola":{"name":"Especialista em Escola","level":3},"reflexos_sobre_humanos":{"name":"Reflexos Sobre-Humanos","level":3},"aura_intimidadora":{"name":"Aura Intimidadora","level":3}},"disadvantages":{"ingenuo":{"name":"Ingênuo","level":1},"pessimo_mentiroso":{"name":"Péssimo Mentiroso","level":1},"visao_ruim":{"name":"Visão Ruim","level":1},"intolerancia":{"name":"Intolerância","level":1},"medroso":{"name":"Medroso","level":1},"medo_de_altura":{"name":"Medo de Altura","level":1},"tosse_cronica":{"name":"Tosse Crônica","level":1},"voz_rouca":{"name":"Voz Rouca","level":1},"mau_olhado":{"name":"Mau Olhado","level":1},"alergia_comum":{"name":"Alergia Comum","level":1},"mao_tremequeira":{"name":"Mão Tremequeira","level":1},"sono_pesado":{"name":"Sono Pesado","level":1},"sono_leve":{"name":"Sono Leve","level":2},"propenso_ferimentos":{"name":"Propenso a Ferimentos","level":2},"mente_aberta":{"name":"Mente Aberta","level":2},"divida_de_jogo":{"name":"Dívida de Jogo","level":2},"alergia_metais":{"name":"Alergia a Metais","level":2},"dieta_restrita":{"name":"Dieta Restrita","level":2},"vicio":{"name":"Vício","level":2},"perna_machucada":{"name":"Perna Machucada","level":2},"instabilidade_magica":{"name":"Instabilidade Mágica","level":2},"rejeicao_social":{"name":"Rejeição Social","level":2},"incapaz_de_mentir":{"name":"Incapaz de Mentir","level":2},"marcado":{"name":"Marcado","level":2},"tatuagem_maldita":{"name":"Tatuagem Maldita","level":2},"dever_familiar":{"name":"Dever Familiar","level":2},"braco_mecanico":{"name":"Braço Mecânico","level":2},"juramento_de_sangue":{"name":"Juramento de Sangue","level":2},"mente_fragmentada":{"name":"Mente Fragmentada","level":3},"mana_instavel":{"name":"Mana Instável","level":3},"trauma_profundo":{"name":"Trauma Profundo","level":3},"inimigo_mortal":{"name":"Inimigo Mortal","level":3},"cego_um_olho":{"name":"Cego de um Olho","level":3},"coracao_fragil":{"name":"Coração Frágil","level":3},"toque_da_morte":{"name":"Toque da Morte","level":3},"maldicao_sangrenta":{"name":"Maldição Sangrenta","level":3},"pacto_obscuro":{"name":"Pacto Obscuro","level":3},"amnesia":{"name":"Amnésia","level":3},"odio_ancestral":{"name":"Ódio Ancestral","level":3},"marca_da_morte":{"name":"Marca da Morte","level":3}}};
const CAVE_ATTRIBUTES: { key: string; label: string; icon: string }[] = [{"key":"vitalidade","label":"Vitalidade","icon":"❤"},{"key":"forca","label":"Força","icon":"💪"},{"key":"agilidade","label":"Agilidade","icon":"🏃"},{"key":"destreza","label":"Destreza","icon":"🎯"},{"key":"inteligencia","label":"Inteligência","icon":"🧠"},{"key":"estamina","label":"Estamina","icon":"⚡"},{"key":"observacao","label":"Observação","icon":"👁"}];
// </GENERATED-DATA>

// ------------------------------------------------------------ utilitários
const API = 'https://discord.com/api/v10';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function serviceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

function botHeaders(): Record<string, string> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN não configurado');
  return { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
}

// texto livre dos jogadores nunca pode virar formatação do Discord
const esc = (s: unknown) => String(s ?? '').replace(/([\\*_~`|>])/g, '\\$1').trim();
const orDash = (s: unknown) => (String(s ?? '').trim() ? esc(s) : '—');

function hashOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h >>> 0) + ':' + text.length;
}

function splitLines(text: string, max = 3900): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (const line of text.split('\n')) {
    if (len + line.length + 1 > max && cur.length) {
      out.push(cur.join('\n'));
      cur = [];
      len = 0;
    }
    cur.push(line);
    len += line.length + 1;
  }
  if (cur.length) out.push(cur.join('\n'));
  return out.length ? out : [''];
}

// ------------------------------------------------------------ mensagens do Discord (embed sem code block: o texto renderiza como está)
function payloadFor(content: string, customId: string) {
  return {
    embeds: [{ description: content, color: 0x3aa0ff }],
    components: [{ type: 1, components: [{ type: 2, style: 2, label: '🔄 atualizar', custom_id: customId }] }],
  };
}

async function discordCall(method: string, path: string, body?: unknown): Promise<Response> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}${path}`, { method, headers: botHeaders(), body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({ retry_after: 1 }));
      await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 50);
      continue;
    }
    if (res.status >= 500 && attempt < 4) {
      await sleep(300 * (attempt + 1));
      continue;
    }
    return res;
  }
  throw new Error('Discord: esgotou tentativas');
}

async function sendMessage(channelId: string, content: string, customId: string): Promise<string> {
  const res = await discordCall('POST', `/channels/${channelId}/messages`, payloadFor(content, customId));
  if (!res.ok) throw new Error(`Discord POST -> ${res.status}: ${await res.text()}`);
  return (await res.json()).id as string;
}

async function syncMessages(channelId: string, existing: string[], contents: string[], customIdFor: (i: number) => string): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < Math.max(existing.length, contents.length); i++) {
    const content = contents[i];
    const id = existing[i];
    if (content === undefined) {
      if (id) await discordCall('DELETE', `/channels/${channelId}/messages/${id}`).catch(() => null);
      continue;
    }
    if (!id) {
      out.push(await sendMessage(channelId, content, customIdFor(i)));
      continue;
    }
    const res = await discordCall('PATCH', `/channels/${channelId}/messages/${id}`, payloadFor(content, customIdFor(i)));
    if (res.ok) out.push(id);
    else if (res.status === 404) out.push(await sendMessage(channelId, content, customIdFor(i))); // apagada à mão: recria
    else {
      console.error(`falha ao editar ${id}: ${res.status} ${await res.text()}`);
      out.push(id); // mantém o id: não duplica, a próxima sincronização tenta de novo
    }
  }
  return out;
}

// trava por personagem (mesma tabela das outras functions do bot): evita 2 execuções paralelas criarem mensagens duplicadas
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = serviceClient();
  const { error } = await client.from('discord_sync_locks').insert({ key });
  if (error) {
    const stale = new Date(Date.now() - 30_000).toISOString();
    const { data: stolen } = await client.from('discord_sync_locks').update({ acquired_at: new Date().toISOString() }).eq('key', key).lt('acquired_at', stale).select();
    if (!stolen || stolen.length === 0) return null;
  }
  try {
    return await fn();
  } finally {
    await client.from('discord_sync_locks').delete().eq('key', key);
  }
}

// ------------------------------------------------------------ formatos de ficha por sistema
const BAR = '━━━━━━━━━━━━━━━';
type Char = {
  id: string; name: string | null; level: number | null; xp: number | null;
  sheet_data: Record<string, unknown> | null; system_data: Record<string, unknown> | null;
  [k: string]: unknown;
};

function headerLines(ch: Char, languages: string[]): string[] {
  const sd = (ch.sheet_data ?? {}) as Record<string, unknown>;
  return [
    BAR,
    `🌑 NOME: ${orDash(ch.name)}`,
    `📅 IDADE: ${orDash(sd.idade)}`,
    `⚧ GÊNERO: ${orDash(sd.genero)}`,
    `🌍 NACIONALIDADE: ${orDash(sd.nacionalidade)}`,
    `🗣️ LÍNGUAS: ${languages.length ? languages.map(esc).join(', ') : '—'}`,
    BAR,
  ];
}

type PerkEntry = { id: string; note?: string };
function perkBonus(entries: PerkEntry[], defs: Record<string, { bonus?: Record<string, number> }>, into: Record<string, number>) {
  for (const e of entries) for (const [k, v] of Object.entries(defs[e.id]?.bonus ?? {})) into[k] = (into[k] || 0) + v;
}
function perkLines(entries: PerkEntry[], defs: Record<string, { name: string; level: number }>): string[] {
  if (!entries.length) return ['•  —'];
  return entries.map((e) => {
    const d = defs[e.id];
    const name = d ? `${d.name} ${d.level}` : esc(e.id);
    return `•  ${name}${e.note ? ` (${esc(e.note)})` : ''}`;
  });
}

function buildMagicLearning(ch: Char): string {
  const msl = ((ch.system_data ?? {}) as { msl?: Record<string, unknown> }).msl ?? {};
  const attrsRaw = (msl.attrs ?? {}) as Record<string, unknown>;
  const adv = (Array.isArray(msl.advantages) ? msl.advantages : []) as PerkEntry[];
  const dis = (Array.isArray(msl.disadvantages) ? msl.disadvantages : []) as PerkEntry[];
  const bonus: Record<string, number> = {};
  perkBonus(adv, MSL.advantages, bonus);
  perkBonus(dis, MSL.disadvantages, bonus);
  const val = (k: string) => Math.max(0, Math.max(0, parseInt(String(attrsRaw[k] ?? 0), 10) || 0) + (bonus[k] || 0));
  const row = (label: string, k: string) => ` • ${label}:  ${val(k)}`;

  const idiomas = (Array.isArray(msl.idiomas) ? msl.idiomas : []) as string[];
  const lines = headerLines(ch, idiomas);
  lines.push('📊 **ATRIBUTOS BÁSICOS**');
  for (const g of MSL.subgroups) {
    lines.push(`${g.icon} **${g.label}**`);
    for (const a of MSL.attributes.filter((x) => x.group === 'basico' && x.sub === g.id)) lines.push(row(a.short, a.key));
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  lines.push(BAR);
  lines.push('🤝 **ATRIBUTOS SOCIAIS**');
  for (const a of MSL.attributes.filter((x) => x.group === 'social')) lines.push(`• ${a.label}:  ${val(a.key)}`);
  if (!msl.noMagic) {
    lines.push(BAR);
    lines.push('✨ **ATRIBUTOS MÁGICOS**');
    for (const a of MSL.attributes.filter((x) => x.group === 'magico')) lines.push(`• ${a.label}:  ${val(a.key)}`);
  }
  // PV: o que ganhou nas desvantagens (teto 8) menos o que gastou nas vantagens
  const gained = Math.min(8, dis.reduce((s, e) => s + (MSL.disadvantages[e.id]?.level ?? 0), 0));
  const spent = adv.reduce((s, e) => s + (MSL.advantages[e.id]?.level ?? 0), 0);
  lines.push(BAR);
  lines.push(`🈹 **PV:** ${gained - spent}`);
  lines.push(BAR);
  lines.push('🌟 **VANTAGENS**');
  lines.push(...perkLines(adv, MSL.advantages));
  lines.push(BAR);
  lines.push('⚠️ **DESVANTAGENS**');
  lines.push(...perkLines(dis, MSL.disadvantages));
  lines.push(BAR);
  return lines.join('\n');
}

function buildCaveStory(ch: Char): string {
  const lines = headerLines(ch, []);
  lines.push(`⭐ **NÍVEL:** ${ch.level ?? 1}  ·  XP ${ch.xp ?? 0}`);
  lines.push(BAR);
  lines.push('📊 **STATUS**');
  for (const a of CAVE_ATTRIBUTES) lines.push(`${a.icon} ${a.label}:  ${Number(ch[a.key] ?? 0)}`);
  lines.push(BAR);
  return lines.join('\n');
}

// system da campanha -> formato da ficha (sistema novo: acrescentar aqui)
const SHEET_BUILDERS: Record<string, (ch: Char) => string> = {
  'magic-learning': buildMagicLearning,
  'cave-story': buildCaveStory,
};

// ------------------------------------------------------------ sincronização
async function syncSheet(characterId: string, onlyIfChanged: boolean) {
  await withLock(`sheet:${characterId}`, async () => {
    const client = serviceClient();
    const { data: config } = await client.from('discord_sheet_config').select('*').eq('character_id', characterId).maybeSingle();
    if (!config) return;
    const { data: ch } = await client
      .from('characters')
      .select('id, name, level, xp, sheet_data, system_data, vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao, campaign_id')
      .eq('id', characterId)
      .maybeSingle();
    if (!ch) return;
    const { data: camp } = await client.from('campaigns').select('system').eq('id', ch.campaign_id).maybeSingle();
    const build = SHEET_BUILDERS[camp?.system ?? 'cave-story'] ?? buildCaveStory;
    const text = build(ch as Char);
    const hash = hashOf(text);
    const ids: string[] = Array.isArray(config.message_ids) ? config.message_ids : [];
    if (onlyIfChanged && config.content_hash === hash && ids.length) return; // gatilho automático: ficha igual, não edita à toa (o botão atualizar sempre refaz)
    const newIds = await syncMessages(config.channel_id, ids, splitLines(text), (i) => `rs:${characterId}:${i}`);
    await client.from('discord_sheet_config').update({ message_ids: newIds, content_hash: hash, updated_at: new Date().toISOString() }).eq('character_id', characterId);
  });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('DISCORD_SYNC_SHARED_SECRET');
  const given = req.headers.get('x-sync-secret');
  if (!secret || !given || given !== secret) return new Response('unauthorized', { status: 401 });
  try {
    const body = await req.json();
    const characterId = body.character_id ?? body.character?.id;
    if (!characterId) return new Response('missing character id', { status: 400 });
    await syncSheet(characterId, body.only_if_changed === true);
    return new Response('ok');
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
