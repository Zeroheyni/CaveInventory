// Backup dos inventários -- ver db/047 e db/048. O banco grava as fotos
// sozinho (trigger); aqui é listar, criar uma manual, restaurar (tudo
// restrito ao mestre pelas RPCs/RLS) e exportar/importar um ARQUIVO --
// a única cópia que sobrevive se o projeto do Supabase inteiro se perder.
import { supabase } from './supabaseClient.js';

export const BACKUP_REASON_LABELS = {
  inicial: 'ponto de partida',
  periodico: 'automático',
  reducao: 'antes de cortar pela metade',
  zerado: 'antes de zerar',
  manual: 'manual',
  antes_de_restaurar: 'antes de restaurar',
  excluido: 'personagem excluído',
};

// sem o `data` (pesado) -- só o resumo pra montar a lista
export async function listBackups(characterId, limit = 40) {
  const { data, error } = await supabase
    .from('character_backups')
    .select('id, reason, items_count, containers_count, new_items_count, created_at')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function restoreBackup(backupId) {
  const { error } = await supabase.rpc('restore_character_backup', { p_backup_id: backupId });
  if (error) throw error;
}

export async function createBackup(characterId) {
  const { error } = await supabase.rpc('create_character_backup', { p_character_id: characterId });
  if (error) throw error;
}

// ---- arquivo (cópia fora do Supabase) ----
const EXPORT_MARKER = 'CaveInventory-inventarios';
const LAST_EXPORT_KEY = 'caveinv_last_inventory_export';

export async function buildInventoryExport(campaign) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, is_npc, data, currency')
    .eq('campaign_id', campaign.id)
    .order('name');
  if (error) throw error;
  return {
    app: EXPORT_MARKER,
    version: 1,
    exportedAt: new Date().toISOString(),
    campaignId: campaign.id,
    campaignName: campaign.name,
    characters: (data || []).map((c) => ({ id: c.id, name: c.name, isNpc: !!c.is_npc, data: c.data, currency: c.currency })),
  };
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function markExported() {
  try { localStorage.setItem(LAST_EXPORT_KEY, String(Date.now())); } catch (_) { /* sem storage: só não lembra */ }
}
// dias desde a última exportação feita neste navegador (null = nunca)
export function daysSinceExport() {
  try {
    const v = Number(localStorage.getItem(LAST_EXPORT_KEY));
    return v ? Math.floor((Date.now() - v) / 86400000) : null;
  } catch (_) { return null; }
}

// lê e valida o arquivo; devolve só as entradas que têm o formato de inventário
export function parseInventoryExport(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (_) { throw new Error('o arquivo não é um JSON válido'); }
  if (!obj || obj.app !== EXPORT_MARKER || !Array.isArray(obj.characters)) {
    throw new Error('esse arquivo não parece uma exportação de inventários do CaveInventory');
  }
  return {
    exportedAt: obj.exportedAt,
    characters: obj.characters.filter(
      (c) => c && c.id && c.data && Array.isArray(c.data.items) && Array.isArray(c.data.containers)
    ),
  };
}

export async function importInventory(characterId, data, currency) {
  const { error } = await supabase.rpc('import_character_inventory', {
    p_character_id: characterId,
    p_data: data,
    p_currency: currency || null,
  });
  if (error) throw error;
}
