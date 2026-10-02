// Catálogo de temas visuais do site + o HTML de cada "swatch" do
// seletor de tema. Vivia dentro de character.js, mas ficha.js também
// passou a precisar (tema por NPC, ver db/050) -- e character.js já
// importa `renderFichaScreen` de ficha.js, então ficha.js importar de
// volta `THEMES`/`themeSwatchHtml` de character.js criaria um import
// circular. Módulo próprio, sem depender de nenhuma tela.
export const GAME_THEME_LABELS = { snake: 'Cobrinha', tetris: 'Tetris', flappy: 'Flappy Bird', '2048': '2048', breakout: 'Breakout', pong: 'Pong' };

// html de UM swatch do seletor de tema -- compartilhado entre
// character.js, masterCampaignHub.js e ficha.js (tema por NPC) pra não
// duplicar a lógica de "tema trancado" (cadeado + tooltip explicando
// qual jogo destrava) em cada lugar.
export function themeSwatchHtml(t, activeId, unlockedGames) {
  const locked = !!t.unlockGame && !(unlockedGames && unlockedGames.has(t.unlockGame));
  const special = t.group === 'especial'; // ganha brilho/selo próprio no seletor -- ver .theme-swatch.special em theme.css
  const title = locked ? `${t.label} — destrave batendo o recorde da campanha no ${GAME_THEME_LABELS[t.unlockGame] || t.unlockGame}` : t.label;
  return `<button type="button" class="theme-swatch ${special ? 'special' : ''} ${activeId === t.id ? 'active' : ''} ${locked ? 'locked' : ''}" data-theme-id="${t.id}" ${locked ? 'data-locked="1"' : ''} title="${title}" style="--swatch-accent:${t.accent}; --swatch-void:${t.void};">${locked ? '<span class="theme-swatch-lock">🔒</span>' : ''}</button>`;
}

export const THEMES = [
  {id:'caverna-azul', label:'Caverna Azul', group:'dark', accent:'#5ad4ff', void:'#050708'},
  {id:'nucleo-roxo', label:'Núcleo Roxo', group:'dark', accent:'#b98bff', void:'#08050d'},
  {id:'ferrugem', label:'Ferrugem', group:'dark', accent:'#ff8a4c', void:'#0a0705'},
  {id:'verde-radioativo', label:'Verde Radioativo', group:'dark', accent:'#7aff5a', void:'#060a06'},
  {id:'sangue', label:'Sangue', group:'dark', accent:'#ff4d6d', void:'#0a0405'},
  {id:'dourado-imperial', label:'Dourado Imperial', group:'dark', accent:'#ffcc4d', void:'#0a0805'},
  {id:'ciano-neon', label:'Ciano Neon', group:'dark', accent:'#3df0e0', void:'#04090a'},
  {id:'rosa-neon', label:'Rosa Neon', group:'dark', accent:'#ff5cd6', void:'#0a0509'},
  {id:'indigo-profundo', label:'Índigo Profundo', group:'dark', accent:'#8c7bff', void:'#050414'},
  {id:'teal-abissal', label:'Teal Abissal', group:'dark', accent:'#33e6a8', void:'#040a09'},
  {id:'marte-vermelho', label:'Marte Vermelho', group:'dark', accent:'#ff5a44', void:'#0a0505'},
  {id:'ambar-fossil', label:'Âmbar Fóssil', group:'dark', accent:'#ffb020', void:'#0a0805'},
  {id:'safira-profunda', label:'Safira Profunda', group:'dark', accent:'#4d7fff', void:'#04070f'},
  {id:'limao-acido', label:'Limão Ácido', group:'dark', accent:'#c6ff3d', void:'#080a04'},
  {id:'orquidea-sombria', label:'Orquídea Sombria', group:'dark', accent:'#e066ff', void:'#0a0510'},

  {id:'papel-antigo', label:'Papel Antigo', group:'light', accent:'#9c5f26', void:'#f4ecd8'},
  {id:'laboratorio', label:'Laboratório', group:'light', accent:'#0b7fb0', void:'#f0f4f7'},
  {id:'deserto-claro', label:'Deserto Claro', group:'light', accent:'#c2621c', void:'#faf1e4'},
  {id:'menta-clara', label:'Menta Clara', group:'light', accent:'#0b8a63', void:'#eef7f3'},
  {id:'rosa-pastel', label:'Rosa Pastel', group:'light', accent:'#c23368', void:'#faeef2'},
  {id:'lavanda', label:'Lavanda', group:'light', accent:'#7440c2', void:'#f2eefa'},
  {id:'ceu-claro', label:'Céu Claro', group:'light', accent:'#1f8fd6', void:'#eaf4fb'},
  {id:'coral', label:'Coral', group:'light', accent:'#e05a2e', void:'#fdf0ea'},
  {id:'oliva-claro', label:'Oliva Claro', group:'light', accent:'#727a1f', void:'#f6f5e6'},
  {id:'cinza-perola', label:'Cinza Pérola', group:'light', accent:'#5c6b6a', void:'#f2f2f0'},
  {id:'vinho-claro', label:'Vinho Claro', group:'light', accent:'#a3283f', void:'#faedec'},
  {id:'turquesa-suave', label:'Turquesa Suave', group:'light', accent:'#1a9e94', void:'#eaf7f5'},
  {id:'girassol', label:'Girassol', group:'light', accent:'#c4900a', void:'#fbf4e2'},
  {id:'marinho-claro', label:'Azul Marinho Claro', group:'light', accent:'#2c5aa3', void:'#eaf0fb'},
  {id:'ameixa-clara', label:'Ameixa Clara', group:'light', accent:'#8e4a8e', void:'#f7edf7'},

  {id:'cinza-grafite', label:'Cinza Grafite', group:'neutral', accent:'#9db4c7', void:'#202226'},
  {id:'bege-militar', label:'Bege Militar', group:'neutral', accent:'#c9b878', void:'#2b2a22'},
  {id:'aco-frio', label:'Aço Frio', group:'neutral', accent:'#7fb0d6', void:'#21252b'},
  {id:'terracota', label:'Terracota Neutro', group:'neutral', accent:'#d99a72', void:'#2b2420'},
  {id:'musgo-neutro', label:'Musgo Neutro', group:'neutral', accent:'#a8c46e', void:'#242820'},
  {id:'ardosia', label:'Ardósia', group:'neutral', accent:'#7fa3c4', void:'#1e2226'},
  {id:'argila', label:'Argila', group:'neutral', accent:'#c67f52', void:'#28211d'},
  {id:'chumbo', label:'Chumbo', group:'neutral', accent:'#a08fc4', void:'#212024'},
  {id:'areia-neutra', label:'Areia Neutra', group:'neutral', accent:'#d4b56a', void:'#2b2820'},
  {id:'ametista-neutra', label:'Ametista Neutra', group:'neutral', accent:'#b98fd6', void:'#241f28'},
  {id:'vinho-neutro', label:'Vinho Neutro', group:'neutral', accent:'#b06868', void:'#282022'},
  {id:'oceano-neutro', label:'Oceano Neutro', group:'neutral', accent:'#6b9aa3', void:'#1f2628'},
  {id:'amendoa-neutra', label:'Amêndoa Neutra', group:'neutral', accent:'#c9a374', void:'#2a251e'},
  {id:'pinha-neutra', label:'Pinha Neutra', group:'neutral', accent:'#7fa88a', void:'#212824'},
  {id:'cobre-neutro', label:'Cobre Neutro', group:'neutral', accent:'#b8805a', void:'#251f1a'},

  // ---- desbloqueáveis: só depois de segurar o recorde da campanha
  // pelo menos 1x naquele minijogo escondido (db/049) ----
  // cada jogo tem uma variante ESCURA e uma CLARA -- as duas destravam
  // juntas (o desbloqueio é por jogo, não por tema -- ver
  // db/049_patch_2048_and_theme_unlocks.sql, `unlockGame` é o que liga
  // um tema ao outro pro mesmo `game`).
  {id:'snake-terrario', label:'Terrário Neon', group:'especial', accent:'#5cff8f', void:'#071009', unlockGame:'snake'},
  {id:'snake-jardim', label:'Jardim de Manhã', group:'especial', accent:'#d94f3d', void:'#f3fbee', unlockGame:'snake'},
  {id:'tetris-nebulosa', label:'Nebulosa de Blocos', group:'especial', accent:'#4fe1ff', void:'#070b1a', unlockGame:'tetris'},
  {id:'tetris-vidro', label:'Vidro e Ouro', group:'especial', accent:'#d69a2b', void:'#f6f4ee', unlockGame:'tetris'},
  {id:'flappy-noturno', label:'Voo Noturno', group:'especial', accent:'#ffb03e', void:'#0a0e24', unlockGame:'flappy'},
  {id:'flappy-aurora', label:'Aurora Matinal', group:'especial', accent:'#ff8a5c', void:'#cdeaff', unlockGame:'flappy'},
  {id:'2048-ambar', label:'Âmbar Noturno', group:'especial', accent:'#f2a65a', void:'#16130f', unlockGame:'2048'},
  {id:'2048-marfim', label:'Tabuleiro de Marfim', group:'especial', accent:'#f2b179', void:'#faf8ef', unlockGame:'2048'},
  {id:'breakout-neon', label:'Fliperama Neon', group:'especial', accent:'#ff2e88', void:'#0a0612', unlockGame:'breakout'},
  {id:'breakout-confeitaria', label:'Confeitaria Pastel', group:'especial', accent:'#ff5c9e', void:'#fff3f8', unlockGame:'breakout'},
  {id:'pong-mesa', label:'Mesa Noturna', group:'especial', accent:'#ff9f43', void:'#04110e', unlockGame:'pong'},
  {id:'pong-caderno', label:'Caderno de Rabisco', group:'especial', accent:'#2f5fd0', void:'#fbf6e9', unlockGame:'pong'}
];
