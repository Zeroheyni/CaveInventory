import { supabase } from './supabaseClient.js';
import { getMyProfile, getCampaign, applyGlobalTheme } from './campaign.js';
import { listMyMemberships, listMyCharacters, effectiveProfile, rememberCharacter, lastCharacter } from './accounts.js';
import { renderLogin } from './screens/login.js';
import { renderCharacterScreen } from './screens/character.js';
import { renderCharacterPicker } from './screens/characterPicker.js';
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

  const isMasterAccount =
    !!profile.is_superadmin || profile.role === 'master' || memberships.some((m) => m.role === 'master');

  // ADM e contas de mestre: painel (ADM vê tudo; mestre vê só as próprias mesas -- o banco filtra)
  if (isMasterAccount) {
    renderAdminScreen(app, { session, profile, memberships, characters, onPlayCharacter: play });
    return;
  }

  // a conta de jogador não pertence a mesa nenhuma: a tela inicial é sempre a escolha de personagem
  renderCharacterPicker(app, { profile, characters, lastId: lastCharacter(profile.id), onPick: play });
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
