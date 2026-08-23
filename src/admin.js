import { supabase } from './supabaseClient.js';
import { nicknameToEmail, padPassword } from './nickname.js';
import { setRerenderSuppressed } from './auth.js';

export async function listAllCampaigns() {
  const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listAllProfiles() {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  return data;
}

export async function listCharactersInCampaign(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error) throw error;
  return data;
}

export async function createCampaignAsAdmin(name) {
  const { data, error } = await supabase.from('campaigns').insert({ name }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCampaignAsAdmin(campaignId) {
  const { error } = await supabase.from('campaigns').delete().eq('id', campaignId);
  if (error) throw error;
}

// Cria uma conta de jogador (apelido + senha, sem e-mail de verdade) já
// vinculada a uma campanha específica. Só o mestre chama isso.
//
// supabase.auth.signUp() troca a sessão do navegador pra sessão do usuário
// recém-criado — por isso guardamos a sessão do mestre antes e restauramos
// depois, sem precisar da senha dele.
export async function createPlayerAccount(nickname, password, campaignId) {
  const {
    data: { session: masterSession },
  } = await supabase.auth.getSession();

  setRerenderSuppressed(true);
  try {
    const email = nicknameToEmail(nickname);
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password: padPassword(password) });

    if (signUpError) {
      if (masterSession) {
        await supabase.auth.setSession({
          access_token: masterSession.access_token,
          refresh_token: masterSession.refresh_token,
        });
      }
      throw signUpError;
    }

    const newUserId = signUpData.user.id;

    const { error: rpcError } = await supabase.rpc('complete_player_account', {
      p_campaign_id: campaignId,
      p_username: nickname,
    });

    if (masterSession) {
      await supabase.auth.setSession({
        access_token: masterSession.access_token,
        refresh_token: masterSession.refresh_token,
      });
    }

    if (rpcError) throw rpcError;

    return { id: newUserId, username: nickname };
  } finally {
    setRerenderSuppressed(false);
  }
}
