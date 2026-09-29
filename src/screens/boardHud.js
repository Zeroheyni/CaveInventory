// Tabuleiro -- Fase 4 (+ pedidos de acompanhamento): HUD ao redor do
// tabuleiro em tela cheia, visual "HUD de jogo" (painéis flutuantes
// translúcidos com borda em glow, por cima do tabuleiro mas sempre
// abaixo da seta do menu lateral, ver z-index em board.css). A ideia é
// o tabuleiro virar uma central -- o mestre não precisa mais sair pra
// aba Combate/Dados pra nada, TUDO fica disponível aqui, cada painel
// podendo ser recolhido:
//   - Combate (drawer na borda direita, SÓ MESTRE) -- embute a MESMA
//     tela `renderCombatScreen` de combat.js (iniciar/encerrar
//     combate, HP de qualquer um, condições, barras customizadas,
//     passar turno, etc -- tudo, não é uma versão reduzida). Pro
//     player, a única coisa que aparece é o painel de Iniciativa
//     abaixo (pedido explícito: "pros players deve aparecer apenas a
//     lista de iniciativa").
//   - Dados (drawer na borda esquerda, todo mundo) -- embute a MESMA
//     tela `renderDiceScreen` de dice.js (histórico completo, limpar).
//   - Iniciativa (canto superior direito, recolhível, todo mundo) --
//     resumo compacto sempre à vista (rank/avatar/HP/turno atual).
//   - Barras do personagem (canto configurável, recolhível, só
//     player) -- HP/Estamina/barras customizadas do PRÓPRIO
//     personagem, com +/- pra ajustar na hora (grava em
//     combat_participants TAMBÉM se tiver um participante ativo pra
//     esse personagem, mesmo caminho de updateParticipantHp do
//     combate -- senão o valor ficava dessincronizado entre tabuleiro
//     e combate). Não aparece pro mestre (ele não tem personagem
//     próprio).
//
// Montado UMA VEZ só (não a cada vez que abre/fecha um tabuleiro) --
// igual toda aba de character.js, que monta e nunca desmonta, só
// esconde via display:none. Reaproveitar esse mesmo padrão aqui evita
// destruir/recriar renderCombatScreen/renderDiceScreen toda hora, o
// que vazaria canais de Realtime (essas duas telas não expõem uma
// função de "desmontar", confiam em nunca precisar por causa desse
// padrão -- então o HUD do tabuleiro tinha que seguir a mesma regra).
// `hud.setVisible(bool)` troca só a visibilidade; o board.js chama
// isso ao entrar/sair da tela cheia, nunca destrói o HUD em si.
//
// Vive como IRMÃO do container do tabuleiro (não filho), pra
// sobreviver aos re-renders de innerHTML do board.js -- ver comentário
// completo (com o raciocínio de z-index) em board.css.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { getCombatState, getParticipants, subscribeCombat, isVisibleToPlayer, updateParticipantHp, updateParticipantStamina } from '../combat.js';
import { renderCombatScreen } from './combat.js';
import { renderDiceScreen } from './dice.js';
import { hpMax, estaminaMax, hpBarClass } from '../characterSheet.js';
import { listCharacterCustomBarsFor, customBarMax, updateCharacterCustomBarValue } from '../customBars.js';

const BARS_CORNER_KEY = 'board-hud-bars-corner';
const collapsedKey = (name) => 'board-hud-collapsed-' + name;

function getCollapsed(name, defaultValue) {
  try {
    const v = localStorage.getItem(collapsedKey(name));
    return v === null ? defaultValue : v === '1';
  } catch (_) {
    return defaultValue;
  }
}
function setCollapsed(name, value) {
  try {
    localStorage.setItem(collapsedKey(name), value ? '1' : '0');
  } catch (_) {
    // storage bloqueado (aba anônima etc) -- preferência só não persiste
  }
}

export function renderBoardHud(mountParent, { session, profile, campaign, characterId, characterName, isMaster }) {
  const campaignId = campaign.id;
  const root = document.createElement('div');
  root.className = 'board-hud-root';
  root.style.display = 'none';
  mountParent.appendChild(root);

  // Combate completo (iniciar/encerrar, gerenciar HP de qualquer um,
  // passar turno etc) é só do mestre -- pro player, a única coisa que
  // deve aparecer é a lista de iniciativa (painel compacto abaixo) e
  // as PRÓPRIAS barras (mountBarsPanel, interativo).
  if (isMaster) mountCombatDrawer(root, { session, profile, campaign, characterId, characterName });
  mountDiceDrawer(root, { session, profile, campaign });
  mountInitiativePanel(root, { campaignId, profile, characterId, isMaster });
  if (!isMaster && characterId) mountBarsPanel(root, { campaignId, characterId });

  return {
    setVisible(visible) {
      root.style.display = visible ? '' : 'none';
    },
  };
}

// ---------------------------------------------------------------
// drawer genérico (Combate/Dados) -- handle fixo na borda, painel
// desliza pra fora. O CONTEÚDO só monta na primeira vez que abre
// (`mountBody`), e fica montado pra sempre depois (mesmo padrão de
// "nunca desmonta" do resto do app) -- fechar só esconde via CSS.
// ---------------------------------------------------------------
function mountDrawer(root, { side, icon, title, mountBody }) {
  const wrap = document.createElement('div');
  wrap.className = `board-hud-drawer side-${side}`;
  root.appendChild(wrap);

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'board-hud-drawer-handle';
  handle.title = title;
  handle.innerHTML = `<span>${icon}</span>`;

  const panel = document.createElement('div');
  panel.className = 'board-hud-drawer-panel';
  const body = document.createElement('div');
  body.className = 'board-hud-drawer-body';
  panel.appendChild(body);

  if (side === 'left') {
    wrap.appendChild(handle);
    wrap.appendChild(panel);
  } else {
    wrap.appendChild(panel);
    wrap.appendChild(handle);
  }

  let open = false;
  let mounted = false;
  handle.addEventListener('click', () => {
    open = !open;
    wrap.classList.toggle('open', open);
    handle.title = open ? 'fechar' : title;
    if (open && !mounted) {
      mounted = true;
      mountBody(body);
    }
  });
}

function mountCombatDrawer(root, { session, profile, campaign, characterId, characterName }) {
  mountDrawer(root, {
    side: 'right',
    icon: '⚔',
    title: 'combate',
    mountBody(container) {
      renderCombatScreen(container, { session, profile, campaign, characterId, characterName, topicSuffix: '-board', embedded: true });
    },
  });
}

function mountDiceDrawer(root, { session, profile, campaign }) {
  mountDrawer(root, {
    side: 'left',
    icon: '🎲',
    title: 'dados',
    mountBody(container) {
      renderDiceScreen(container, { session, profile, campaign, topicSuffix: '-board' });
    },
  });
}

// ---------------------------------------------------------------
// painel de iniciativa (canto superior direito, recolhível) -- resumo
// compacto sempre à vista; pra ações de verdade (passar turno, editar
// HP fino, condições) o drawer de Combate ao lado tem tudo isso.
// ---------------------------------------------------------------
function mountInitiativePanel(root, { campaignId, profile, characterId, isMaster }) {
  const el = document.createElement('div');
  el.className = 'board-hud-panel board-hud-initiative';
  el.style.display = 'none'; // some visível só depois do load() confirmar combate ativo -- sem isso, pisca uma caixa vazia por uma fração de segundo
  root.appendChild(el);

  let combatState = { active: false, round: 1 };
  let participants = [];
  let collapsed = getCollapsed('iniciativa', false);

  function canSeeHp(p) {
    if (isMaster) return true;
    if (p.character_id === characterId) return true;
    return !!profile.can_see_others_hp;
  }
  function hpPct(p) {
    return p.hp_max > 0 ? Math.max(0, Math.min(100, Math.round((p.hp_current / p.hp_max) * 100))) : 0;
  }
  function visibleParticipants() {
    if (isMaster) return participants;
    return participants.filter((p) => isVisibleToPlayer(p, profile, characterId, combatState.round));
  }
  function avatarHtml(p) {
    if (p.avatar_url) return `<img class="combat-avatar" src="${escapeHtml(p.avatar_url)}" alt="">`;
    const letter = (p.display_name || '?').trim().charAt(0).toUpperCase();
    return `<span class="combat-avatar combat-avatar-placeholder">${escapeHtml(letter)}</span>`;
  }

  function render() {
    if (!combatState.active) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = '';
    el.className = 'board-hud-panel board-hud-initiative' + (collapsed ? ' collapsed' : '');
    const allSorted = participants.slice().sort((a, b) => a.position - b.position);
    const currentTurn = combatState.fixed_initiative
      ? allSorted.find((p) => p.id === combatState.current_turn_id) || allSorted[0] || null
      : allSorted[0] || null;
    const rankMap = new Map(allSorted.map((p, i) => [p.id, i + 1]));
    const list = visibleParticipants().slice().sort((a, b) => a.position - b.position);

    el.innerHTML = `
      <div class="board-hud-head">
        <span class="board-hud-head-icon">⚔</span>
        <span>RODADA ${combatState.round}</span>
        <button type="button" class="board-hud-mini-btn" id="hud-init-collapse" title="${collapsed ? 'expandir' : 'recolher'}">${collapsed ? '▸' : '▾'}</button>
      </div>
      ${
        collapsed
          ? ''
          : `<div class="board-hud-body">
          <div class="board-hud-initiative-list">
            ${
              list.length === 0
                ? '<div class="board-hud-empty">ninguém na iniciativa</div>'
                : list
                    .map((p) => {
                      const isCurrent = currentTurn && p.id === currentTurn.id;
                      const showHp = canSeeHp(p);
                      return `
              <div class="board-hud-init-row ${isCurrent ? 'current-turn' : ''} team-${p.team}">
                <span class="combat-rank-badge">${rankMap.get(p.id)}º</span>
                ${avatarHtml(p)}
                <div class="board-hud-init-main">
                  <div class="board-hud-init-name">${escapeHtml(p.display_name)}</div>
                  ${showHp ? `<div class="combat-hp-bar board-hud-init-hpbar"><div class="combat-hp-fill ${hpBarClass(hpPct(p))}" style="width:${hpPct(p)}%"></div></div>` : ''}
                </div>
              </div>`;
                    })
                    .join('')
            }
          </div>
        </div>`
      }
    `;

    const collapseBtn = el.querySelector('#hud-init-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        collapsed = !collapsed;
        setCollapsed('iniciativa', collapsed);
        render();
      });
    }
  }

  let reloadTimer = null;
  async function load() {
    try {
      const [cs, ps] = await Promise.all([getCombatState(campaignId), getParticipants(campaignId)]);
      combatState = cs;
      participants = ps;
    } catch (_) {
      // painel compacto -- se falhar, só fica com o último estado conhecido
    }
    render();
  }

  subscribeCombat(
    campaignId,
    () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 500);
    },
    'combat-board-hud-' + campaignId
  );
  load();
}

// ---------------------------------------------------------------
// barras do personagem (canto configurável, recolhível, só leitura) --
// HP, Estamina e barras customizadas do PRÓPRIO personagem. Lê direto
// de `characters`/`character_custom_bars` (não de combat_participants):
// esses valores são persistentes e existem com ou sem combate ativo,
// e updateParticipantHp (combat.js) sempre grava nos dois juntos, então
// characters.hp_current nunca fica desatualizado em relação ao combate.
// Ajustar valor continua no drawer de Combate/Ficha -- aqui é só glance.
// ---------------------------------------------------------------
function mountBarsPanel(root, { campaignId, characterId }) {
  const el = document.createElement('div');
  el.className = 'board-hud-panel board-hud-bars';
  el.style.display = 'none'; // idem painel de iniciativa -- some visível só depois do load() trazer o personagem
  root.appendChild(el);

  let corner = 'bottom-left';
  try {
    corner = localStorage.getItem(BARS_CORNER_KEY) || 'bottom-left';
  } catch (_) {
    // localStorage pode falhar (aba anônima, storage bloqueado) -- painel
    // só continua no padrão, sem quebrar o resto do HUD por causa disso.
  }
  let collapsed = getCollapsed('barras', false);

  let char = null;
  let customBars = [];
  let busy = false; // trava dupla-gravação enquanto uma requisição de +/- tá em voo

  // controles +/- + input numérico, mesmo padrão visual/UX de
  // combat.js (.combat-hp-controls no self-card) -- pedido do usuário:
  // "permita os player mecherem em suas barras no tabuleiro, aumentar
  // diminuir vida/stamina/etc". `kind` é 'hp' | 'estamina' | um id de
  // character_custom_bars (string).
  function barControlsHtml(kind, current, max) {
    return `
      <div class="board-hud-bar-controls">
        <button type="button" class="board-hud-mini-btn" data-bar-delta="-1" data-bar-kind="${kind}" ${busy ? 'disabled' : ''}>−</button>
        <input type="number" class="board-hud-bar-input" data-bar-input data-bar-kind="${kind}" value="${current}" min="0" max="${max}" ${busy ? 'disabled' : ''}>
        <button type="button" class="board-hud-mini-btn" data-bar-delta="1" data-bar-kind="${kind}" ${busy ? 'disabled' : ''}>+</button>
      </div>`;
  }

  function render() {
    el.className = `board-hud-panel board-hud-bars corner-${corner}` + (collapsed ? ' collapsed' : '');
    if (!char) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    el.style.display = '';
    const hMax = hpMax(char);
    const eMax = estaminaMax(char);
    const hPct = hMax > 0 ? Math.max(0, Math.min(100, Math.round((char.hp_current / hMax) * 100))) : 0;
    const ePct = eMax > 0 ? Math.max(0, Math.min(100, Math.round((char.estamina_current / eMax) * 100))) : 0;
    el.innerHTML = `
      <div class="board-hud-head">
        ${char.avatar_url ? `<img class="combat-avatar" src="${escapeHtml(char.avatar_url)}" alt="">` : `<span class="combat-avatar combat-avatar-placeholder">${escapeHtml((char.name || '?').charAt(0).toUpperCase())}</span>`}
        <span>${escapeHtml(char.name)}</span>
        ${!collapsed ? `<button type="button" class="board-hud-mini-btn" id="hud-bars-corner-toggle" title="mudar de canto">⇄</button>` : ''}
        <button type="button" class="board-hud-mini-btn" id="hud-bars-collapse" title="${collapsed ? 'expandir' : 'recolher'}">${collapsed ? '▸' : '▾'}</button>
      </div>
      ${
        collapsed
          ? ''
          : `<div class="board-hud-body">
        <div class="board-hud-bar-block">
          <div class="board-hud-bar-row">
            <span class="board-hud-bar-label">❤ HP</span>
            <div class="combat-hp-bar"><div class="combat-hp-fill ${hpBarClass(hPct)}" style="width:${hPct}%"></div></div>
            <span class="board-hud-bar-txt">${char.hp_current}/${hMax}</span>
          </div>
          ${barControlsHtml('hp', char.hp_current, hMax)}
        </div>
        ${
          eMax > 0
            ? `<div class="board-hud-bar-block">
                 <div class="board-hud-bar-row">
                   <span class="board-hud-bar-label">⚡ EST</span>
                   <div class="combat-hp-bar"><div class="combat-hp-fill ficha-estamina-fill" style="width:${ePct}%"></div></div>
                   <span class="board-hud-bar-txt">${char.estamina_current}/${eMax}</span>
                 </div>
                 ${barControlsHtml('estamina', char.estamina_current, eMax)}
               </div>`
            : ''
        }
        ${customBars
          .map((cb) => {
            const max = customBarMax(cb.bar, char);
            const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((cb.current_value / max) * 100))) : 0;
            return `
          <div class="board-hud-bar-block">
            <div class="board-hud-bar-row">
              <span class="board-hud-bar-label" style="color:${escapeHtml(cb.bar.color)};">${escapeHtml(cb.bar.name)}</span>
              <div class="combat-hp-bar"><div class="combat-hp-fill" style="width:${pct}%; background:${escapeHtml(cb.bar.color)}"></div></div>
              <span class="board-hud-bar-txt">${cb.current_value}/${max}</span>
            </div>
            ${barControlsHtml(cb.id, cb.current_value, max)}
          </div>`;
          })
          .join('')}
      </div>`
      }
    `;
    const cornerBtn = el.querySelector('#hud-bars-corner-toggle');
    if (cornerBtn) {
      cornerBtn.addEventListener('click', () => {
        corner = corner === 'bottom-left' ? 'top-left' : 'bottom-left';
        try {
          localStorage.setItem(BARS_CORNER_KEY, corner);
        } catch (_) {
          // idem -- preferência só não persiste, painel continua funcionando
        }
        render();
      });
    }
    const collapseBtn = el.querySelector('#hud-bars-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        collapsed = !collapsed;
        setCollapsed('barras', collapsed);
        render();
      });
    }
    el.querySelectorAll('[data-bar-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.barKind;
        const { current, max } = barValueFor(kind);
        applyBarValue(kind, Math.max(0, Math.min(max, current + Number(btn.dataset.barDelta))));
      });
    });
    el.querySelectorAll('[data-bar-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const kind = input.dataset.barKind;
        const { max } = barValueFor(kind);
        applyBarValue(kind, Math.max(0, Math.min(max, parseInt(input.value, 10) || 0)));
      });
    });
  }

  // acha o valor/máximo ATUAL de uma barra pelo `kind` usado nos data-*
  // (evita duplicar essa lógica entre o handler de delta e o de input).
  function barValueFor(kind) {
    if (kind === 'hp') return { current: char.hp_current, max: hpMax(char) };
    if (kind === 'estamina') return { current: char.estamina_current, max: estaminaMax(char) };
    const cb = customBars.find((c) => c.id === kind);
    return cb ? { current: cb.current_value, max: customBarMax(cb.bar, char) } : { current: 0, max: 0 };
  }

  // grava e atualiza local -- HP/Estamina passam por updateParticipantHp/
  // updateParticipantStamina (combat.js) SE o personagem tiver um
  // participante de combate ativo agora (grava characters E
  // combat_participants juntos, mesmo caminho do self-card da aba
  // Combate -- sem isso, ajustar aqui deixaria o combate com um valor
  // desatualizado até a próxima sincronização manual); sem combate
  // ativo, grava direto em `characters` (RLS já permite -- dono edita
  // a própria linha inteira). Barra customizada não tem esse problema
  // (character_custom_bars não é espelhado em lugar nenhum), sempre
  // grava direto.
  async function applyBarValue(kind, next) {
    if (busy) return;
    busy = true;
    // otimista -- aplica local antes do roundtrip, igual o resto do app.
    if (kind === 'hp') char.hp_current = next;
    else if (kind === 'estamina') char.estamina_current = next;
    else {
      const cb = customBars.find((c) => c.id === kind);
      if (cb) cb.current_value = next;
    }
    render();
    try {
      if (kind === 'hp' || kind === 'estamina') {
        const { data: participant } = await supabase
          .from('combat_participants')
          .select('id')
          .eq('campaign_id', campaignId)
          .eq('character_id', characterId)
          .maybeSingle();
        if (participant) {
          if (kind === 'hp') await updateParticipantHp(participant.id, next, characterId);
          else await updateParticipantStamina(participant.id, next, characterId);
        } else {
          const field = kind === 'hp' ? 'hp_current' : 'estamina_current';
          const { error } = await supabase.from('characters').update({ [field]: next }).eq('id', characterId);
          if (error) throw error;
        }
      } else {
        await updateCharacterCustomBarValue(kind, next);
      }
    } catch (_) {
      // se falhar, o próximo postgres_changes (ou o load() seguinte)
      // corrige sozinho -- não trava a barra num estado quebrado.
    }
    busy = false;
    render();
  }

  let reloadTimer = null;
  async function load() {
    try {
      const [{ data: charRow }, bars] = await Promise.all([
        supabase
          .from('characters')
          .select('name, avatar_url, hp_current, estamina_current, hp_max_override, estamina_max_override, vitalidade, forca, agilidade, destreza, inteligencia, estamina, observacao')
          .eq('id', characterId)
          .maybeSingle(),
        listCharacterCustomBarsFor(characterId),
      ]);
      char = charRow;
      customBars = bars || [];
    } catch (_) {
      // painel compacto -- se falhar, fica com o último estado conhecido
    }
    render();
  }

  supabase
    .channel('board-bars-' + characterId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters', filter: `id=eq.${characterId}` }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 400);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'character_custom_bars', filter: `character_id=eq.${characterId}` }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(load, 400);
    })
    .subscribe();
  load();
}
