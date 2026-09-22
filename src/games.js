// Easter egg — camada de dados do ranking dos minijogos escondidos
// (Cobrinha/Tetris). Ver db/042_patch_game_scores.sql.
import { supabase } from './supabaseClient.js';

export async function submitGameScore(game, score, playerName) {
  const { error } = await supabase.rpc('submit_game_score', { p_game: game, p_score: Math.round(score), p_player_name: playerName });
  if (error) throw error;
}

export async function listHighScores(campaignId, game, limit = 10) {
  const { data, error } = await supabase
    .from('game_high_scores')
    .select('profile_id, player_name, best_score, achieved_at')
    .eq('campaign_id', campaignId)
    .eq('game', game)
    .order('best_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// temas desbloqueáveis (db/049) -- lista os jogos em que essa conta já
// segurou o recorde da campanha pelo menos uma vez (mesmo que tenha
// perdido o topo depois, o desbloqueio é pra sempre).
export async function listUnlockedGameThemes(profileId) {
  const { data, error } = await supabase.from('game_theme_unlocks').select('game').eq('profile_id', profileId);
  if (error) throw error;
  return (data || []).map((r) => r.game);
}
