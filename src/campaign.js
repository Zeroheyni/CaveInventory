import { supabase } from './supabaseClient.js';

export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCampaign(campaignId) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// tema é preferência da conta (profiles.theme), não do personagem --
// assim aplica em qualquer tela (painel admin incluso) e sobrevive
// trocar de dispositivo, sem depender de existir um personagem.
export async function updateProfileTheme(userId, theme) {
  const { error } = await supabase.from('profiles').update({ theme }).eq('id', userId);
  if (error) throw error;
}

// null/'caverna-azul' = tema padrão (sem atributo, ver theme.css).
export function applyGlobalTheme(themeId) {
  if (!themeId || themeId === 'caverna-azul') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', themeId);
}

