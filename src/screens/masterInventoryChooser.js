// Fase 6 — pra mestre, a aba "Inventário" do menu lateral vira um
// seletor: cards de cada player (e de todo NPC de ficha completa,
// que tem inventário igual um player) pra escolher de quem gerenciar
// os itens. Abre a tela cheia de character.js (própria janela, com
// seu próprio cabeçalho) porque essa tela não é feita pra ficar
// embutida dentro de si mesma.
import { escapeHtml } from '../shared/gameData.js';
import { supabase } from '../supabaseClient.js';
import { renderCharacterScreen } from './character.js';

export function renderMasterInventoryChooser(app, { session, profile, campaign, topApp, escapeBack }) {
  const campaignId = campaign.id;

  let list = [];
  let loaded = false;

  async function load() {
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, avatar_url, is_npc, npc_sheet_type, max_carga, owner_id')
      .eq('campaign_id', campaignId)
      .order('is_npc')
      .order('name');
    if (error) throw error;
    // player de verdade, ou NPC de ficha completa (só esses têm inventário) --
    // NPC simples não entra aqui (não tem itens), e o próprio personagem
    // do mestre também não (auto-criado só pelo mecanismo genérico de
    // loadState(), nunca usado de verdade).
    list = (data || []).filter((c) => (!c.is_npc || c.npc_sheet_type === 'completa') && c.owner_id !== session.user.id);
    loaded = true;
    render();
  }

  function render() {
    app.innerHTML = `
      <div class="ficha-section-title" style="margin-bottom:10px;">ESCOLHA UM INVENTÁRIO</div>
      ${
        !loaded
          ? '<p class="admin-empty">carregando...</p>'
          : list.length === 0
            ? '<p class="admin-empty">nenhum personagem ou NPC completo nessa campanha ainda.</p>'
            : `<div class="ficha-dash-grid">${list.map(chooserCard).join('')}</div>`
      }
    `;
    wireEvents();
  }

  function chooserCard(c) {
    return `
      <button type="button" class="ficha-dash-card npc-chooser-card" data-open-inv="${c.id}">
        ${c.avatar_url ? `<img class="ficha-dash-avatar" src="${escapeHtml(c.avatar_url)}" alt="">` : `<div class="ficha-dash-avatar"></div>`}
        <div class="ficha-dash-info">
          <div class="ficha-dash-name">${escapeHtml(c.name)}</div>
          ${c.is_npc ? '<span class="npc-type-badge completa">NPC</span>' : ''}
        </div>
      </button>`;
  }

  let wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;
    app.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-open-inv]');
      if (!btn) return;
      const id = btn.dataset.openInv;
      const c = list.find((x) => x.id === id);
      renderCharacterScreen(topApp, {
        session,
        profile,
        campaign,
        characterId: id,
        ownerName: c ? c.name : 'Personagem',
        onBack: escapeBack || (() => renderCharacterScreen(topApp, { session, profile, campaign })),
      });
    });
  }

  load();
}
