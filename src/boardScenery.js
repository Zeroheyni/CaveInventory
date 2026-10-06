// Tabuleiro -- painel "Cenário" do mestre (drawer lateral): ferramentas de
// parede, colisão e (Fase 2) luzes/ambiente. Só renderiza e repassa cliques
// pro `api` (board.js é quem sabe o estado e grava). O painel se redesenha
// inteiro a cada `refresh()` -- é pequeno e só o mestre usa.
import { escapeHtml } from './shared/gameData.js';
import { WALL_KIND_LABELS } from './boardWalls.js';
import { LIGHT_PRESETS, LIGHT_KINDS } from './boardLighting.js';

const TABS = [
  { key: 'paredes', icon: '🧱', label: 'Paredes' },
  { key: 'luzes', icon: '💡', label: 'Luzes' },
  { key: 'ambiente', icon: '🌑', label: 'Ambiente' },
];

// sliders do editor de luz: [campo, rótulo, min, max, passo, sufixo]
const LIGHT_SLIDERS = [
  ['radius', 'luz forte', 1, 80, 0.5, '%'],
  ['dim_radius', 'penumbra', 1, 90, 0.5, '%'],
  ['angle', 'abertura', 10, 360, 1, '°'],
  ['intensity', 'intensidade', 0.2, 1, 0.05, ''],
  ['flicker', 'tremida', 0, 1, 0.05, ''],
  ['pulse', 'pulso', 0, 1, 0.05, ''],
];

const WALL_TOOLS = [
  { key: 'mover', icon: '✋', label: 'Mover', hint: 'arrasta tokens e o mapa normalmente' },
  { key: 'parede', icon: '🧱', label: 'Parede', hint: 'clique em cada ponto; duplo clique/Esc/botão direito termina · Shift = 45° · Alt = sem encaixe' },
  { key: 'retangulo', icon: '▭', label: 'Sala', hint: 'arraste de um canto ao oposto' },
  { key: 'porta', icon: '🚪', label: 'Porta', hint: 'como a parede; depois clique no cadeado pra abrir/fechar' },
  { key: 'janela', icon: '🪟', label: 'Janela', hint: 'bloqueia o movimento, mas a luz passa' },
  { key: 'invisivel', icon: '👻', label: 'Invisível', hint: 'bloqueia o movimento sem aparecer pros jogadores' },
  { key: 'editar', icon: '✏️', label: 'Editar', hint: 'arraste um vértice · clique numa parede pra selecionar' },
  { key: 'apagar', icon: '🧽', label: 'Apagar', hint: 'clique ou arraste por cima das paredes' },
];

// api: {
//   state(): { tab, tool, collision, showWalls, grid, wallCount, selected, canUndo, canRedo }
//   setTab(t), setTool(key), setCollision(b), setShowWalls(b), setGrid(n), undo(), redo(),
//   selectedKind(kind), selectedFlag(flag, value), deleteSelected(), clearAll()
// }
export function mountSceneryPanel(container, api) {
  container.classList.add('scenery-panel');

  function wallsTab(s) {
    const tool = WALL_TOOLS.find((t) => t.key === s.tool) || WALL_TOOLS[0];
    const sel = s.selected;
    return `
      <div class="scn-section">
        <div class="scn-tools">
          ${WALL_TOOLS.map((t) => `<button type="button" class="scn-tool ${s.tool === t.key ? 'active' : ''}" data-scn-tool="${t.key}" title="${escapeHtml(t.hint)}"><span>${t.icon}</span><small>${t.label}</small></button>`).join('')}
        </div>
        <p class="scn-hint">${escapeHtml(tool.hint)}</p>
        <div class="scn-row">
          <button type="button" class="scn-mini" data-scn-undo ${s.canUndo ? '' : 'disabled'} title="desfazer (Ctrl+Z)">↶ desfazer</button>
          <button type="button" class="scn-mini" data-scn-redo ${s.canRedo ? '' : 'disabled'} title="refazer (Ctrl+Y)">↷ refazer</button>
        </div>
      </div>
      ${
        sel
          ? `<div class="scn-section scn-selected">
              <div class="scn-title">parede selecionada</div>
              <div class="scn-kinds">
                ${Object.keys(WALL_KIND_LABELS).map((k) => `<button type="button" class="scn-mini ${sel.kind === k ? 'active' : ''}" data-scn-kind="${k}">${WALL_KIND_LABELS[k]}</button>`).join('')}
              </div>
              <label class="scn-check"><input type="checkbox" data-scn-flag="blocks_move" ${sel.blocks_move ? 'checked' : ''}> bloqueia movimento</label>
              <label class="scn-check"><input type="checkbox" data-scn-flag="blocks_light" ${sel.blocks_light ? 'checked' : ''}> bloqueia luz</label>
              <button type="button" class="scn-mini danger" data-scn-delete>apagar esta parede</button>
            </div>`
          : ''
      }
      <div class="scn-section">
        <label class="scn-check"><input type="checkbox" data-scn-collision ${s.collision ? 'checked' : ''}> colisão ligada <small>(Shift ignora, só mestre)</small></label>
        <label class="scn-check"><input type="checkbox" data-scn-showwalls ${s.showWalls ? 'checked' : ''}> jogadores veem as paredes</label>
        <div class="scn-row">
          <label class="scn-inline">grade
            <select data-scn-grid>
              ${[0, 1, 2.5, 5].map((g) => `<option value="${g}" ${Number(s.grid) === g ? 'selected' : ''}>${g === 0 ? 'sem encaixe' : g + '%'}</option>`).join('')}
            </select>
          </label>
          <span class="scn-count">${s.wallCount} ${s.wallCount === 1 ? 'parede' : 'paredes'}</span>
        </div>
        ${s.wallCount ? `<button type="button" class="scn-mini danger" data-scn-clear>apagar todas as paredes</button>` : ''}
      </div>`;
  }

  function lightEditor(l) {
    return `
      <div class="scn-light-editor" data-light-editor="${l.id}">
        <div class="scn-kinds">
          ${LIGHT_KINDS.map((k) => `<button type="button" class="scn-mini ${l.kind === k ? 'active' : ''}" data-scn-preset="${k}" title="${LIGHT_PRESETS[k].label}">${LIGHT_PRESETS[k].icon}</button>`).join('')}
        </div>
        ${LIGHT_SLIDERS.map(([f, label, min, max, step, suf]) => `
          <label class="scn-slider">
            <span>${label}</span>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${l[f]}" data-scn-lfield="${f}">
            <output>${Math.round(l[f] * 100) / 100}${suf}</output>
          </label>`).join('')}
        <label class="scn-slider">
          <span>cor</span>
          <input type="color" value="${escapeHtml(l.color)}" data-scn-lfield="color">
          <output></output>
        </label>
        ${l.angle < 359.5 ? `<p class="scn-hint">direção: segue o movimento do token (e fica salva ao soltar)</p>` : ''}
      </div>`;
  }

  function lightsTab(s) {
    return `
      <div class="scn-section">
        <div class="scn-title">nova luz fixa no cenário</div>
        <div class="scn-kinds">
          ${LIGHT_KINDS.map((k) => `<button type="button" class="scn-mini" data-scn-addlight="${k}" title="${LIGHT_PRESETS[k].label}">${LIGHT_PRESETS[k].icon} ${LIGHT_PRESETS[k].label}</button>`).join('')}
        </div>
        <p class="scn-hint">a luz de um personagem se liga no ⚙ do token (ícone de luz). Luzes fixas aparecem como marcadores que você arrasta.</p>
      </div>
      <div class="scn-section">
        ${
          s.lights.length
            ? s.lights
                .map((l) => {
                  const p = LIGHT_PRESETS[l.kind] || LIGHT_PRESETS.custom;
                  return `
                  <div class="scn-light ${s.editLightId === l.id ? 'open' : ''}">
                    <div class="scn-light-row">
                      <input type="checkbox" data-scn-lighton="${l.id}" ${l.enabled ? 'checked' : ''} title="ligar/desligar">
                      <span class="scn-light-name">${p.icon} ${escapeHtml(p.label)} <small>· ${escapeHtml(l.ownerLabel)}</small></span>
                      <button type="button" class="scn-mini" data-scn-lightedit="${l.id}" title="ajustar">⚙</button>
                      <button type="button" class="scn-mini danger" data-scn-lightdel="${l.id}" title="remover">✕</button>
                    </div>
                    ${s.editLightId === l.id ? lightEditor(l) : ''}
                  </div>`;
                })
                .join('')
            : '<p class="scn-hint">nenhuma luz ainda</p>'
        }
      </div>`;
  }

  function ambientTab(s) {
    return `
      <div class="scn-section">
        <label class="scn-check"><input type="checkbox" data-scn-lighting ${s.lighting ? 'checked' : ''}> <b>iluminação ligada</b> <small>(mapa escuro; só o iluminado aparece)</small></label>
        <label class="scn-slider">
          <span>escuridão</span>
          <input type="range" min="0.3" max="1" step="0.02" value="${s.ambient}" data-scn-ambient>
          <output>${Math.round(s.ambient * 100)}%</output>
        </label>
        <label class="scn-inline">modo
          <select data-scn-fog>
            <option value="escuro" ${s.fogMode === 'escuro' ? 'selected' : ''}>escuro</option>
            <option value="neblina" ${s.fogMode === 'neblina' ? 'selected' : ''}>neblina</option>
          </select>
        </label>
        <label class="scn-inline">cor da escuridão <input type="color" value="${escapeHtml(s.ambientColor)}" data-scn-ambcolor></label>
      </div>
      <div class="scn-section">
        <label class="scn-check"><input type="checkbox" data-scn-memory ${s.memory ? 'checked' : ''}> <b>memória do mapa</b> <small>(o que o jogador já explorou fica meio apagado, em vez de voltar ao preto)</small></label>
        <p class="scn-hint">Cada jogador guarda o próprio mapa explorado. Os inimigos continuam só aparecendo dentro da luz de agora.</p>
        <button type="button" class="btn btn-ghost" data-scn-memreset ${s.memory ? '' : 'disabled'}>🧽 zerar a memória de todos</button>
      </div>
      <div class="scn-section">
        <label class="scn-check"><input type="checkbox" data-scn-asplayer ${s.viewAsPlayer ? 'checked' : ''}> ver como jogador</label>
        <p class="scn-hint">Você (mestre) vê o mapa só levemente escurecido; marque pra enxergar o que os jogadores enxergam. É efeito visual: a imagem do mapa continua acessível pela URL dela.</p>
      </div>`;
  }

  function render() {
    const s = api.state();
    const body = s.tab === 'luzes' ? lightsTab(s) : s.tab === 'ambiente' ? ambientTab(s) : wallsTab(s);
    container.innerHTML = `
      <div class="scn-head">🧭 Cenário</div>
      <div class="scn-tabs">
        ${TABS.map((t) => `<button type="button" class="scn-tab ${s.tab === t.key ? 'active' : ''}" data-scn-tab="${t.key}">${t.icon} ${t.label}</button>`).join('')}
      </div>
      <div class="scn-body">${body}</div>`;
    wire();
  }

  function wireLights() {
    container.querySelectorAll('[data-scn-addlight]').forEach((b) => b.addEventListener('click', () => api.addFixedLight(b.dataset.scnAddlight)));
    container.querySelectorAll('[data-scn-lighton]').forEach((c) => c.addEventListener('change', () => api.toggleLight(c.dataset.scnLighton)));
    container.querySelectorAll('[data-scn-lightedit]').forEach((b) => b.addEventListener('click', () => api.editLight(b.dataset.scnLightedit)));
    container.querySelectorAll('[data-scn-lightdel]').forEach((b) => b.addEventListener('click', () => api.deleteLight(b.dataset.scnLightdel)));
    const ed = container.querySelector('[data-light-editor]');
    if (ed) {
      const id = ed.dataset.lightEditor;
      ed.querySelectorAll('[data-scn-preset]').forEach((b) => b.addEventListener('click', () => api.applyPreset(id, b.dataset.scnPreset)));
      ed.querySelectorAll('[data-scn-lfield]').forEach((inp) => {
        const field = inp.dataset.scnLfield;
        const val = () => (field === 'color' ? inp.value : Number(inp.value));
        inp.addEventListener('input', () => {
          const out = inp.parentElement.querySelector('output');
          if (out && field !== 'color') out.textContent = String(Math.round(Number(inp.value) * 100) / 100) + (field === 'angle' ? '°' : field === 'radius' || field === 'dim_radius' ? '%' : '');
          api.liveLight(id, { [field]: val() });
        });
        inp.addEventListener('change', () => api.saveLight(id, { [field]: val() }));
      });
    }
  }
  function wireAmbient() {
    const lg = container.querySelector('[data-scn-lighting]');
    if (lg) lg.addEventListener('change', () => api.setLighting(lg.checked));
    const mm = container.querySelector('[data-scn-memory]');
    if (mm) mm.addEventListener('change', () => api.setMemory(mm.checked));
    const mr = container.querySelector('[data-scn-memreset]');
    if (mr) mr.addEventListener('click', () => { if (window.confirm('Zerar o mapa explorado de TODOS os jogadores neste tabuleiro?')) api.resetMemory(); });
    const am = container.querySelector('[data-scn-ambient]');
    if (am) {
      am.addEventListener('input', () => {
        const out = am.parentElement.querySelector('output');
        if (out) out.textContent = Math.round(Number(am.value) * 100) + '%';
      });
      am.addEventListener('change', () => api.setAmbient(Number(am.value)));
    }
    const fog = container.querySelector('[data-scn-fog]');
    if (fog) fog.addEventListener('change', () => api.setFogMode(fog.value));
    const col = container.querySelector('[data-scn-ambcolor]');
    if (col) col.addEventListener('change', () => api.setAmbientColor(col.value));
    const as = container.querySelector('[data-scn-asplayer]');
    if (as) as.addEventListener('change', () => api.setViewAsPlayer(as.checked));
  }

  function wire() {
    container.querySelectorAll('[data-scn-tab]').forEach((b) => b.addEventListener('click', () => api.setTab(b.dataset.scnTab)));
    wireLights();
    wireAmbient();
    container.querySelectorAll('[data-scn-tool]').forEach((b) => b.addEventListener('click', () => api.setTool(b.dataset.scnTool)));
    const on = (sel, fn) => {
      const n = container.querySelector(sel);
      if (n) n.addEventListener('click', fn);
    };
    on('[data-scn-undo]', () => api.undo());
    on('[data-scn-redo]', () => api.redo());
    on('[data-scn-delete]', () => api.deleteSelected());
    on('[data-scn-clear]', () => {
      if (window.confirm('Apagar TODAS as paredes deste tabuleiro?')) api.clearAll();
    });
    container.querySelectorAll('[data-scn-kind]').forEach((b) => b.addEventListener('click', () => api.selectedKind(b.dataset.scnKind)));
    container.querySelectorAll('[data-scn-flag]').forEach((c) => c.addEventListener('change', () => api.selectedFlag(c.dataset.scnFlag, c.checked)));
    const col = container.querySelector('[data-scn-collision]');
    if (col) col.addEventListener('change', () => api.setCollision(col.checked));
    const sw = container.querySelector('[data-scn-showwalls]');
    if (sw) sw.addEventListener('change', () => api.setShowWalls(sw.checked));
    const grid = container.querySelector('[data-scn-grid]');
    if (grid) grid.addEventListener('change', () => api.setGrid(Number(grid.value)));
  }

  render();
  return { refresh: render };
}
