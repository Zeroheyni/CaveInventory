// Backup dos inventários -- ver db/047_patch_character_backups.sql. O banco
// grava as fotos sozinho (trigger); aqui é só listar, criar uma manual e
// restaurar (tudo restrito ao mestre pelas RPCs/RLS).
import { supabase } from './supabaseClient.js';

export const BACKUP_REASON_LABELS = {
  inicial: 'ponto de partida',
  periodico: 'automático',
  reducao: 'antes de cortar pela metade',
  zerado: 'antes de zerar',
  manual: 'manual',
  antes_de_restaurar: 'antes de restaurar',
};

// sem o `data` (pesado) -- só o resumo pra montar a lista
export async function listBackups(characterId, limit = 40) {
  const { data, error } = await supabase
    .from('character_backups')
    .select('id, reason, items_count, containers_count, created_at')
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
