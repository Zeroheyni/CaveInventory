import { supabase } from './supabaseClient.js';
import { getMyProfile, getCampaign, applyGlobalTheme } from './campaign.js';
import { listMyMemberships, listMyCharacters, effectiveProfile, rememberCharacter, lastCharacter } from './accounts.js';
import { renderLogin } from './screens/login.js';
import { renderCharacterScreen } from './screens/character.js';
import { renderHome } from './screens/home.js';
import { renderProfileScreen } from './screens/profile.js';
import { renderMasterCampaignHub } from './screens/masterCampaignHub.js';
import { renderAdminScreen } from './screens/admin.js';

const app = document.getElementById('app');

// Trocar de personagem/mesa sem recarregar a página: derruba TODOS os canais realtime
// (combate, dados, ficha, banco de NPCs, tabuleiro... alguns nunca eram removidos) e monta de novo.
export async function switchContext() {
  try {
    // não deixa a tela esperando o ack de cada canal (sem rede, cada um demora até estourar o timeout)
    await Promise.race([supabase.removeAllChannels(), new Promise((r) => setTimeout(r, 600))]);
  } catch (_) { /* canais já fechados */ }
  return renderApp();
}

export async function renderApp() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    renderLogin(app, renderApp);
    return;
  }

  let profile;
  try {
    profile = await getMyProfile(session.user.id);
  } catch (err) {
    renderFatalError(err);
    return;
  }

  applyGlobalTheme(profile && profile.theme);

  if (!profile) {
    renderFatalError(new Error('conta sem perfil -- fale com o mestre'));
    return;
  }

  let memberships = [];
  let characters = [];
  try {
    [memberships, characters] = await Promise.all([listMyMemberships(profile.id), listMyCharacters(profile.id)]);
  } catch (err) {
    renderFatalError(err);
    return;
  }

  const isAdmin = !!profile.is_superadmin;
  // mesas em que a conta é MESTRE (dona, ou membro com papel de mestre)
  const masterCampaigns = memberships
    .filter((m) => m.role === 'master' || m.campaigns.master_id === profile.id)
    .map((m) => m.campaigns);

  // jogar um personagem: o perfil entregue às telas é o "efetivo" (papel/flags da mesa dele)
  async function play(character) {
    let campaign;
    try {
      campaign = await getCampaign(character.campaign_id);
    } catch (err) {
      renderFatalError(err);
      return;
    }
    if (!campaign) {
      renderFatalError(new Error('campanha desse personagem não encontrada'));
      return;
    }
    const membership = memberships.find((m) => m.campaign_id === campaign.id) || null;
    rememberCharacter(profile.id, character.id);
    renderCharacterScreen(app, {
      session,
      profile: effectiveProfile(profile, campaign, membership, { asPlayer: true }),
      campaign,
      playCharacterId: character.id,
      onSwitchCharacter: switchContext,
    });
  }

  // painel de mestre (combate, fichas, NPCs, tabuleiro...) de uma mesa
  function openMaster(campaign) {
    const membership = memberships.find((m) => m.campaign_id === campaign.id) || null;
    renderMasterCampaignHub(app, {
      session,
      profile: effectiveProfile(profile, campaign, membership),
      campaign,
      onBack: switchContext,
    });
  }

  const isMasterish = isAdmin || masterCampaigns.length > 0 || profile.role === 'master';
  const kinds = [isAdmin ? 'ADM' : null, isMasterish ? 'mestre' : null, characters.length || !isMasterish ? 'jogador' : null].filter(Boolean);

  function openProfile() {
    renderProfileScreen(app, { session, profile, kinds, onBack: switchContext });
  }

  function openManage() {
    renderAdminScreen(app, { session, profile, memberships, characters, onHome: switchContext, onOpenProfile: openProfile });
  }

  // tela inicial: todo mundo (jogador, mestre, ADM) cai na escolha de personagem; mestre ganha o cartão do painel da mesa
  renderHome(app, {
    profile,
    characters,
    masterCampaigns,
    isAdmin,
    lastId: lastCharacter(profile.id),
    onPick: play,
    onOpenMaster: openMaster,
    onOpenManage: openManage,
    onOpenProfile: openProfile,
  });
}

function renderFatalError(err) {
  app.innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <p class="auth-error" style="display:block;">Erro ao carregar sua sessão: ${err.message}</p>
      </div>
    </div>
  `;
}
