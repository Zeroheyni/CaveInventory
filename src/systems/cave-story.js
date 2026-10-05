// Regras do sistema "Cave Story" -- extraídas, SEM mudar comportamento, do que antes ficava espalhado por
// characterSheet.js (atributos, vida, estamina, XP), character.js (carga), combat.js (condições) e boardHud.js (siglas).
// Os dados dos personagens deste sistema continuam nas colunas atuais da tabela `characters` (vitalidade, forca, ...,
// level, xp, hp_current...): nada foi migrado.
export const caveStory = {
  id: 'cave-story',
  label: 'Cave Story',

  // atributos de status (chave = coluna em `characters`)
  attributes: [
    { key: 'vitalidade', label: 'Vitalidade', abbr: 'VIT', icon: '❤', color: '#ff5a5a' },
    { key: 'forca', label: 'Força', abbr: 'FOR', icon: '💪', color: '#ff8a4c' },
    { key: 'agilidade', label: 'Agilidade', abbr: 'AGI', icon: '🏃', color: '#5ad4ff' },
    { key: 'destreza', label: 'Destreza', abbr: 'DES', icon: '🎯', color: '#4ade80' },
    { key: 'inteligencia', label: 'Inteligência', abbr: 'INT', icon: '🧠', color: '#b98bff' },
    { key: 'estamina', label: 'Estamina', abbr: 'EST', icon: '⚡', color: '#ffd93d' },
    { key: 'observacao', label: 'Observação', abbr: 'OBS', icon: '👁', color: '#2dd4bf' },
  ],

  // teste de atributo: dado + valor do atributo como modificador
  attributeTestDie: 'd20',

  // NPC de ficha simples sem status não tem vitalidade/estamina pra calcular pela fórmula --
  // hp_max_override/estamina_max_override (digitados direto pelo mestre) vencem quando presentes.
  hpMax(char) {
    if (char.hp_max_override !== undefined && char.hp_max_override !== null) return char.hp_max_override;
    return (char.vitalidade || 0) * 4;
  },
  estaminaMax(char) {
    if (char.estamina_max_override !== undefined && char.estamina_max_override !== null) return char.estamina_max_override;
    return char.estamina || 0;
  },
  xpNeeded(level) {
    return 10 * level;
  },
  // capacidade de carga: 3x Força + bônus dado pelo mestre (db/028)
  carryMax(strength, bonus) {
    return 3 * strength + bonus;
  },

  // condições de combate do catálogo fixo (db/031)
  conditions: [
    { key: 'envenenado', label: 'Envenenado', icon: '☠', color: '#4ade80' },
    { key: 'atordoado', label: 'Atordoado', icon: '💫', color: '#ffd93d' },
    { key: 'sangrando', label: 'Sangrando', icon: '🩸', color: '#ff5a5a' },
    { key: 'queimando', label: 'Queimando', icon: '🔥', color: '#ff8a4c' },
    { key: 'congelado', label: 'Congelado', icon: '❄', color: '#5ad4ff' },
    { key: 'amedrontado', label: 'Amedrontado', icon: '😨', color: '#b98bff' },
    { key: 'cego', label: 'Cego', icon: '🙈', color: '#9db4c7' },
    { key: 'imobilizado', label: 'Imobilizado', icon: '⛓', color: '#c9b878' },
  ],
};
