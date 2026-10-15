// Abre o overlay dos minijogos (carregado sob demanda). Se o navegador ficou com uma versão ANTIGA do site em cache, o arquivo do overlay
// que ela conhece já foi apagado do servidor e o import() falha -- nesse caso recarrega a página uma vez pra pegar a versão nova
// (antes o clique simplesmente não fazia nada, parecendo que o jogo/gatilho tinha sumido).
export async function openGamesOverlay(args) {
  try {
    const { renderEasterEggOverlay } = await import('./screens/easterEggGames.js');
    renderEasterEggOverlay(args);
  } catch (err) {
    let tried = false;
    try {
      tried = sessionStorage.getItem('cave.games.reloaded') === '1';
      sessionStorage.setItem('cave.games.reloaded', '1');
    } catch (_) { /* sem storage: tenta recarregar mesmo assim */ }
    if (!tried) {
      window.location.reload();
    } else {
      window.alert('Não consegui abrir os jogos. Atualize a página com Ctrl+F5 e tente de novo.\n(' + (err && err.message ? err.message : err) + ')');
    }
  }
}
