// Easter egg — efeitos sonoros sintetizados via Web Audio API (sem
// arquivo de áudio nenhum pra hospedar, mesmo espírito zero-
// dependência do resto do projeto). O AudioContext só nasce no
// primeiro som tocado (precisa de um gesto do usuário -- tecla/clique
// -- pra não bater na política de autoplay do navegador, e todo som
// aqui já só dispara em resposta a uma tecla/clique de verdade).
let ctx = null;
function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, duration, type, volume) {
  const audio = getCtx();
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audio.currentTime);
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  } catch (err) {
    // ambiente sem suporte a áudio (ex: navegador antigo) -- jogo
    // continua funcionando mudo, som é só um extra.
  }
}

// varredura de frequência (laser, pulo, queda) -- o tone() acima só toca nota fixa
function sweep(f0, f1, duration, type, volume) {
  const audio = getCtx();
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, audio.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), audio.currentTime + duration);
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  } catch (err) {
    // sem áudio -- jogo continua mudo
  }
}

// ruído filtrado (explosão, propulsor): buffer de ruído branco + passa-baixa
// cujo corte desce durante o som
let noiseBuffer = null;
function noiseBurst(duration, volume, cutoffStart, cutoffEnd) {
  const audio = getCtx();
  if (!audio) return;
  try {
    if (!noiseBuffer) {
      noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = audio.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffStart, audio.currentTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), audio.currentTime + duration);
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    src.start();
    src.stop(audio.currentTime + duration);
  } catch (err) {
    // sem áudio -- jogo continua mudo
  }
}

export const sfx = {
  eat: () => tone(660, 0.07, 'square', 0.12),
  move: () => tone(180, 0.02, 'square', 0.03),
  rotate: () => tone(420, 0.04, 'triangle', 0.08),
  drop: () => tone(150, 0.06, 'square', 0.1),
  hold: () => tone(300, 0.05, 'sine', 0.09),
  lineClear: (lines) => {
    const base = 500;
    for (let i = 0; i < Math.min(lines, 4); i++) {
      setTimeout(() => tone(base + i * 140, 0.09, 'square', 0.1), i * 55);
    }
  },
  // combo do Tetris -- arpejo curtinho subindo, mais notas quanto maior
  // o combo (até um teto pra não virar uma escala infinita ensurdecedora)
  combo: (n) => {
    const notes = [660, 830, 990, 1180, 1320];
    const count = Math.min(n + 1, notes.length);
    for (let i = 0; i < count; i++) {
      setTimeout(() => tone(notes[i], 0.09, 'triangle', 0.12), i * 45);
    }
  },
  flap: () => tone(520, 0.05, 'sine', 0.1),
  score: () => tone(760, 0.08, 'triangle', 0.12),
  gameOver: () => {
    tone(220, 0.18, 'sawtooth', 0.12);
    setTimeout(() => tone(140, 0.3, 'sawtooth', 0.12), 140);
  },
  // Breakout -- tijolo quebrando sobe de tom com o combo (mesmo
  // espírito do combo do Tetris), pancada grave na raquete/parede, e
  // um tom triste quando perde uma vida.
  brick: (comboLevel) => tone(500 + Math.min(comboLevel, 8) * 60, 0.06, 'square', 0.11),
  paddleBounce: () => tone(220, 0.05, 'triangle', 0.1),
  wallBounce: () => tone(300, 0.03, 'triangle', 0.06),
  lifeLost: () => tone(160, 0.16, 'sawtooth', 0.12),
  // Pong -- o "blip" clássico da raquete, mais agudo a cada rebatida
  // seguida no mesmo ponto (a bola também acelera, o som acompanha), e
  // um arpejinho subindo quando você ganha o ponto.
  paddleHit: (rally) => tone(330 + Math.min(rally, 12) * 38, 0.05, 'square', 0.11),
  // Asteroids / Dino / Invaders
  laser: (isUfo) => sweep(isUfo ? 520 : 1100, isUfo ? 180 : 260, 0.1, 'square', 0.06),
  boom: (size) => noiseBurst(0.14 + size * 0.09, 0.16, 1500 + size * 300, 120),
  thrust: () => noiseBurst(0.07, 0.035, 520, 160),
  hyper: () => sweep(200, 1400, 0.22, 'sine', 0.09),
  shipDie: () => {
    sweep(420, 50, 0.6, 'sawtooth', 0.11);
    noiseBurst(0.55, 0.2, 1800, 90);
  },
  ufo: (small) => tone(small ? 760 : 460, 0.07, 'sine', 0.05),
  ufoHit: () => {
    noiseBurst(0.25, 0.16, 1600, 140);
    [400, 600, 900].forEach((f, i) => setTimeout(() => tone(f, 0.07, 'triangle', 0.1), i * 55));
  },
  extraLife: () => {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.1, 'triangle', 0.12), i * 70));
  },
  jump: () => sweep(280, 640, 0.13, 'square', 0.08),
  milestone: () => {
    tone(880, 0.07, 'square', 0.09);
    setTimeout(() => tone(1175, 0.1, 'square', 0.09), 80);
  },
  march: (i) => tone([110, 98, 87, 82][i % 4], 0.08, 'square', 0.1),
  invaderDie: () => sweep(520, 110, 0.14, 'square', 0.09),
  pointWon: () => {
    [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.09, 'triangle', 0.12), i * 70));
  },
};
