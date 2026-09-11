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
  flap: () => tone(520, 0.05, 'sine', 0.1),
  score: () => tone(760, 0.08, 'triangle', 0.12),
  gameOver: () => {
    tone(220, 0.18, 'sawtooth', 0.12);
    setTimeout(() => tone(140, 0.3, 'sawtooth', 0.12), 140);
  },
};
