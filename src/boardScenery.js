// Tabuleiro -- painel "Cenário" do mestre (drawer lateral): ferramentas de
// parede, colisão e (Fase 2) luzes/ambiente. Só renderiza e repassa cliques
// pro `api` (board.js é quem sabe o estado e grava). O painel se redesenha
// inteiro a cada `refresh()` -- é pequeno e só o mestre usa.
import { escapeHtml } from './shared/gameData.js';
import { WALL_KIND_LABELS } from './boardWalls.js';

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

  function render() {
    const s = api.state();
    container.innerHTML = `
      <div class="scn-head">🧭 Cenário</div>
      <div class="scn-body">${wallsTab(s)}</div>`;
    wire();
  }

  function wire() {
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
