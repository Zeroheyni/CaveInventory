// Easter egg — overlay dos minijogos escondidos (Cobrinha/Tetris),
// destravado clicando 5x no pontinho do cabeçalho (ver wireEasterEgg
// em character.js/masterCampaignHub.js). Anexado direto no
// document.body (não dentro de #app) pra sobreviver a qualquer
// re-render da tela por baixo enquanto o overlay estiver aberto.
import { escapeHtml } from '../shared/gameData.js';
import { submitGameScore, listHighScores } from '../games.js';
import { createSnakeGame } from '../games/snake.js';
import { createTetrisGame } from '../games/tetris.js';

const GAMES = {
  snake: { label: 'Cobrinha', icon: '🐍', factory: createSnakeGame, width: 324, height: 324 },
  tetris: { label: 'Tetris', icon: '🧱', factory: createTetrisGame, width: 180, height: 360 },
};

export function renderEasterEggOverlay({ campaign, profile }) {
  const playerName = profile.username || 'jogador';
  let root = document.getElementById('easter-egg-root');
  if (root) return; // já tem um aberto -- não empilha dois
  root = document.createElement('div');
  root.id = 'easter-egg-root';
  document.body.appendChild(root);

  let view = 'menu'; // 'menu' | 'playing' | 'gameover'
  let selectedGame = 'snake';
  let scores = [];
  let currentScore = 0;
  let isNewRecord = false;
  let activeEngine = null;
  let keyHandler = null;

  function close() {
    if (activeEngine) activeEngine.stop();
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    root.remove();
  }

  async function openMenu(game) {
    selectedGame = game || selectedGame;
    view = 'menu';
    render();
    try {
      scores = await listHighScores(campaign.id, selectedGame);
    } catch (err) {
      scores = [];
    }
    render();
  }

  function startGame() {
    view = 'playing';
    currentScore = 0;
    render();
    const canvas = document.getElementById('ee-canvas');
    const def = GAMES[selectedGame];
    activeEngine = def.factory(canvas, {
      onScoreChange: (s) => {
        currentScore = s;
        updateScoreReadout();
      },
      onGameOver: (finalScore) => onGameOver(finalScore),
    });
    keyHandler = (e) => activeEngine && activeEngine.handleKey(e);
    document.addEventListener('keydown', keyHandler);
    activeEngine.start();
  }

  async function onGameOver(finalScore) {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    const prevBest = scores.length > 0 ? scores.find((s) => s.player_name === playerName)?.best_score || 0 : 0;
    isNewRecord = finalScore > 0 && finalScore > prevBest;
    view = 'gameover';
    render();
    try {
      if (finalScore > 0) await submitGameScore(selectedGame, finalScore, playerName);
      scores = await listHighScores(campaign.id, selectedGame);
    } catch (err) {
      // silencioso -- não vale travar o jogador numa tela de erro por
      // causa do placar, o jogo já acabou de qualquer forma.
    }
    render();
  }

  function updateScoreReadout() {
    const el = document.getElementById('ee-score-readout');
    if (el) el.textContent = String(currentScore);
  }

  function scoresHtml() {
    if (scores.length === 0) return '<p class="ee-empty">ninguém jogou ainda -- seja o primeiro!</p>';
    return `
      <ol class="ee-leaderboard">
        ${scores.map((s) => `<li><span class="ee-lb-name">${escapeHtml(s.player_name)}</span><span class="ee-lb-score">${s.best_score}</span></li>`).join('')}
      </ol>`;
  }

  function render() {
    if (view === 'menu') {
      root.innerHTML = `
        <div class="easter-egg-overlay">
          <div class="easter-egg-panel">
            <button type="button" class="easter-egg-close" id="ee-close" title="fechar">✕</button>
            <div class="ee-title">🎮 ACHOU O EASTER EGG</div>
            <div class="ee-game-tabs">
              ${Object.entries(GAMES)
                .map(([key, g]) => `<button type="button" class="ee-game-tab ${selectedGame === key ? 'active' : ''}" data-ee-select="${key}">${g.icon} ${g.label}</button>`)
                .join('')}
            </div>
            <button type="button" class="btn" id="ee-play-btn">▶ jogar ${GAMES[selectedGame].icon}</button>
            <div class="ee-leaderboard-wrap">
              <div class="ee-leaderboard-title">🏆 recorde da campanha</div>
              ${scoresHtml()}
            </div>
          </div>
        </div>`;
      root.querySelector('#ee-close').addEventListener('click', close);
      root.querySelector('#ee-play-btn').addEventListener('click', startGame);
      root.querySelectorAll('[data-ee-select]').forEach((btn) => btn.addEventListener('click', () => openMenu(btn.dataset.eeSelect)));
      return;
    }

    if (view === 'playing') {
      const def = GAMES[selectedGame];
      root.innerHTML = `
        <div class="easter-egg-overlay">
          <div class="easter-egg-panel">
            <button type="button" class="easter-egg-close" id="ee-close" title="fechar">✕</button>
            <div class="ee-title">${def.icon} ${def.label} <span class="ee-score-live">pontos: <b id="ee-score-readout">0</b></span></div>
            <canvas id="ee-canvas" width="${def.width}" height="${def.height}"></canvas>
            <div class="ee-hint">⌨ setas (ou WASD) pra mover${selectedGame === 'tetris' ? ' · espaço pra derrubar · ↑ gira' : ''}</div>
          </div>
        </div>`;
      root.querySelector('#ee-close').addEventListener('click', close);
      return;
    }

    // gameover
    const def = GAMES[selectedGame];
    root.innerHTML = `
      <div class="easter-egg-overlay">
        <div class="easter-egg-panel">
          <button type="button" class="easter-egg-close" id="ee-close" title="fechar">✕</button>
          <div class="ee-title">${def.icon} fim de jogo</div>
          <div class="ee-final-score">${currentScore} ${currentScore === 1 ? 'ponto' : 'pontos'}</div>
          ${isNewRecord ? '<div class="ee-new-record">🎉 novo recorde seu!</div>' : ''}
          <div class="ee-gameover-actions">
            <button type="button" class="btn" id="ee-retry-btn">▶ jogar de novo</button>
            <button type="button" class="btn btn-ghost" id="ee-menu-btn">voltar ao menu</button>
          </div>
          <div class="ee-leaderboard-wrap">
            <div class="ee-leaderboard-title">🏆 recorde da campanha</div>
            ${scoresHtml()}
          </div>
        </div>
      </div>`;
    root.querySelector('#ee-close').addEventListener('click', close);
    root.querySelector('#ee-retry-btn').addEventListener('click', startGame);
    root.querySelector('#ee-menu-btn').addEventListener('click', () => openMenu());
  }

  openMenu('snake');
}
