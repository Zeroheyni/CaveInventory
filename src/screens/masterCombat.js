// Acesso direto do mestre global ao rastreador de combate de uma
// campanha, sem precisar abrir o inventário de nenhum personagem —
// só um header mínimo + a mesma tela de combate embutida em
// character.js (mesmo componente, reaproveitado).
import { renderCombatScreen } from './combat.js';

export function renderMasterCombatScreen(app, { session, profile, campaign, onBack }) {
  app.innerHTML = `
    <div class="wrap">
      <div class="header">
        <div>
          <div class="title"><span class="dot"></span>COMBATE</div>
          <div class="id">${escapeHtml(campaign.name)}</div>
        </div>
        <button type="button" class="campaign-strip-signout" id="master-combat-back">← voltar ao painel</button>
      </div>
      <div id="master-combat-embed"></div>
    </div>
  `;

  document.getElementById('master-combat-back').addEventListener('click', onBack);

  renderCombatScreen(document.getElementById('master-combat-embed'), {
    session,
    profile,
    campaign,
    characterId: null,
    characterName: null,
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
