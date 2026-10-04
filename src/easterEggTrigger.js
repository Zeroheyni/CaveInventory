// Gatilho secreto dos minijogos (ver easterEggGames.js): 5 cliques no pontinho
// decorativo do título em menos de 2s. O pontinho tem só 8px -- e em vários
// temas ainda anima (escala/gira) ou é recortado por clip-path -- então acertar
// ele era difícil, principalmente no celular. Em vez de depender do próprio
// elemento, o clique é ouvido no `.title` inteiro e vale se cair dentro de um
// RAIO em volta do CENTRO do pontinho (que não se mexe com as animações).
// Nada de cursor/hover: continua escondido.
const CLICKS = 5;
const WINDOW_MS = 2000;
const RADIUS_PX = 24;

// O contador mora aqui dentro (não no render da tela): quem reconstrói o
// cabeçalho a cada render só chama `attach` de novo, sem zerar a contagem.
export function createEasterEggTrigger(onTrigger) {
  let count = 0;
  let timer = null;
  return {
    attach(titleEl) {
      if (!titleEl) return;
      titleEl.addEventListener('click', (e) => {
        const dot = titleEl.querySelector('.dot');
        if (!dot) return;
        const r = dot.getBoundingClientRect();
        const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        if (!(dist <= RADIUS_PX)) return;
        count += 1;
        clearTimeout(timer);
        timer = setTimeout(() => {
          count = 0;
        }, WINDOW_MS);
        if (count >= CLICKS) {
          count = 0;
          clearTimeout(timer);
          onTrigger();
        }
      });
    },
  };
}
