// Portado de src/screens/character.js (buildInventoryText/buildTransportSection,
// linhas ~2565-2661) e da lógica de peso/slots de src/screens/publicArea.js —
// mesma matemática, mesmo visual (caixas ╔═╗ + emojis), só que rodando no
// servidor (Deno/Edge Function) em vez do navegador, e devolvendo texto puro
// em vez de mexer no DOM.

export const TAGS: Record<string, { label: string; emoji: string }> = {
  arma: { label: 'Arma', emoji: '⚔️' },
  bolsa: { label: 'Bolsa', emoji: '🎒' },
  vestimenta: { label: 'Vestimenta', emoji: '🛡️' },
  alimento: { label: 'Alimento', emoji: '🍞' },
  pocao: { label: 'Poção', emoji: '🧪' },
  ferramenta: { label: 'Ferramenta', emoji: '🛠️' },
  material: { label: 'Material', emoji: '🧱' },
  acessorio: { label: 'Acessório', emoji: '💍' },
  municao: { label: 'Munição', emoji: '🎯' },
  consumivel: { label: 'Consumível', emoji: '💊' },
  quest: { label: 'Quest', emoji: '⭐' },
  recipiente: { label: 'Recipiente', emoji: '📦' },
  tesouro: { label: 'Tesouro', emoji: '💰' },
  outro: { label: 'Outros', emoji: '❔' },
};

export const TAG_ORDER = [
  'arma', 'vestimenta', 'acessorio', 'alimento', 'pocao', 'consumivel', 'ferramenta',
  'material', 'municao', 'quest', 'tesouro', 'recipiente', 'bolsa', 'outro',
];

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Currency = { bronze: number; silver: number; gold: number; platinum: number } | null | undefined;

// caixinha padrão de moedas, reaproveitada pelo inventário do personagem e
// pelas seções da área pública — só aparece se houver alguma moeda > 0
export function currencyBox(currency: Currency): string[] {
  if (!currency) return [];
  const { bronze, silver, gold, platinum } = currency;
  if (!bronze && !silver && !gold && !platinum) return [];
  return ['╔══ 💰 MOEDAS ══╗', ` ${bronze}b  ${silver}s  ${gold}o  ${platinum}p`, '╚═══════════════╝'];
}

// nomes vêm de input livre do jogador — nunca deixa um item quebrar o code block do Discord
function sanitize(str: string | null | undefined): string {
  return (str ?? '').replace(/`/g, "'");
}

// ============================================================
// INVENTÁRIO PESSOAL (personagem) — mesmo shape de character.js: state.items,
// state.containers (com .contents:[{type,id}]), state.order, state.equip*
// ============================================================

type CharItem = {
  id: string; name: string; weight: number; qty: number; tag?: string;
  durability?: number | null; maxDurability?: number | null;
};
type CharContainer = {
  id: string; name: string; ownWeight: number; maxSlots: number;
  contents: { type: 'item' | 'container'; id: string }[];
};
type CharEquipSlot = { key: string; label: string; reduceWeight?: boolean };
type CharData = {
  items?: CharItem[]; containers?: CharContainer[]; order?: { type: 'item' | 'container'; id: string }[];
  equipSlots?: CharEquipSlot[]; equip?: Record<string, string>;
  transportPersonal?: { type: 'item' | 'container'; id: string }[];
};

function findItemContainer(data: CharData, itemId: string): CharContainer | undefined {
  return (data.containers ?? []).find((c) => c.contents.some((e) => e.type === 'item' && e.id === itemId));
}
function isEquippedInReducingSlot(data: CharData, type: string, id: string): boolean {
  const val = `${type}:${id}`;
  return (data.equipSlots ?? []).some((s) => s.reduceWeight && data.equip?.[s.key] === val);
}
function applyEquipReduction(data: CharData, weight: number, type: string, id: string): number {
  return isEquippedInReducingSlot(data, type, id) ? Math.floor(weight / 2) : weight;
}
function effectiveUnitWeight(data: CharData, item: CharItem): number {
  return findItemContainer(data, item.id) ? Math.floor(item.weight / 2) : item.weight;
}
function itemSubtotal(data: CharData, item: CharItem): number {
  return effectiveUnitWeight(data, item) * item.qty;
}
function containerIntrinsicTotal(data: CharData, c: CharContainer): number {
  let total = c.ownWeight;
  for (const entry of c.contents) {
    if (entry.type === 'item') {
      const it = (data.items ?? []).find((i) => i.id === entry.id);
      if (it) total += itemSubtotal(data, it);
    } else {
      const nested = (data.containers ?? []).find((cc) => cc.id === entry.id);
      if (nested) {
        let contrib = Math.floor(containerIntrinsicTotal(data, nested) / 2);
        contrib = applyEquipReduction(data, contrib, 'container', nested.id);
        total += contrib;
      }
    }
  }
  return total;
}
function totalWeight(data: CharData): number {
  return (data.order ?? []).reduce((sum, entry) => {
    if (entry.type === 'item') {
      const it = (data.items ?? []).find((i) => i.id === entry.id);
      return sum + (it ? itemSubtotal(data, it) : 0);
    }
    const c = (data.containers ?? []).find((cc) => cc.id === entry.id);
    if (!c) return sum;
    return sum + applyEquipReduction(data, containerIntrinsicTotal(data, c), 'container', c.id);
  }, 0);
}
function transportListWeight(data: CharData, list: { type: 'item' | 'container'; id: string }[]): number {
  return list.reduce((sum, entry) => {
    if (entry.type === 'item') {
      const it = (data.items ?? []).find((i) => i.id === entry.id);
      return sum + (it ? itemSubtotal(data, it) : 0);
    }
    const c = (data.containers ?? []).find((cc) => cc.id === entry.id);
    return c ? sum + containerIntrinsicTotal(data, c) : sum;
  }, 0);
}
function itemCopyLine(it: CharItem): string {
  const qtyTxt = it.qty > 1 ? ` (x${it.qty})` : '';
  const durTxt = it.maxDurability !== null && it.maxDurability !== undefined ? ` (DU: ${it.durability}/${it.maxDurability})` : '';
  return `${sanitize(it.name)}${qtyTxt}${durTxt}`;
}
function appendCharContainerLines(lines: string[], data: CharData, c: CharContainer, depth: number) {
  const indent = '  '.repeat(depth);
  const used = c.contents.reduce((sum, e) => {
    if (e.type === 'item') { const it = (data.items ?? []).find((i) => i.id === e.id); return sum + (it ? it.qty : 0); }
    return sum + 1;
  }, 0);
  const tot = round(containerIntrinsicTotal(data, c));
  lines.push(`${indent}📦 ${sanitize(c.name)} (${used}/${c.maxSlots} slots, ${tot} carga)`);
  c.contents.forEach((entry) => {
    if (entry.type === 'item') {
      const it = (data.items ?? []).find((i) => i.id === entry.id);
      if (it) lines.push(`${indent}  • ${itemCopyLine(it)}`);
    } else {
      const nested = (data.containers ?? []).find((cc) => cc.id === entry.id);
      if (nested) appendCharContainerLines(lines, data, nested, depth + 1);
    }
  });
}
function slotEquipLabel(data: CharData, val: string | undefined): string {
  if (!val) return '—';
  const [t, id] = val.split(':');
  if (t === 'item') { const it = (data.items ?? []).find((i) => i.id === id); return it ? sanitize(it.name) : '—'; }
  if (t === 'container') { const c = (data.containers ?? []).find((cc) => cc.id === id); return c ? sanitize(c.name) : '—'; }
  return '—';
}

export function buildCharacterInventoryText(maxCarga: number, data: CharData, currency?: Currency): string {
  const lines: string[] = [];
  const total = round(totalWeight(data));
  const max = round(maxCarga);
  lines.push('╔════════ INVENTÁRIO ════════╗');
  lines.push(` 🎒 Carga: ${total}/${max}`);
  lines.push('─────────────────────────────');

  const topItems = (data.order ?? [])
    .filter((e) => e.type === 'item')
    .map((e) => (data.items ?? []).find((i) => i.id === e.id))
    .filter((x): x is CharItem => !!x);
  const grouped: Record<string, CharItem[]> = {};
  topItems.forEach((it) => { const tag = it.tag || 'outro'; (grouped[tag] ??= []).push(it); });
  TAG_ORDER.forEach((tagKey) => {
    if (!grouped[tagKey]) return;
    const def = TAGS[tagKey];
    lines.push(`${def.emoji} ${def.label}:`);
    grouped[tagKey].forEach((it) => lines.push(`  • ${itemCopyLine(it)}`));
    lines.push('');
  });

  const topContainers = (data.order ?? [])
    .filter((e) => e.type === 'container')
    .map((e) => (data.containers ?? []).find((c) => c.id === e.id))
    .filter((x): x is CharContainer => !!x);
  if (topContainers.length) {
    lines.push('🎒 Recipientes:');
    topContainers.forEach((c) => appendCharContainerLines(lines, data, c, 1));
    lines.push('');
  }

  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push('╚═══════════════════════════╝');
  lines.push('');
  lines.push('╔════════ EQUIPAMENTO ═══════╗');
  (data.equipSlots ?? []).forEach((slot) => lines.push(`${slot.label}: ${slotEquipLabel(data, data.equip?.[slot.key])}`));
  lines.push('╚═══════════════════════════╝');
  const coinLines = currencyBox(currency);
  if (coinLines.length) { lines.push(''); lines.push(...coinLines); }
  return lines.join('\n');
}

export function buildCharacterTransportPersonalText(maxCarga: number, data: CharData): string {
  const list = data.transportPersonal ?? [];
  const lines: string[] = [];
  const total = round(transportListWeight(data, list));
  lines.push('╔══════ ESPAÇO PESSOAL (transporte) ══════╗');
  lines.push(` 🎒 Carga: ${total}/${round(maxCarga)}`);
  lines.push('───────────────────────────────────────────');
  const topItems = list.filter((e) => e.type === 'item').map((e) => (data.items ?? []).find((i) => i.id === e.id)).filter((x): x is CharItem => !!x);
  const topContainers = list.filter((e) => e.type === 'container').map((e) => (data.containers ?? []).find((c) => c.id === e.id)).filter((x): x is CharContainer => !!x);
  if (topItems.length === 0 && topContainers.length === 0) {
    lines.push('  (vazio)');
  } else {
    const grouped: Record<string, CharItem[]> = {};
    topItems.forEach((it) => { const tag = it.tag || 'outro'; (grouped[tag] ??= []).push(it); });
    TAG_ORDER.forEach((tagKey) => {
      if (!grouped[tagKey]) return;
      const def = TAGS[tagKey];
      lines.push(`${def.emoji} ${def.label}:`);
      grouped[tagKey].forEach((it) => lines.push(`  • ${itemCopyLine(it)}`));
    });
    if (topContainers.length) {
      lines.push('📦 Recipientes:');
      topContainers.forEach((c) => appendCharContainerLines(lines, data, c, 1));
    }
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push('╚═══════════════════════════════════════════╝');
  return lines.join('\n');
}

// ============================================================
// ÁREA PÚBLICA (Baú Compartilhado real — tabelas public_*, não o
// transportPublic/state.compartments legado embutido no personagem)
// ============================================================

export type PublicItem = {
  id: string; name: string; weight: number; qty: number; tag?: string | null;
  durability?: number | null; max_durability?: number | null;
  container_id: string | null; compartment_id: string | null; position: number;
};
export type PublicContainer = {
  id: string; name: string; own_weight: number; max_slots: number;
  parent_container_id: string | null; compartment_id: string | null; position: number;
};
export type PublicCurrency = { bronze: number; silver: number; gold: number; platinum: number } | null;

function publicItemLine(it: PublicItem): string {
  const qtyTxt = it.qty > 1 ? ` (x${it.qty})` : '';
  const durTxt = it.max_durability !== null && it.max_durability !== undefined ? ` (DU: ${it.durability}/${it.max_durability})` : '';
  return `${sanitize(it.name)}${qtyTxt}${durTxt}`;
}
function publicEffectiveUnitWeight(it: PublicItem): number {
  return it.container_id ? Math.floor(it.weight / 2) : it.weight;
}
function publicItemSubtotal(it: PublicItem): number {
  return publicEffectiveUnitWeight(it) * it.qty;
}
function publicContainerIntrinsicTotal(c: PublicContainer, items: PublicItem[], containers: PublicContainer[]): number {
  let total = c.own_weight;
  for (const it of items) if (it.container_id === c.id) total += publicItemSubtotal(it);
  for (const cc of containers) if (cc.parent_container_id === c.id) total += Math.floor(publicContainerIntrinsicTotal(cc, items, containers) / 2);
  return total;
}
function publicUsedSlots(c: PublicContainer, items: PublicItem[], containers: PublicContainer[]): number {
  let used = 0;
  for (const it of items) if (it.container_id === c.id) used += it.qty;
  for (const cc of containers) if (cc.parent_container_id === c.id) used += 1;
  return used;
}
function appendPublicContainerLines(lines: string[], c: PublicContainer, items: PublicItem[], containers: PublicContainer[], depth: number) {
  const indent = '  '.repeat(depth);
  const used = publicUsedSlots(c, items, containers);
  const tot = round(publicContainerIntrinsicTotal(c, items, containers));
  lines.push(`${indent}📦 ${sanitize(c.name)} (${used}/${c.max_slots} slots, ${tot} carga)`);
  const childItems = items.filter((it) => it.container_id === c.id).sort((a, b) => a.position - b.position);
  const childContainers = containers.filter((cc) => cc.parent_container_id === c.id).sort((a, b) => a.position - b.position);
  const combined = [
    ...childItems.map((it) => ({ position: it.position, render: () => lines.push(`${indent}  • ${publicItemLine(it)}`) })),
    ...childContainers.map((cc) => ({ position: cc.position, render: () => appendPublicContainerLines(lines, cc, items, containers, depth + 1) })),
  ].sort((a, b) => a.position - b.position);
  combined.forEach((e) => e.render());
}

// scope = um compartimento (root: container_id/parent_container_id null && compartment_id === scopeId)
// ou "avulso" (scopeId null: container_id/parent_container_id null && compartment_id null)
function scopeWeight(scopeId: string | null, items: PublicItem[], containers: PublicContainer[]): number {
  const rootItems = items.filter((it) => it.container_id === null && it.compartment_id === scopeId);
  const rootContainers = containers.filter((c) => c.parent_container_id === null && c.compartment_id === scopeId);
  let total = 0;
  rootItems.forEach((it) => { total += publicItemSubtotal(it); });
  rootContainers.forEach((c) => { total += publicContainerIntrinsicTotal(c, items, containers); });
  return total;
}

export function buildPublicCompartmentText(
  compartmentName: string,
  compartmentId: string | null,
  items: PublicItem[],
  containers: PublicContainer[],
  currency: PublicCurrency,
): string {
  const lines: string[] = [];
  const total = round(scopeWeight(compartmentId, items, containers));
  lines.push(`╔═ 📦 ${sanitize(compartmentName).toUpperCase()} ═╗`);
  lines.push(` ⚖️ Carga: ${total}`);
  lines.push('─────────────────────────────');

  const rootItems = items.filter((it) => it.container_id === null && it.compartment_id === compartmentId);
  const rootContainers = containers.filter((c) => c.parent_container_id === null && c.compartment_id === compartmentId);

  if (rootItems.length === 0 && rootContainers.length === 0) {
    lines.push('  (vazio)');
  } else {
    const grouped: Record<string, PublicItem[]> = {};
    rootItems.forEach((it) => { const tag = it.tag || 'outro'; (grouped[tag] ??= []).push(it); });
    TAG_ORDER.forEach((tagKey) => {
      if (!grouped[tagKey]) return;
      const def = TAGS[tagKey];
      lines.push(`${def.emoji} ${def.label}:`);
      grouped[tagKey].sort((a, b) => a.position - b.position).forEach((it) => lines.push(`  • ${publicItemLine(it)}`));
    });
    if (rootContainers.length) {
      lines.push('🎒 Recipientes:');
      rootContainers.sort((a, b) => a.position - b.position).forEach((c) => appendPublicContainerLines(lines, c, items, containers, 1));
    }
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push('╚═══════════════════════════╝');
  const coinLines = currencyBox(currency);
  if (coinLines.length) { lines.push(''); lines.push(...coinLines); }
  return lines.join('\n');
}

export function buildPublicAvulsoText(items: PublicItem[], containers: PublicContainer[], currency: PublicCurrency): string {
  // null é o valor real de compartment_id pros itens soltos — usar a string
  // 'avulso' aqui (como antes) nunca batia com nenhum item de verdade, então
  // a seção avulso no Discord ficava sempre "(vazio)" mesmo com item dentro.
  return buildPublicCompartmentText('Avulso', null, items, containers, currency).replace('📦 AVULSO', '🌐 AVULSO');
}

// ============================================================
// EMPACOTAMENTO — divide um texto grande em várias mensagens sem
// cortar uma linha ao meio. maxChars deixa folga pro fence ``` e pro
// embed não estourar o limite de 4096 chars de descrição do Discord.
// ============================================================
export function splitIntoChunks(text: string, maxChars = 3800): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const line of lines) {
    const lineLen = line.length + 1;
    if (currentLen + lineLen > maxChars && current.length) {
      chunks.push(current.join('\n'));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += lineLen;
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.length ? chunks : [''];
}
