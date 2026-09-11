// Easter egg — overlay dos minijogos escondidos (Cobrinha/Tetris/
// Flappy Bird), destravado clicando 5x no pontinho do cabeçalho (ver
// wireEasterEgg em character.js/masterCampaignHub.js). Anexado direto
// no document.body (não dentro de #app) pra sobreviver a qualquer
// re-render da tela por baixo enquanto o overlay estiver aberto.
import { escapeHtml } from '../shared/gameData.js';
import { submitGameScore, listHighScores } from '../games.js';
import { createSnakeGame } from '../games/snake.js';
import { createTetrisGame } from '../games/tetris.js';
import { createFlappyGame } from '../games/flappy.js';

const GAMES = {
  snake: { label: 'Cobrinha', icon: '🐍', factory: createSnakeGame, width: 360, height: 360, hasPreview: false },
  tetris: { label: 'Tetris', icon: '🧱', factory: createTetrisGame, width: 200, height: 400, hasPreview: true },
  flappy: { label: 'Flappy Bird', icon: '🐤', factory: createFlappyGame, width: 300, height: 450, hasPreview: false },
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
  let myBest = 0;
  let campaignBest = 0;
  let currentScore = 0;
  let isNewRecord = false;
  let activeEngine = null;
  let keyHandler = null;

  // pra quando o jogo em andamento fica "abandonado" -- o jogador
  // troca de aba/volta pro menu sem perder de verdade -- que sem isso
  // continuava rodando escondido (setInterval/rAF vivo) e um
  // onScoreChange/onGameOver atrasado dele acabava disparando um
  // render() por cima da tela que o jogador está vendo agora.
  function stopActiveEngine() {
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }

  function close() {
    stopActiveEngine();
    root.remove();
  }

  async function openMenu(game) {
    stopActiveEngine();
    selectedGame = game || selectedGame;
    view = 'menu';
    render();
    try {
      scores = await listHighScores(campaign.id, selectedGame);
    } catch (err) {
      scores = [];
    }
    // essa busca é assíncrona -- se o jogador já clicou "jogar" antes
    // dela terminar, `view` não é mais 'menu' nessa altura. Sem essa
    // checagem, esse render() atrasado reconstruía a view "playing"
    // (que já estava rodando com o canvas certo) do zero, criando um
    // <canvas> NOVO e órfão -- o motor do jogo continuava desenhando
    // no canvas antigo, agora invisível, e a tela ficava em branco.
    if (view === 'menu') render();
  }

  function startGame() {
    stopActiveEngine();
    view = 'playing';
    currentScore = 0;
    isNewRecord = false;
    myBest = (scores.find((s) => s.profile_id === profile.id) || {}).best_score || 0;
    campaignBest = scores.length > 0 ? scores[0].best_score : 0;
    render();

    const def = GAMES[selectedGame];
    const canvas = document.getElementById('ee-canvas');
    const nextCanvas = document.getElementById('ee-next-canvas');
    const holdCanvas = document.getElementById('ee-hold-canvas');
    activeEngine = def.factory(canvas, {
      nextCanvas,
      holdCanvas,
      onScoreChange: (s) => {
        currentScore = s;
        updateScoreReadout();
      },
      onGameOver: (finalScore) => onGameOver(finalScore),
    });
    keyHandler = (e) => activeEngine && activeEngine.handleKey(e);
    document.addEventListener('keydown', keyHandler);
    if (activeEngine.handleClick) canvas.addEventListener('click', activeEngine.handleClick);
    activeEngine.start();
  }

  async function onGameOver(finalScore) {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    isNewRecord = finalScore > 0 && finalScore > myBest;
    view = 'gameover';
    render();
    try {
      if (finalScore > 0) await submitGameScore(selectedGame, finalScore, playerName);
      scores = await listHighScores(campaign.id, selectedGame);
    } catch (err) {
      // silencioso -- não vale travar o jogador numa tela de erro por
      // causa do placar, o jogo já acabou de qualquer forma.
    }
    // mesma corrida do openMenu -- se o jogador já clicou "jogar de
    // novo" antes do placar voltar, esse render() atrasado não pode
    // pisar na partida nova que já está rodando.
    if (view === 'gameover') render();
  }

  function updateScoreReadout() {
    const el = document.getElementById('ee-score-readout');
    if (el) el.textContent = String(currentScore);
    const beatMine = document.getElementById('ee-score-mine-item');
    const beatCampaign = document.getElementById('ee-score-campaign-item');
    if (beatMine) beatMine.classList.toggle('ee-beat', currentScore > myBest);
    if (beatCampaign) beatCampaign.classList.toggle('ee-beat', currentScore > campaignBest);
  }

  function scoresHtml() {
    if (scores.length === 0) return '<p class="ee-empty">ninguém jogou ainda -- seja o primeiro!</p>';
    return `
      <ol class="ee-leaderboard">
        ${scores.map((s) => `<li><span class="ee-lb-name">${escapeHtml(s.player_name)}</span><span class="ee-lb-score">${s.best_score}</span></li>`).join('')}
      </ol>`;
  }

  function scoreboardHtml() {
    return `
      <div class="ee-scoreboard">
        <div class="ee-score-item"><span>pontos</span><b id="ee-score-readout">${currentScore}</b></div>
        <div class="ee-score-item" id="ee-score-mine-item"><span>seu recorde</span><b>${myBest}</b></div>
        <div class="ee-score-item" id="ee-score-campaign-item"><span>recorde da campanha</span><b>${campaignBest}</b></div>
      </div>`;
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
            <div class="ee-title">${def.icon} ${def.label}</div>
            <div class="ee-play-area">
              <div class="ee-canvas-col">
                <canvas id="ee-canvas" width="${def.width}" height="${def.height}"></canvas>
                <div class="ee-hint">
                  ${selectedGame === 'tetris' ? '⌨ setas ou WASD · espaço derruba · ↑/X gira horário · Z gira anti-horário · C guarda' : ''}
                  ${selectedGame === 'snake' ? '⌨ setas ou WASD pra mover' : ''}
                  ${selectedGame === 'flappy' ? '⌨ espaço/↑ ou clique na tela pra bater asa' : ''}
                </div>
              </div>
              ${
                def.hasPreview
                  ? `<div class="ee-side-col">
                      <div class="ee-preview-block"><span>próxima</span><canvas id="ee-next-canvas" width="64" height="64"></canvas></div>
                      <div class="ee-preview-block"><span>guardada</span><canvas id="ee-hold-canvas" width="64" height="64"></canvas></div>
                    </div>`
                  : ''
              }
            </div>
            ${scoreboardHtml()}
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
