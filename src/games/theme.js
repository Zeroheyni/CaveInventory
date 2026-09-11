// Easter egg — lê as variáveis CSS do tema ATIVO (theme.css,
// `applyGlobalTheme`) pra desenhar os jogos com as cores certas em
// qualquer um dos temas do projeto (inclusive os claros) -- em vez de
// cores fixas no canvas, que ficariam deslocadas do resto da UI.
export function readThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name, fallback) => {
    const value = s.getPropertyValue(name);
    return value && value.trim() ? value.trim() : fallback;
  };
  return {
    bg: v('--stone-900', '#0b1013'),
    panel: v('--stone-800', '#12181c'),
    line: v('--stone-line', '#232d33'),
    accent: v('--accent', '#5ad4ff'),
    accentCore: v('--accent-core', '#2f8fd1'),
    accentFaint: v('--accent-faint', 'rgba(90,212,255,0.15)'),
    ink: v('--ink', '#cdeaf6'),
    inkDim: v('--ink-dim', '#8fadbe'),
    danger: v('--danger', '#ff5a5a'),
  };
}
