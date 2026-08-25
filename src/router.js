import { supabase } from './supabaseClient.js';
import { getMyProfile, getCampaign, applyGlobalTheme } from './campaign.js';
import { renderLogin } from './screens/login.js';
import { renderOnboarding } from './screens/onboarding.js';
import { renderCharacterScreen } from './screens/character.js';
import { renderAdminScreen } from './screens/admin.js';

const app = document.getElementById('app');

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

  if (profile && profile.is_superadmin) {
    renderAdminScreen(app, { session, profile });
    return;
  }

  if (!profile || !profile.campaign_id) {
    renderOnboarding(app, renderApp);
    return;
  }

  let campaign;
  try {
    campaign = await getCampaign(profile.campaign_id);
  } catch (err) {
    renderFatalError(err);
    return;
  }

  renderCharacterScreen(app, { session, profile, campaign });
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
