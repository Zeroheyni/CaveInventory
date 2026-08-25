// Acesso do mestre global (superadmin) a uma campanha: antes disso
// existiam duas telas soltas ("abrir combate"/"abrir ficha") que só
// tinham "voltar ao painel" -- pra ir de uma pra outra, ou pro banco
// de NPCs, ou pro inventário de alguém, tinha que voltar pro painel
// global e clicar de novo. Esse hub dá o mesmo menu retrátil à
// esquerda (e o mesmo seletor de tema) que o mestre de campanha já
// tem em character.js, só que reaproveitando as telas já prontas.
import { escapeHtml } from '../shared/gameData.js';
import { applyGlobalTheme, updateProfileTheme } from '../campaign.js';
import { THEMES } from './character.js';
import { renderCombatScreen } from './combat.js';
import { renderMasterFichaScreen } from './masterFicha.js';
import { renderNpcBankScreen } from './npcBank.js';
import { renderMasterInventoryChooser } from './masterInventoryChooser.js';

const NAV_ITEMS = [
  {
    mode: 'inventory',
    label: 'Inventário',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 8V6a5 5 0 0110 0v2"/><rect x="5" y="8" width="14" height="13" rx="2"/><rect x="9.5" y="12" width="5" height="4" rx="1"/></svg>',
  },
  {
    mode: 'combat',
    label: 'Combate',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14.5 4.5l5 5-9 9-3 1 1-3 9-9z"/><path d="M13 6l5 5"/><path d="M5 19l2-2"/></svg>',
  },
  {
    mode: 'ficha',
    label: 'Ficha',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>',
  },
  {
    mode: 'npcs',
    label: 'Banco de NPCs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3"/><path d="M6 10c-1.5 1-2.5 2.7-2.5 4.6" stroke-linecap="round"/><path d="M18 10c1.5 1 2.5 2.7 2.5 4.6" stroke-linecap="round"/><path d="M5 20c1-3.5 3.8-6 7-6s6 2.5 7 6"/></svg>',
  },
];

const MODE_TITLES = { inventory: 'INVENTÁRIO', combat: 'COMBATE', ficha: 'FICHA', npcs: 'BANCO DE NPCS' };

export function renderMasterCampaignHub(app, { session, profile, campaign, onBack, initialMode }) {
  let mode = initialMode || 'ficha';
  let theme = profile.theme || 'caverna-azul';
  const mounted = { inventory: false, combat: false, ficha: false, npcs: false };

  function render() {
    // render() sempre reconstrói o DOM inteiro (chamado de novo depois que o
    // mestre volta de um "escape" pra tela cheia de personagem/NPC) -- os
    // embeds antigos ficam órfãos junto com o DOM velho, então precisa
    // remontar tudo de novo, senão a aba atual fica com o miolo vazio
    // (mounted continuava true apontando pra um container que não existe mais).
    Object.keys(mounted).forEach((m) => (mounted[m] = false));
    app.innerHTML = `
      <div class="wrap">
        <div class="header">
          <div>
            <div class="title"><span class="dot"></span><span id="hub-title-text">${MODE_TITLES[mode]}</span></div>
            <div class="id">${escapeHtml(campaign.name)}</div>
          </div>
          <div style="display:flex; align-items:flex-start; gap:8px;">
            <div class="theme-picker-wrap" id="theme-picker-wrap">
              <button class="theme-trigger-btn" id="theme-trigger" title="mudar tema">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3a9 9 0 100 18c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a4 4 0 004-4c0-4.4-3.6-8-8-8z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none"/></svg>
              </button>
              <div class="theme-panel" id="theme-panel" style="display:none;">
                <div class="theme-group-label">ESCUROS</div>
                <div class="theme-swatch-row" data-group="dark"></div>
                <div class="theme-group-label">CLAROS</div>
                <div class="theme-swatch-row" data-group="light"></div>
                <div class="theme-group-label">NEUTROS</div>
                <div class="theme-swatch-row" data-group="neutral"></div>
              </div>
            </div>
            <button type="button" class="campaign-strip-signout" id="hub-back-btn">← voltar ao painel</button>
          </div>
        </div>

        <div id="hub-mode-inventory" style="display:none;"><div id="hub-embed-inventory"></div></div>
        <div id="hub-mode-combat" style="display:none;"><div id="hub-embed-combat"></div></div>
        <div id="hub-mode-ficha" style="display:none;"><div id="hub-embed-ficha"></div></div>
        <div id="hub-mode-npcs" style="display:none;"><div id="hub-embed-npcs"></div></div>
      </div>

      <nav class="side-nav" id="side-nav">
        <button type="button" class="side-nav-handle" id="side-nav-toggle" title="menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <div class="side-nav-items">
          ${NAV_ITEMS.map(
            (item) => `
          <button type="button" class="side-nav-item ${mode === item.mode ? 'active' : ''}" data-hub-mode="${item.mode}" title="${item.label}">
            <span class="side-nav-icon">${item.icon}</span>
            <span class="side-nav-label">${item.label}</span>
          </button>`
          ).join('')}
        </div>
      </nav>
    `;

    wireChrome();
    renderThemePanel();
    showMode(mode);
  }

  function wireChrome() {
    document.getElementById('hub-back-btn').addEventListener('click', () => onBack && onBack());

    const sideNav = document.getElementById('side-nav');
    document.getElementById('side-nav-toggle').addEventListener('click', () => {
      sideNav.classList.toggle('open');
    });
    document.querySelectorAll('button[data-hub-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        showMode(btn.dataset.hubMode);
        sideNav.classList.remove('open');
      });
    });

    document.getElementById('theme-trigger').addEventListener('click', () => {
      const panel = document.getElementById('theme-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('theme-panel').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-theme-id]');
      if (!btn) return;
      theme = btn.dataset.themeId;
      applyGlobalTheme(theme);
      renderThemePanel();
      document.getElementById('theme-panel').style.display = 'none';
      updateProfileTheme(session.user.id, theme).catch(() => {});
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#theme-picker-wrap')) {
        const panel = document.getElementById('theme-panel');
        if (panel) panel.style.display = 'none';
      }
    });
  }

  function renderThemePanel() {
    ['dark', 'light', 'neutral'].forEach((group) => {
      const row = document.querySelector(`.theme-swatch-row[data-group="${group}"]`);
      if (!row) return;
      row.innerHTML = THEMES.filter((t) => t.group === group)
        .map(
          (t) =>
            `<button type="button" class="theme-swatch ${theme === t.id ? 'active' : ''}" data-theme-id="${t.id}" title="${t.label}" style="--swatch-accent:${t.accent}; --swatch-void:${t.void};"></button>`
        )
        .join('');
    });
  }

  function showMode(next) {
    mode = next;
    document.getElementById('hub-title-text').textContent = MODE_TITLES[mode];
    ['inventory', 'combat', 'ficha', 'npcs'].forEach((m) => {
      const wrap = document.getElementById('hub-mode-' + m);
      wrap.style.display = m === mode ? 'block' : 'none';
      if (m === mode) {
        wrap.classList.remove('mode-fade-in');
        void wrap.offsetWidth;
        wrap.classList.add('mode-fade-in');
      }
    });
    document.querySelectorAll('.side-nav-item').forEach((el) => el.classList.toggle('active', el.dataset.hubMode === mode));

    if (!mounted[mode]) {
      mounted[mode] = true;
      const embed = document.getElementById('hub-embed-' + mode);
      if (mode === 'inventory') {
        renderMasterInventoryChooser(embed, { session, profile, campaign, topApp: app, escapeBack: () => render() });
      } else if (mode === 'combat') {
        renderCombatScreen(embed, { session, profile, campaign, characterId: null, characterName: null });
      } else if (mode === 'ficha') {
        renderMasterFichaScreen(embed, { session, profile, campaign });
      } else if (mode === 'npcs') {
        renderNpcBankScreen(embed, { session, profile, campaign, topApp: app, escapeBack: () => render() });
      }
    }
  }

  render();
}
