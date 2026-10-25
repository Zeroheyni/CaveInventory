// Ações do Magic Learning que gravam no banco (XP/nível). No Cave Story isso é RPC no servidor (grant_xp...); aqui o mestre (que já tem
// permissão de edição nas fichas da própria mesa) calcula no cliente com as regras de magic-learning.js e grava de uma vez.
import { supabase } from '../supabaseClient.js';
import { applyXp, xpNeededFor, mslOf } from './magic-learning.js';

async function loadRows(ids) {
  const { data, error } = await supabase.from('characters').select('id, level, xp, system_data').in('id', ids);
  if (error) throw error;
  return data || [];
}

function withPool(row, gains) {
  const m = mslOf(row);
  const raw = (row.system_data && row.system_data.msl) || {};
  return {
    ...(row.system_data || {}),
    msl: {
      ...raw,
      initialized: true,
      pool: {
        basicos: m.pool.basicos + gains.basicos,
        sociais: m.pool.sociais + gains.sociais,
        magicos: m.pool.magicos + gains.magicos,
      },
      skillGrades: m.skillGrades + gains.pericia,
    },
  };
}

// soma XP, sobe de nível (e concede pontos de atributo / grau de perícia) quantas vezes precisar
export async function grantXpMsl(characterIds, amount) {
  const rows = await loadRows(characterIds);
  for (const row of rows) {
    const r = applyXp(row.level, row.xp, amount);
    const patch = { level: r.level, xp: r.xp };
    if (r.levelsGained > 0) patch.system_data = withPool(row, r.gains);
    const { error } = await supabase.from('characters').update(patch).eq('id', row.id);
    if (error) throw error;
  }
}

// tira XP (desce de nível se precisar); os pontos já concedidos em níveis anteriores o mestre ajusta à mão
export async function revokeXpMsl(characterIds, amount) {
  const rows = await loadRows(characterIds);
  for (const row of rows) {
    let level = Math.max(1, row.level);
    let xp = row.xp - amount;
    while (xp < 0 && level > 1) {
      level -= 1;
      xp += xpNeededFor(level);
    }
    const { error } = await supabase.from('characters').update({ level, xp: Math.max(0, xp) }).eq('id', row.id);
    if (error) throw error;
  }
}

export async function demoteLevelMsl(characterIds, levels) {
  const rows = await loadRows(characterIds);
  for (const row of rows) {
    const level = Math.max(1, row.level - levels);
    const { error } = await supabase.from('characters').update({ level, xp: 0 }).eq('id', row.id);
    if (error) throw error;
  }
}
