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
    .select('player_name, best_score, achieved_at')
    .eq('campaign_id', campaignId)
    .eq('game', game)
    .order('best_score', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
