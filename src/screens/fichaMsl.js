// Ficha do sistema Magic Learning (Magical Skill Learning) -- ver src/systems/magic-learning.js e MSL_Regras_para_Site.md.
// Dados em characters.system_data.msl; nível/XP e HP/PE atuais ficam nas colunas de sempre (level, xp, hp_current, estamina_current),
// então rastreador de combate, tabuleiro e dados seguem funcionando. Embutida como a ficha do Cave Story (character.js / masterFicha.js).
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { getCharacterSheet, subscribeCharacterSheet, sheetDataOf, updateSheetData, uploadAvatar, grantXp, revokeXp, hpBarClass } from '../characterSheet.js';
import { rollD20Test, getHiddenRollMode } from '../dice.js';
import { nameInCampaign } from '../accounts.js';
import { computeSpell, variableTable, normalizeCustomSpell } from '../systems/msl-spells.js';
import { listCustomSpells, saveCustomSpell, deleteCustomSpell } from '../mslSpells.js';
import {
  magicLearning,
  ATTRIBUTE_GROUPS,
  BASIC_SUBGROUPS,
  mslOf,
  derive,
  upkeepTurn,
  attrTotal,
  attrEffective,
  attrMod,
  skillGrade,
  skillBonus,
  testMod,
  poolKeyOfAttr,
  xpNeededFor,
  woundState,
  pvSummary,
  sanityStage,
  spellDifficulty,
  attrKeyByLabel,
  advantageById,
  disadvantageById,
  rollDie,
  rollDice,
  CREATION_SKILL_GRADES,
} from '../systems/magic-learning.js';
import {
  SKILLS,
  SKILL_GROUPS,
  SKILL_GRADE_LABEL,
  ADVANTAGES,
  DISADVANTAGES,
  DISADVANTAGE_PV_MAX,
  TALENTS,
  TRAUMAS,
  SANITY_LOSS,
  DAMAGE_TYPES,
  ELEMENTS,
  SCHOOLS,
  ACTIONS,
} from '../systems/msl-data.js';

let activeChannel = null;
let SPELLS = null;
async function loadSpells() {
  if (!SPELLS) SPELLS = (await import('../systems/msl-magias.json')).default;
  return SPELLS;
}

const TABS = [
  ['atributos', 'Atributos'],
  ['pericias', 'Perícias'],
  ['tracos', 'Traços'],
  ['magias', 'Magias'],
  ['regras', 'Regras'],
  ['notas', 'Notas'],
];
const attrDefs = magicLearning.attributes;
const attrDef = (k) => attrDefs.find((a) => a.key === k);
const signed = (n) => (n >= 0 ? '+' + n : String(n));
const pct = (cur, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0);

export function renderFichaMslScreen(app, { session, profile, campaign, characterId, onBack }) {
  const isMaster = profile.role === 'master';
  const $ = (id) => app.querySelector('#' + id);

  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }
  if (app._fichaCleanup) {
    app._fichaCleanup();
    app._fichaCleanup = null;
  }

  let sheet = null;
  let tab = 'atributos';
  let draft = null; // rascunho de atributos do jogador (ainda não confirmado)
  let rollMode = 'normal'; // normal | vantagem | desvantagem
  let lastRoll = null;
  let showTemp = false;
  let showHelp = false; // descrições dos atributos (Função, "o alvo resiste com", "costuma escalar")
  let uploadingAvatar = false;
  let spellFilter = { school: '', level: '', text: '', learned: false, source: '' };
  let spellOpen = new Set();
  let spellMsg = '';
  let spellBrowserOpen = false;
  let customSpells = []; // magias personalizadas da campanha que este usuário pode ver (db/081)
  let spellEditor = null; // rascunho do editor de magia (mestre)
  let helpOpen = false; // painel "?" com as siglas
  let edError = '';
  let lastFormulaIdx = null; // última linha de fórmula em que o cursor esteve (pra inserir siglas)
  let perkPicker = null; // 'adv' | 'dis' quando o seletor visual está aberto
  let perkFilter = { level: '', text: '' };
  let busy = false;
  let reloadTimer = null;

  // ---------------------------------------------------------------- carga
  async function load() {
    sheet = await getCharacterSheet(characterId);
    await refreshCustomSpells();
    if (sheet && !mslOf(sheet).initialized && canEdit()) await initializeSheet();
    render();
    if (!activeChannel) {
      activeChannel = subscribeCharacterSheet(characterId, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
          if (busy) return;
          const fresh = await getCharacterSheet(characterId);
          if (!fresh) return;
          sheet = fresh;
          render();
        }, 600);
      });
    }
  }

  const isOwner = () => !!sheet && !!session && sheet.owner_id === session.user.id;
  const canEdit = () => isMaster || isOwner();
  // criar magia: o mestre sempre; o jogador só se o mestre liberou nesta ficha (padrão: bloqueado)
  const canCreateSpell = () => isMaster || (isOwner() && !!mslOf(sheet).canCreateSpells);
  const inCreation = () => !mslOf(sheet).done;
  // jogador monta o personagem durante a criação; depois só o mestre mexe em atributos/traços (o jogador mexe em recursos, magias, notas)
  // vantagens/desvantagens: o jogador só mexe na criação E enquanto não confirmou (confirmar tranca; só o mestre destranca)
  const canEditTraits = () => isMaster || (isOwner() && inCreation() && !mslOf(sheet).perksConfirmed);
  // escola e elemento: o jogador escolhe durante a criação
  const canEditSetup = () => isMaster || (isOwner() && inCreation());

  // primeira abertura: HP/PE/MP começam cheios (sem isso ficam com os valores padrão do Cave Story)
  async function initializeSheet() {
    const d = derive(sheet);
    await commit((m) => {
      m.mp = d.mpMax;
    }, { hp_current: d.hpMax, estamina_current: d.peMax });
  }

  // grava: clona a ficha normalizada, aplica a mudança e salva (system_data inteiro + colunas extras)
  // syncMax: a mudança mexe nos máximos (atributo/vantagem). Na criação tudo volta a ficar cheio; depois, o atual acompanha a variação do máximo.
  async function commit(mutator, columns = {}, { rerender = true, syncMax = false } = {}) {
    const m = JSON.parse(JSON.stringify(mslOf(sheet)));
    mutator(m);
    m.initialized = true;
    const system_data = { ...(sheet.system_data || {}), msl: m };
    if (syncMax) {
      const before = derive(sheet);
      const after = derive({ ...sheet, system_data });
      if (!m.done) {
        columns = { ...columns, hp_current: after.hpMax, estamina_current: after.peMax };
        m.mp = after.mpMax;
      } else {
        const grow = (cur, b, a) => (a >= b ? Math.min(a, cur + (a - b)) : Math.min(cur, a));
        columns = { ...columns, hp_current: grow(sheet.hp_current, before.hpMax, after.hpMax), estamina_current: grow(sheet.estamina_current, before.peMax, after.peMax) };
        const curMp = (mslOf(sheet).mp === null ? before.mpMax : mslOf(sheet).mp);
        m.mp = grow(curMp, before.mpMax, after.mpMax);
      }
    }
    const prev = { system_data: sheet.system_data, ...Object.fromEntries(Object.keys(columns).map((k) => [k, sheet[k]])) };
    sheet.system_data = system_data;
    Object.assign(sheet, columns);
    if (rerender) render();
    busy = true;
    const { error } = await supabase.from('characters').update({ system_data, ...columns }).eq('id', characterId);
    busy = false;
    if (error) {
      Object.assign(sheet, prev);
      window.alert('Não consegui salvar: ' + error.message);
      render();
    }
  }
  async function saveColumns(columns) {
    Object.assign(sheet, columns);
    busy = true;
    const { error } = await supabase.from('characters').update(columns).eq('id', characterId);
    busy = false;
    if (error) window.alert('Não consegui salvar: ' + error.message);
  }

  // ---------------------------------------------------------------- testes
  const rollerName = () => sheet.name || nameInCampaign(profile) || 'jogador';
  async function doRoll(label, mod) {
    const msl = mslOf(sheet);
    const d = derive(sheet);
    // exaustão: -2 por nível em todos os testes
    const total = mod + d.exaustaoPenalidade;
    try {
      const row = await rollD20Test(campaign.id, session.user.id, rollerName(), total, label, rollMode, getHiddenRollMode() && isMaster);
      lastRoll = { label: row.label, kept: row.kept, results: row.results, mod: total, total: row.total, crit: row.kept >= d.critico, fumble: row.kept === 1, mode: rollMode, hidden: !!row.hidden };
    } catch (err) {
      lastRoll = { error: err.message };
    }
    render();
  }

  // ---------------------------------------------------------------- render
  function render() {
    if (!sheet) {
      app.innerHTML = '<div class="combat-empty">carregando ficha...</div>';
      return;
    }
    const y = window.scrollY;
    const msl = mslOf(sheet);
    if (msl.noMagic && tab === 'magias') tab = 'atributos';
    const d = derive(sheet);
    const needed = xpNeededFor(sheet.level);
    const xpPct = pct(sheet.xp, needed);
    const ws = woundState(sheet.hp_current, d.hpMax, d.morteHp);
    app.innerHTML = `
      <div class="msl-root">
        ${onBack ? `<button type="button" class="btn btn-ghost" data-act="back" style="margin-bottom:12px;">← voltar</button>` : ''}
        ${headerHtml(msl, d, ws, needed, xpPct)}
        ${resourcesHtml(msl, d, ws)}
        ${lastRollHtml()}
        <div class="msl-tabs">
          ${TABS.filter(([id]) => !(msl.noMagic && id === 'magias')).map(([id, label]) => `<button type="button" class="msl-tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
        </div>
        <div class="msl-body">${tabHtml(msl, d)}</div>
      </div>`;
    window.scrollTo(0, y);
    if (tab === 'magias') fillSpells();
  }

  function headerHtml(msl, d, ws, needed, xpPct) {
    const sch = msl.school ? `<span class="msl-chip">${escapeHtml(msl.school)}</span>` : '';
    const el = msl.element ? `<span class="msl-chip msl-chip-el">${escapeHtml(msl.element)}</span>` : '';
    return `
      <div class="ficha-header-card">
        <div class="ficha-avatar-wrap">
          ${
            sheet.avatar_url
              ? `<img class="ficha-avatar" src="${escapeHtml(sheet.avatar_url)}" alt="avatar">`
              : `<div class="ficha-avatar-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>`
          }
          ${canEdit() ? `<button type="button" class="ficha-avatar-upload-btn" data-act="avatar" title="${uploadingAvatar ? 'enviando...' : 'trocar foto'}">${uploadingAvatar ? '…' : '📷'}</button><input type="file" accept="image/*" id="msl-avatar-input" style="display:none;">` : ''}
        </div>
        <div class="ficha-header-info">
          <div class="ficha-name">${escapeHtml(sheet.name)}</div>
          <div class="ficha-level-row">
            <span class="ficha-level-tag">NÍVEL ${sheet.level}</span>
            <div class="ficha-xp-bar"><div class="ficha-xp-fill" style="width:${xpPct}%"></div></div>
            <span class="ficha-xp-text">${sheet.xp} / ${needed} XP</span>
          </div>
          <div class="msl-chips">
            ${sch}${el}
            <span class="msl-chip msl-wound msl-wound-${ws.tone}">${ws.label}</span>
            ${!msl.done ? '<span class="msl-chip msl-chip-warn">em criação</span>' : ''}
            ${msl.family ? '<span class="msl-chip msl-chip-fam" title="família mágica: libera as magias de família">🏛 ' + escapeHtml(msl.family) + '</span>' : ''}
            ${msl.noMagic ? '<span class="msl-chip" title="ainda não tem magia: atributos e status mágicos ocultos">sem magia (ainda)</span>' : ''}
          </div>
          ${
            isMaster
              ? `<div class="msl-xp-row"><input type="number" id="msl-xp-input" placeholder="XP" min="1"><button type="button" class="btn btn-ghost" data-act="xp-give">+ XP</button><button type="button" class="btn btn-ghost" data-act="xp-take" title="tirar XP">− XP</button></div>`
              : ''
          }
        </div>
      </div>`;
  }

  function barBlock(kind, label, icon, cur, max, fillClass, extraClass = '') {
    const p = pct(cur, max);
    return `
      <div class="ficha-bar-block msl-bar ${extraClass}">
        <div class="ficha-bar-label">${icon} ${label} <span class="ficha-bar-readout">${cur} / ${max}</span></div>
        <div class="combat-hp-bar"><div class="combat-hp-fill ${fillClass}" style="width:${p}%"></div></div>
        ${
          canEdit()
            ? `<div class="ficha-bar-controls">
          <button type="button" class="combat-hp-btn" data-vital="${kind}" data-delta="-5">−5</button>
          <button type="button" class="combat-hp-btn" data-vital="${kind}" data-delta="-1">−</button>
          <input type="number" class="combat-hp-input" data-vital-input="${kind}" value="${cur}">
          <button type="button" class="combat-hp-btn" data-vital="${kind}" data-delta="1">+</button>
          <button type="button" class="combat-hp-btn" data-vital="${kind}" data-delta="5">+5</button>
        </div>`
            : ''
        }
      </div>`;
  }

  function resourcesHtml(msl, d, ws) {
    const mp = msl.mp === null ? d.mpMax : msl.mp;
    const hpClass = ws.tone === 'ok' ? '' : ws.tone === 'mid' ? 'mid' : 'low';
    const stage = sanityStage(msl.sanidade);
    return `
      <div class="ficha-bars msl-bars">
        ${barBlock('hp', 'HP', '❤', sheet.hp_current, d.hpMax, hpClass)}
        ${barBlock('pe', 'PE', '⚡', sheet.estamina_current, d.peMax, 'ficha-estamina-fill')}
        ${msl.noMagic ? '' : barBlock('mp', 'MP', '✨', mp, d.mpMax, 'msl-mp-fill')}
        ${barBlock('san', 'Sanidade', '🧠', msl.sanidade, d.sanidadeMax, 'msl-san-fill', stage.id === 'ok' ? '' : 'msl-bar-warn')}
      </div>
      <div class="msl-derived">
        ${[
          ['CE', d.ce, 'Classe de Esquiva'],
          ['Desloc.', d.deslocamento + ' m', 'por movimento (2 PA); correr (3 PA) dobra'],
          ['CC', d.cc, 'Capacidade de Carga (peso)'],
          ...(msl.noMagic
            ? []
            : [
                ['Fluxo', d.fluxo, 'MP máximo gasto por turno'],
                ['Manut.', slotsUsed(msl).m + '/' + d.manutencao, 'vagas de Manutenção usadas: magias sustentadas e criaturas invocadas'],
                ['Formas', slotsUsed(msl).f + '/' + d.formas, 'vagas de Formas usadas: estruturas, armas e terrenos moldados'],
                ['Detecção', d.deteccao + ' m', 'percepção de rastros mágicos'],
                ['Decifração', d.decifracao, 'nível máximo de magia que identifica/aprende'],
              ]),
          ['Armadura', d.armadura, 'reduz o dano recebido'],
        ]
          .map(([k, v, tip]) => `<span class="msl-stat" title="${escapeHtml(tip)}"><b>${v}</b>${k}</span>`)
          .join('')}
        <span class="msl-stat msl-exh ${msl.exaustao ? 'on' : ''}" title="Exaustão: −2 em todos os testes e na CE por nível; desmaia no nível ${d.exaustaoMax}">
          <b>${msl.exaustao}</b>Exaustão
          ${canEdit() ? `<button type="button" data-exh="-1">−</button><button type="button" data-exh="1">+</button>` : ''}
        </span>
      </div>
      <div class="msl-actions-row">
        <div class="msl-rollmode" title="vantagem: rola 2d20 e fica o maior; desvantagem: o menor">
          ${['normal', 'vantagem', 'desvantagem'].map((m) => `<button type="button" class="${rollMode === m ? 'active' : ''}" data-rollmode="${m}">${m}</button>`).join('')}
        </div>
        <button type="button" class="btn btn-ghost" data-act="init">🎲 Iniciativa (${signed(d.iniciativaMod)})</button>
        ${canEdit() ? `<button type="button" class="btn btn-ghost" data-act="rest" title="recupera HP, PE e MP, zera a exaustão e recupera 1d6 de Sanidade">☾ Descanso</button>` : ''}
      </div>`;
  }

  function lastRollHtml() {
    if (!lastRoll) return '';
    if (lastRoll.error) return `<div class="msl-lastroll msl-lastroll-err">não deu pra rolar: ${escapeHtml(lastRoll.error)}</div>`;
    const dice = lastRoll.results.length > 1 ? `[${lastRoll.results.join(', ')}] → ${lastRoll.kept}` : String(lastRoll.kept);
    return `<div class="msl-lastroll ${lastRoll.crit ? 'crit' : ''} ${lastRoll.fumble ? 'fumble' : ''}">
      <span>${escapeHtml(lastRoll.label)}${lastRoll.hidden ? ' 🙈' : ''}</span>
      <span class="msl-lastroll-calc">d20: ${dice} ${signed(lastRoll.mod)}</span>
      <b class="msl-lastroll-total">${lastRoll.total}</b>
      ${lastRoll.crit ? '<em>CRÍTICO!</em>' : lastRoll.fumble ? '<em>falha crítica</em>' : ''}
    </div>`;
  }

  function tabHtml(msl, d) {
    if (tab === 'atributos') return attributesTab(msl, d);
    if (tab === 'pericias') return skillsTab(msl);
    if (tab === 'tracos') return traitsTab(msl);
    if (tab === 'magias') return spellsTab(msl, d);
    if (tab === 'regras') return rulesTab(d);
    return notesTab(msl);
  }

  // ---------------------------------------------------------------- aba: atributos
  // uma linha de atributo: nome · [−] valor [+] · modificador de teste · 🎲
  function attrRow(a, msl, view, labelKey = 'short') {
    const base = view.attrs[a.key];
    const total = Math.max(0, base + (view.bonus[a.key] || 0));
    const eff = Math.max(0, total + msl.temp[a.key]);
    const mod = Math.floor(eff / 2);
    const pk = poolKeyOfAttr(a.key);
    const draftMode = draft && isOwner() && !isMaster;
    const canUp = isMaster || (draftMode && view.poolLeft[pk] > 0);
    const canDown = isMaster ? base > 0 : draftMode && base > sheet_base(a.key);
    const gained = draft && base > sheet_base(a.key) ? ` <small class="msl-new" title="pontos novos neste rascunho">+${base - sheet_base(a.key)}</small>` : '';
    return `
      <div class="msl-arow" style="--c:${a.color};">
        <div class="msl-arow-name" title="${escapeHtml(a.desc || a.label)}">${escapeHtml(a[labelKey])}${showHelp && a.desc ? '<small class="msl-arow-desc">' + escapeHtml(a.desc) + (a.resist ? ' · o alvo resiste com <b>' + escapeHtml(a.resist) + '</b>' : '') + (a.scales ? ' · costuma escalar: ' + escapeHtml(a.scales) : '') + '</small>' : ''}</div>
        <div class="msl-arow-val">
          <button type="button" class="msl-step" data-attr="${a.key}" data-d="-1" ${canDown ? '' : 'disabled'} aria-label="diminuir">−</button>
          <b>${total}</b>
          <button type="button" class="msl-step" data-attr="${a.key}" data-d="1" ${canUp ? '' : 'disabled'} aria-label="aumentar">+</button>
        </div>
        <div class="msl-arow-info">
          <span class="msl-arow-mod" title="modificador de teste (atributo ÷ 2)">${signed(mod)}</span>
          ${view.bonus[a.key] ? `<small title="bônus de vantagens: ${signed(view.bonus[a.key])}">(${base}${signed(view.bonus[a.key])})</small>` : ''}
          ${msl.temp[a.key] ? `<small class="msl-temp-tag" title="modificador temporário">${signed(msl.temp[a.key])} temp</small>` : ''}${gained}
        </div>
        <button type="button" class="msl-roll" data-roll-attr="${a.key}" title="rolar ${escapeHtml(a.label)}">🎲</button>
        ${showTemp && canEdit() ? `<input type="number" class="msl-temp-input" data-temp="${a.key}" value="${msl.temp[a.key]}" title="modificador temporário (não muda HP/PE/MP máximos)">` : ''}
      </div>`;
  }
  // cartão de um grupo de atributos (um par dos básicos, ou os sociais/mágicos inteiros)
  function attrBlock(title, icon, color, attrs, msl, view, labelKey) {
    return `
      <div class="msl-ablock" style="--c:${color};">
        <div class="msl-ablock-head"><span class="msl-ablock-ico">${icon}</span><b>${escapeHtml(title)}</b></div>
        ${attrs.map((a) => attrRow(a, msl, view, labelKey)).join('')}
      </div>`;
  }
  // valor confirmado (base salva) -- o rascunho do jogador nunca desce abaixo disso
  const sheet_base = (key) => mslOf(sheet).attrs[key];

  function attributesTab(msl, d) {
    const bonus = {};
    ADVANTAGES.concat(DISADVANTAGES).forEach((def) => {
      if (![...msl.advantages, ...msl.disadvantages].some((e) => e.id === def.id)) return;
      Object.entries(def.bonus || {}).forEach(([k, v]) => (bonus[k] = (bonus[k] || 0) + v));
    });
    const attrs = draft ? draft : msl.attrs;
    const used = { basicos: 0, sociais: 0, magicos: 0 };
    if (draft) {
      attrDefs.forEach((a) => {
        used[poolKeyOfAttr(a.key)] += draft[a.key] - msl.attrs[a.key];
      });
    }
    const poolLeft = { basicos: msl.pool.basicos - used.basicos, sociais: msl.pool.sociais - used.sociais, magicos: msl.pool.magicos - used.magicos };
    const view = { attrs, bonus, poolLeft };
    const canDraft = isOwner() && !isMaster && msl.pool.basicos + msl.pool.sociais + (msl.noMagic ? 0 : msl.pool.magicos) > 0;
    const sumOf = (g) => byGroupSum(g, attrs);
    const pool = (k, g) => `<span class="msl-pool" title="soma dos pontos já colocados nos atributos do grupo">total usado <b>${sumOf(g)}</b></span><span class="msl-pool" title="pontos que ainda dá pra distribuir">sobram <b>${poolLeft[k]}</b></span>`;
    const byGroup = (g) => attrDefs.filter((a) => a.group === g);
    return `
      <div class="msl-attr-top">
        <button type="button" class="btn btn-ghost" data-act="toggle-help" title="mostra, em cada atributo, o que ele faz">${showHelp ? 'ocultar' : 'mostrar'} descrições</button>
        <button type="button" class="btn btn-ghost" data-act="toggle-temp">${showTemp ? 'ocultar' : 'mostrar'} modificadores temporários</button>
        ${isMaster ? '<span class="ficha-master-badge">edição livre (mestre)</span>' : ''}
      </div>
      ${creationGuideHtml(msl, poolLeft)}
      ${
        canDraft && !draft
          ? `<div class="msl-pointsbar"><span>Você tem pontos pra distribuir:</span>${poolBadges(msl.pool)}<button type="button" class="btn" data-act="draft-start">distribuir pontos</button></div>`
          : ''
      }
      ${draft ? `<div class="msl-pointsbar"><span>Pontos restantes:</span>${poolBadges(poolLeft)}<button type="button" class="btn" data-act="draft-confirm" ${Object.values(poolLeft).some((v) => v < 0) ? 'disabled' : ''}>confirmar</button><button type="button" class="btn btn-ghost" data-act="draft-cancel">cancelar</button></div>` : ''}
      ${isMaster ? `<div class="msl-pointsbar"><span>Pontos disponíveis (jogador):</span>${poolInputs(msl.pool)}<span class="msl-sep"></span><span>graus de perícia:</span><input type="number" min="0" class="msl-pool-input" data-skillgrades value="${msl.skillGrades}"></div>` : ''}

      <section class="msl-asection">
        <div class="msl-asection-head"><h3>📊 Atributos básicos</h3>${pool('basicos', 'basico')}</div>
        <div class="msl-ablocks">
          ${BASIC_SUBGROUPS.map((sg) => attrBlock(sg.label, sg.icon, sg.color, byGroup('basico').filter((a) => a.sub === sg.id), msl, view, 'short')).join('')}
        </div>
      </section>
      <div class="msl-asection-pair">
        <section class="msl-asection">
          <div class="msl-asection-head"><h3>🗣️ Atributos sociais</h3>${pool('sociais', 'social')}</div>
          <div class="msl-ablocks msl-ablocks-one">${attrBlock('Sociais', '🗣️', '#e879f9', byGroup('social'), msl, view, 'label')}</div>
        </section>
        ${msl.noMagic ? '' : `<section class="msl-asection">
          <div class="msl-asection-head"><h3>✨ Atributos mágicos</h3>${pool('magicos', 'magico')}</div>
          <div class="msl-ablocks msl-ablocks-one">${attrBlock('Mágicos', '🔮', '#a78bfa', byGroup('magico'), msl, view, 'label')}</div>
        </section>`}
      </div>`;
  }
  const byGroupSum = (g, attrs) => attrDefs.filter((a) => a.group === g).reduce((s, a) => s + (attrs[a.key] || 0), 0);

  // passo a passo do "Como criar sua ficha" (Ficha-Guia), com o que já foi feito
  function creationGuideHtml(msl, poolLeft) {
    if (msl.done) return '';
    const pv = pvSummary(msl);
    const left = poolLeft.basicos + poolLeft.sociais + (msl.noMagic ? 0 : poolLeft.magicos);
    const steps = [
      [left <= 0, '1. Atributos', left <= 0 ? 'todos os pontos distribuídos' + (msl.noMagic ? ' (sem magia por enquanto: os mágicos não contam)' : '') : 'faltam ' + poolLeft.basicos + ' básicos · ' + poolLeft.sociais + ' sociais' + (msl.noMagic ? '' : ' · ' + poolLeft.magicos + ' mágicos') + ' (pontos de um grupo não passam pro outro)'],
      [true, '2. Status', 'calculados sozinhos pelas fórmulas (barras e quadros acima)'],
      [msl.skillGrades <= 0, '3. Perícias', msl.skillGrades <= 0 ? 'os 4 graus foram usados' : 'faltam ' + msl.skillGrades + ' de ' + 4 + ' graus (básico custa 1, treinado 2; ninguém começa como mestre)'],
      [pv.left >= 0 && pv.rawGained <= 8 && msl.perksConfirmed, '4. Vantagens e desvantagens', 'PV ganhos ' + pv.gained + ' (máx. 8, não precisa chegar) · gastos ' + pv.spent + ' · sobra ' + pv.left + (msl.perksConfirmed ? ' · 🔒 confirmadas' : ' — falta CONFIRMAR na aba Traços (PV que não usar é perdido)')],
      [msl.sanidade >= 100 || true, '5. Sanidade', 'começa em 100'],
      [true, '6. Nível', 'nível 1, 0 de XP (sobe com XP do mestre)'],
    ];
    return '<div class="msl-guide"><div class="msl-guide-head"><b>📋 Como criar sua ficha</b><span class="msl-hint">siga os passos; quando todos estiverem ✔, aparece o botão de concluir a criação (também fica na aba Notas)</span></div>' +
      steps.map(([ok, t, d]) => '<div class="msl-guide-step ' + (ok ? 'ok' : '') + '"><span>' + (ok ? '✔' : '○') + '</span><b>' + t + '</b><small>' + escapeHtml(d) + '</small></div>').join('') +
      (steps.every((st) => st[0]) && (isOwner() || isMaster)
        ? '<div class="msl-guide-done"><span>Tudo pronto! Falta só concluir a criação.</span><button type="button" class="btn" data-act="finish-creation" title="tira o aviso de em criação; depois só o mestre altera vantagens, desvantagens e escola">✔ concluir a criação do personagem</button></div>'
        : '') +
      '</div>';
  }

  function poolBadges(pool) {
    return `<span class="msl-pool">básicos <b>${pool.basicos}</b></span><span class="msl-pool">sociais <b>${pool.sociais}</b></span><span class="msl-pool">mágicos <b>${pool.magicos}</b></span>`;
  }
  function poolInputs(pool) {
    return ['basicos', 'sociais', 'magicos']
      .map((k) => `<label class="msl-pool">${k} <input type="number" min="0" class="msl-pool-input" data-pool="${k}" value="${pool[k]}"></label>`)
      .join('');
  }

  // ---------------------------------------------------------------- aba: perícias
  function skillsTab(msl) {
    const maxGrade = isMaster ? 3 : msl.done ? 3 : 2;
    const editSkills = isMaster || (isOwner() && (inCreation() || msl.skillGrades > 0));
    const group = (g) => `
      <div class="msl-group-title">${g}</div>
      ${SKILLS.filter((s) => s.group === g)
        .map((s) => {
          const grade = skillGrade(msl, s.id);
          const ad = attrDef(s.attr);
          const mod = skillMod2(s.id);
          return `
          <div class="msl-skill">
            <div class="msl-skill-name">${escapeHtml(s.name)}${s.hint ? `<small> — ${escapeHtml(s.hint)}</small>` : ''}${s.custom ? `<input type="text" class="msl-inline" data-field="oficio" placeholder="qual ofício?" value="${escapeHtml(msl.oficio)}">` : ''}</div>
            <div class="msl-skill-attr" title="${escapeHtml(ad.label)}">${ad.abbr}</div>
            <div class="msl-grades">
              ${[0, 1, 2, 3]
                .map((n) => {
                  const can = editSkills && n <= maxGrade && (isMaster || n <= grade || n - grade <= msl.skillGrades) && (isMaster || inCreation() || n >= grade);
                  return `<button type="button" class="${grade === n ? 'active' : ''}" data-skill="${s.id}" data-grade="${n}" ${can ? '' : 'disabled'} title="${SKILL_GRADE_LABEL[n]}${n ? ' (+' + skillBonus(n) + ')' : ''}">${n}</button>`;
                })
                .join('')}
            </div>
            <button type="button" class="msl-roll" data-roll-skill="${s.id}" title="rolar ${escapeHtml(s.name)} (${signed(mod)})">🎲 ${signed(mod)}</button>
          </div>`;
        })
        .join('')}`;
    return `
      <div class="ficha-section">
        <div class="ficha-section-head">
          <span class="ficha-section-title">PERÍCIAS</span>
          <span class="msl-pool">graus pra gastar <b>${msl.skillGrades}</b></span><span class="msl-pool" title="soma dos graus nas perícias">graus usados <b>${Object.values(msl.skills).reduce((s, g) => s + (parseInt(g, 10) || 0), 0)}</b></span>
          <span class="msl-hint">grau 1 = básico (+2) · 2 = treinado (+4) · 3 = mestre (+6)${!msl.done && !isMaster ? ' · na criação: no máximo treinado' : ''}</span>
        </div>
        ${SKILL_GROUPS.map(group).join('')}
        <div class="msl-group-title">Idiomas <small>(sem teste: sabe ou não sabe)</small></div>
        <div class="msl-tags">
          ${msl.idiomas.map((l, i) => `<span class="msl-tag">${escapeHtml(l)}${canEdit() ? `<button type="button" data-del-lang="${i}">×</button>` : ''}</span>`).join('') || '<span class="msl-hint">nenhum idioma</span>'}
          ${canEdit() ? `<input type="text" class="msl-inline" id="msl-lang-input" placeholder="novo idioma + Enter">` : ''}
        </div>
      </div>`;
  }
  const skillMod2 = (id) => {
    const m = derive(sheet).exaustaoPenalidade;
    return testMod(sheet, SKILLS.find((s) => s.id === id).attr, id) + m;
  };

  // ---------------------------------------------------------------- aba: traços (vantagens, desvantagens, talentos, traumas)
  function perkOptions(list, taken) {
    const lvls = [1, 2, 3];
    return lvls
      .map(
        (n) =>
          `<optgroup label="Nível ${n} (${n} PV)">${list
            .filter((p) => p.level === n && !taken.includes(p.id))
            .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}${p.kind ? ' [' + p.kind + ']' : ''}</option>`)
            .join('')}</optgroup>`
      )
      .join('');
  }
  function perkRow(e, def, kind) {
    if (!def) return '';
    return `
      <div class="msl-perk">
        <div class="msl-perk-head"><b>${escapeHtml(def.name)}</b><span class="msl-lvl">nív ${def.level}</span>${canEditTraits() ? `<button type="button" class="msl-x" data-del-${kind}="${e.id}">×</button>` : ''}</div>
        <div class="msl-perk-text">${escapeHtml(def.text)}</div>
        ${def.choice ? `<input type="text" class="msl-inline" data-perk-note="${kind}:${e.id}" placeholder="${escapeHtml(def.choice)}…" value="${escapeHtml(e.note || '')}" ${canEditTraits() ? '' : 'disabled'}>` : ''}
      </div>`;
  }
  // ---- seletor visual de vantagens/desvantagens: cartões com o texto inteiro, filtro por nível e busca ----
  function perkPickerHtml(msl, pv) {
    const kind = perkPicker; // 'adv' | 'dis'
    const isAdv = kind === 'adv';
    const list = isAdv ? ADVANTAGES : DISADVANTAGES;
    const taken = (isAdv ? msl.advantages : msl.disadvantages).map((e) => e.id);
    const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const f = perkFilter;
    const rows = list.filter((p) => (!f.level || String(p.level) === String(f.level)) && (!f.text || norm(p.name + ' ' + p.text + ' ' + (p.kind || '')).includes(norm(f.text))));
    const creating = !msl.done && !isMaster;
    const card = (p) => {
      const has = taken.includes(p.id);
      let blocked = '';
      if (has) blocked = 'já está na ficha';
      else if (creating && isAdv && p.level > pv.left) blocked = `faltam PV: custa ${p.level}, você tem ${Math.max(0, pv.left)} — pegue desvantagens primeiro`;
      else if (creating && !isAdv && pv.rawGained + p.level > DISADVANTAGE_PV_MAX) blocked = `passaria de ${DISADVANTAGE_PV_MAX} PV de desvantagens`;
      else if (creating && isAdv && p.level === 3 && pv.lvl3adv >= 1) blocked = 'jogador só pode ter uma vantagem de nível 3 (o mestre pode liberar mais)';
      return `
        <div class="msl-pcard lvl${p.level} ${has ? 'has' : ''} ${blocked && !has ? 'blocked' : ''}">
          <div class="msl-pcard-head">
            <b>${escapeHtml(p.name)}</b>
            ${p.kind ? `<span class="msl-pkind ${p.kind === 'Mágica' ? 'magic' : ''}">${p.kind}</span>` : ''}
            <span class="msl-pcost">${isAdv ? 'custa' : 'dá'} ${p.level} PV</span>
          </div>
          <div class="msl-pcard-text">${escapeHtml(p.text)}</div>
          ${p.choice ? `<div class="msl-pcard-choice">você escolhe: ${escapeHtml(p.choice)}</div>` : ''}
          <div class="msl-pcard-foot">
            ${has ? '<span class="msl-hint">✔ já na ficha</span>' : `<button type="button" class="btn ${blocked ? 'btn-ghost' : ''}" data-perk-add="${kind}:${p.id}" ${blocked ? 'disabled' : ''} title="${escapeHtml(blocked)}">${isAdv ? 'pegar vantagem' : 'pegar desvantagem'}</button>`}
            ${blocked && !has ? `<small class="msl-pblock">${escapeHtml(blocked)}</small>` : ''}
          </div>
        </div>`;
    };
    return `
      <div class="msl-picker ${isAdv ? 'adv' : 'dis'}">
        <div class="msl-picker-head">
          <h4>${isAdv ? '✨ Escolher vantagem' : '⚠️ Escolher desvantagem'}</h4>
          ${!msl.done ? `<span class="msl-pool">${isAdv ? `PV disponíveis <b>${Math.max(0, pv.left)}</b>` : `PV de desvantagens <b>${pv.gained}</b> <small>(máx. ${DISADVANTAGE_PV_MAX})</small>`}</span>` : ''}
          <button type="button" class="btn btn-ghost" data-act="perk-close">fechar ✕</button>
        </div>
        <div class="msl-picker-filters">
          <div class="msl-lvlchips">
            ${['', 1, 2, 3].map((n) => `<button type="button" class="${String(f.level) === String(n) ? 'active' : ''}" data-perkf-level="${n}">${n === '' ? 'todas' : 'nível ' + n + ' · ' + n + ' PV'}</button>`).join('')}
          </div>
          <input type="text" data-perkf-text placeholder="buscar pelo nome ou pelo que faz…" value="${escapeHtml(f.text)}">
        </div>
        <div class="msl-pcards">${rows.map(card).join('') || '<p class="msl-hint">nada encontrado</p>'}</div>
      </div>`;
  }

  function traitsTab(msl) {
    const pv = pvSummary(msl);
    const advTaken = msl.advantages.map((e) => e.id);
    const disTaken = msl.disadvantages.map((e) => e.id);
    const warn = [];
    if (!msl.done) {
      if (pv.rawGained > DISADVANTAGE_PV_MAX) warn.push(`desvantagens somam ${pv.rawGained} PV; só ${DISADVANTAGE_PV_MAX} contam`);
      if (pv.left < 0) warn.push(`você gastou ${-pv.left} PV a mais do que ganhou`);
      if (pv.lvl3adv > 1 && !isMaster) warn.push('só uma vantagem de nível 3 na criação');
    }
    return `
      <div class="ficha-section">
        <div class="ficha-section-head">
          <span class="ficha-section-title">VANTAGENS E DESVANTAGENS</span>
          ${!msl.done ? `<span class="msl-pool" title="as desvantagens dão no MÁXIMO ${DISADVANTAGE_PV_MAX} PV; não precisa chegar nesse valor">PV ganhos <b>${pv.gained}</b> <small>(máx. ${DISADVANTAGE_PV_MAX})</small></span><span class="msl-pool">gastos <b>${pv.spent}</b></span><span class="msl-pool ${pv.left < 0 ? 'bad' : ''}">sobra <b>${pv.left}</b></span>` : ''}
          ${msl.perksConfirmed ? `<span class="msl-pool msl-locked" title="as vantagens e desvantagens foram confirmadas">🔒 confirmadas</span>` : ''}
          ${isMaster && msl.perksConfirmed ? `<button type="button" class="btn btn-ghost" data-act="perks-unlock" title="deixa o jogador editar de novo">🔓 destrancar</button>` : ''}
          ${isOwner() && !isMaster && !msl.done && !msl.perksConfirmed ? `<button type="button" class="btn" data-act="perks-confirm" title="tranca as vantagens e desvantagens: depois só o mestre consegue mudar">✔ confirmar vantagens e desvantagens</button>` : ''}
        </div>
        ${warn.length ? `<p class="admin-error" style="display:block;">${warn.map(escapeHtml).join(' · ')}</p>` : ''}
        ${perkPicker && canEditTraits() ? perkPickerHtml(msl, pv) : ''}
        <div class="msl-twocol">
          <div>
            <div class="msl-group-title">Vantagens</div>
            ${msl.advantages.map((e) => perkRow(e, advantageById(e.id), 'adv')).join('') || '<p class="msl-hint">nenhuma</p>'}
            ${canEditTraits() ? `<button type="button" class="btn msl-pick-btn" data-act="perk-open" data-kind="adv">✨ escolher vantagem…</button>` : ''}
          </div>
          <div>
            <div class="msl-group-title">Desvantagens</div>
            ${msl.disadvantages.map((e) => perkRow(e, disadvantageById(e.id), 'dis')).join('') || '<p class="msl-hint">nenhuma</p>'}
            ${canEditTraits() ? `<button type="button" class="btn msl-pick-btn" data-act="perk-open" data-kind="dis">⚠️ escolher desvantagem…</button>` : ''}
          </div>
        </div>
      </div>

      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">TALENTOS</span><span class="msl-hint">ações e reações exclusivas — vêm de vencer campanhas</span></div>
        ${msl.talents
          .map((id) => {
            const t = TALENTS.find((x) => x.id === id);
            return t ? `<div class="msl-perk"><div class="msl-perk-head"><b>${escapeHtml(t.name)}</b><span class="msl-lvl">${t.kind} · ${t.pa} PA</span>${isMaster ? `<button type="button" class="msl-x" data-del-talent="${id}">×</button>` : ''}</div><div class="msl-perk-text">${escapeHtml(t.text)}</div></div>` : '';
          })
          .join('') || '<p class="msl-hint">nenhum talento ainda</p>'}
        ${isMaster ? `<div class="msl-add"><select id="msl-talent-select"><option value="">+ talento…</option>${TALENTS.filter((t) => !msl.talents.includes(t.id)).map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}</select><button type="button" class="btn btn-ghost" data-act="add-talent">dar talento</button></div>` : ''}
      </div>

      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">SANIDADE E TRAUMAS</span><span class="msl-hint">${escapeHtml(sanityStage(msl.sanidade).label)}</span></div>
        <div class="msl-sanity">
          ${SANITY_LOSS.map((s) => `<button type="button" class="btn btn-ghost" data-sanity="${s.id}" title="perda ${s.dice[0]}d${s.dice[1]}; teste de Autocontrole ≥ ${s.dc} perde metade">${s.label} (${s.dice[0]}d${s.dice[1]}, CD ${s.dc})</button>`).join('')}
        </div>
        ${msl.traumas.map((t, i) => `<div class="msl-perk"><div class="msl-perk-head"><b>${escapeHtml(t.name)}</b>${canEdit() ? `<button type="button" class="msl-x" data-del-trauma="${i}">×</button>` : ''}</div><div class="msl-perk-text">${escapeHtml(t.text)}</div></div>`).join('')}
        ${canEdit() ? `<button type="button" class="btn btn-ghost" data-act="roll-trauma">🎲 sortear trauma (d8)</button>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------- aba: magias
  // ---------------------------------------------------------------- magias personalizadas, cálculo automático e fórmulas
  async function refreshCustomSpells() {
    try {
      customSpells = await listCustomSpells(campaign.id);
    } catch (_) {
      customSpells = []; // tabela ainda não criada / sem permissão: fica só com as do livro
    }
  }
  const familyOf = () => (mslOf(sheet).family || '').trim().toLowerCase();
  // magias do livro + as personalizadas que este personagem pode ver (família: só a dele; o mestre vê todas)
  async function allSpells() {
    const base = await loadSpells();
    const fam = familyOf();
    const extra = customSpells.filter((s) => {
      if (s.privateTo) return s.privateTo === sheet.id; // pessoal: só do personagem dono (nem o mestre vê as dos outros aqui)
      return !s.familia || isMaster || s.familia.trim().toLowerCase() === fam;
    });
    return [...base, ...extra];
  }

  // caixa "calculado pra você": escalamentos do livro e fórmulas da magia, já com os atributos desta ficha
  function computedBoxHtml(s) {
    if (!(s.escalamentos || []).length && !(s.calc || []).length) return '';
    const calc = computeSpell(s, sheet, sheet.level);
    const rows = calc.rows
      .map((r) => {
        const head = r.attr ? `<b>${escapeHtml(r.attr)}</b> <span class="msl-calc-val">${r.value}</span>` : `<b>${escapeHtml(r.label || '')}</b>`;
        const how = r.formulaText ? `<small>${escapeHtml(r.formulaText)}</small>` : r.every ? `<small>a cada ${r.every} pontos</small>` : '';
        return `<li class="${r.active ? 'on' : 'off'}">${head} → <span class="msl-calc-out">${escapeHtml(r.text)}</span> ${how}</li>`;
      })
      .join('');
    const totals = calc.totals.map((t) => `<div class="msl-calc-total"><b>${escapeHtml(t.label)}</b><span>${escapeHtml(t.text)}</span><small>${escapeHtml(t.note || '')}</small></div>`).join('');
    return `
      <div class="msl-calc">
        <div class="msl-calc-head">📐 Calculado pra ${escapeHtml(sheet.name)} <small>com os atributos desta ficha${calc.dc ? ` · dificuldade pra resistir <b>${calc.dc}</b>` : ''}</small></div>
        ${totals ? `<div class="msl-calc-totals">${totals}</div>` : ''}
        <ul class="msl-calc-list">${rows}</ul>
        ${calc.errors.length ? `<p class="admin-error" style="display:block;">${calc.errors.map(escapeHtml).join(' · ')}</p>` : ''}
      </div>`;
  }

  // ---- editor de magia personalizada (só mestre) ----
  const blankSpell = () => ({
    dbId: null,
    family: '',
    nome: '',
    escola: '',
    estilo: '',
    nivel: 1,
    classificacao: 'Livre',
    descricao: '',
    atributo_principal: 'Poder Mágico',
    ativacao: 'instantânea, ação, 2 PA',
    alvo: '',
    resistencia: '',
    efeito: '',
    custo_mp: 1,
    manutencao: '',
    sustentada: false,
    rastro: 'Efêmero',
    base: { dano: '', alcance: '', raio: '', duracao: '' },
    calc: [{ label: 'Alcance', type: 'valor', formula: 'ARM * 2', sides: 6, unit: 'm de alcance', attr: 'armazenamento', every: 10, amount: 1 }],
  });
  function startEditor(spell) {
    if (!spell) spellEditor = blankSpell();
    else spellEditor = { ...blankSpell(), ...JSON.parse(JSON.stringify(spell)), dbId: spell.dbId || null, family: spell.familia || '', base: { dano: '', alcance: '', raio: '', duracao: '', ...(spell.base || {}) }, calc: (spell.calc || []).map((r) => ({ ...r })) };
    helpOpen = false;
    render();
    const box = $('msl-editor');
    if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  const ATTR_OPTS = (sel) => attrDefs.map((a) => `<option value="${a.key}" ${sel === a.key ? 'selected' : ''}>${a.label}</option>`).join('');
  const ATTR_LABEL_OPTS = (sel) => attrDefs.filter((a) => a.group !== 'social').map((a) => `<option ${sel === a.label ? 'selected' : ''}>${a.label}</option>`).join('');

  function editorPreviewHtml() {
    if (!spellEditor) return '';
    let spell;
    try {
      spell = normalizeCustomSpell(spellEditor);
    } catch (err) {
      return `<p class="admin-error" style="display:block;">${escapeHtml(err.message)}</p>`;
    }
    const calc = computeSpell(spell, sheet, sheet.level);
    return `
      <div class="msl-calc-head">👁 Prévia com os atributos de ${escapeHtml(sheet.name)}${calc.dc ? ` · dificuldade <b>${calc.dc}</b>` : ''}</div>
      ${calc.rows.length ? `<ul class="msl-calc-list">${calc.rows.map((r) => `<li class="${r.active ? 'on' : 'off'}"><b>${escapeHtml(r.label || r.attr || '')}</b> → <span class="msl-calc-out">${escapeHtml(r.text)}</span> ${r.formulaText ? `<small>${escapeHtml(r.formulaText)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="msl-hint">adicione linhas de cálculo abaixo</p>'}
      ${calc.errors.length ? `<p class="admin-error" style="display:block;">${calc.errors.map(escapeHtml).join(' · ')}</p>` : ''}`;
  }

  function helpHtml() {
    const rows = variableTable(sheet, sheet.level);
    const groups = [['basico', 'Básicos'], ['social', 'Sociais'], ['magico', 'Mágicos'], ['status', 'Status']];
    return `
      <div class="msl-help">
        <div class="msl-help-head"><b>? Siglas pra usar nas fórmulas</b><span class="msl-hint">clique numa sigla pra inserir no campo de fórmula que você estava editando. O valor ao lado é o de ${escapeHtml(sheet.name)} (com bônus de vantagens e modificadores temporários).</span><button type="button" class="btn btn-ghost" data-act="ed-help">fechar</button></div>
        <div class="msl-help-grid">
          ${groups
            .map(
              ([g, label]) => `
            <div class="msl-help-col"><div class="msl-group-title">${label}</div>
              ${rows
                .filter((r) => r.group === g)
                .map((r) => `<button type="button" class="msl-help-var" data-ed-insert="${r.abbr}" title="${escapeHtml(r.name)}${r.aliases.length ? ' — também vale: ' + r.aliases.join(', ') : ''}"><code>${r.abbr}</code><span>${escapeHtml(r.name)}</span><b>${r.value ?? '—'}</b></button>`)
                .join('')}
            </div>`
            )
            .join('')}
        </div>
        <ul class="msl-list msl-help-tips">
          <li>Operações: <code>+</code> <code>−</code> <code>×</code> (ou <code>x</code> ou <code>*</code>) <code>÷</code> (ou <code>/</code>) e parênteses. Divisão arredonda pra baixo, como no livro.</li>
          <li>Também dá pra escrever o nome inteiro: <code>Armazenamento × 2</code>, <code>Interpretação ÷ 4</code>. Funções: <code>MIN(a, b)</code> e <code>MAX(a, b)</code>.</li>
          <li>Exemplos: <code>ARM × 2</code> = alcance de 2 m por ponto de Armazenamento · <code>5 + CAN ÷ 2</code> · <code>(MOL + CTR) ÷ 10</code> dados de dano.</li>
          <li>Tipos de linha: <b>valor</b> (a fórmula dá um número + unidade), <b>dados</b> (a fórmula dá quantos dados de N lados) e <b>passos</b> (como no livro: "+X a cada N pontos do atributo").</li>
        </ul>
      </div>`;
  }

  function editorHtml() {
    const e = spellEditor;
    const f = (k, label, type = 'text', extra = '') => `<label>${label}<input type="${type}" data-ed="${k}" value="${escapeHtml(e[k] ?? '')}" ${extra}></label>`;
    return `
      <div class="ficha-section msl-editor" id="msl-editor">
        <div class="ficha-section-head">
          <span class="ficha-section-title">${e.dbId ? 'EDITAR MAGIA PERSONALIZADA' : 'NOVA MAGIA PERSONALIZADA'}</span>
          <button type="button" class="btn btn-ghost" data-act="ed-cancel">cancelar</button>
        </div>
        <div class="msl-ed-grid">
          ${f('nome', 'Nome')}
          <label>Escola<select data-ed="escola"><option value="">—</option>${SCHOOLS.map((s) => `<option ${e.escola === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          ${f('estilo', 'Estilo')}
          <label>Nível<select data-ed="nivel">${[1, 2, 3, 4, 5].map((n) => `<option ${Number(e.nivel) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Classificação<select data-ed="classificacao">${['Livre', 'Uso específico', 'Restrita', 'Autorização Especial', 'Proibida'].map((c) => `<option ${e.classificacao === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Atributo principal<select data-ed="atributo_principal">${ATTR_LABEL_OPTS(e.atributo_principal)}</select></label>
          ${f('custo_mp', 'Custo (MP)', 'number', 'min="0"')}
          ${f('manutencao', 'Manutenção (MP/turno)', 'number', 'min="0"')}
          <label class="msl-check"><input type="checkbox" data-ed="sustentada" ${e.sustentada ? 'checked' : ''}> sustentada</label>
          <label>Rastro<select data-ed="rastro">${['Efêmero', 'Instável', 'Persistente', 'Marcante'].map((c) => `<option ${e.rastro === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          ${f('ativacao', 'Ativação')}
          ${f('alvo', 'Alvo')}
          ${f('resistencia', 'Resistência')}
          ${isMaster ? `<label class="msl-ed-wide">Família (deixe vazio = qualquer um pode aprender)<input type="text" data-ed="family" value="${escapeHtml(e.family)}" placeholder="ex.: Lunaris — só personagens dessa família veem e aprendem"></label>` : `<p class="msl-hint msl-ed-wide">✚ Esta magia fica só no seu personagem (o mestre também vê).</p>`}
        </div>
        <label class="msl-ed-block">Descrição curta<input type="text" data-ed="descricao" value="${escapeHtml(e.descricao)}"></label>
        <div class="msl-ed-bases"><span class="msl-hint">Valores base (opcional — os cálculos abaixo SOMAM com eles no total):</span>
          <label>dano<input type="text" data-ed-base="dano" value="${escapeHtml(e.base.dano)}" placeholder="1d6+2"></label>
          <label>alcance (m)<input type="number" data-ed-base="alcance" value="${escapeHtml(e.base.alcance)}"></label>
          <label>raio (m)<input type="number" data-ed-base="raio" value="${escapeHtml(e.base.raio)}"></label>
          <label>duração (turnos)<input type="number" data-ed-base="duracao" value="${escapeHtml(e.base.duracao)}"></label>
        </div>
        <label class="msl-ed-block">Efeito (texto)<textarea data-ed="efeito" rows="3" placeholder="o que a magia faz; cite os valores calculados pelas linhas abaixo">${escapeHtml(e.efeito)}</textarea></label>

        <div class="msl-ed-calc">
          <div class="msl-ed-calc-head">
            <b>📐 Cálculos automáticos</b>
            <button type="button" class="msl-q" data-act="ed-help" title="ver as siglas dos atributos e status">?</button>
            <span class="msl-hint">ex.: <code>ARM × 2</code> = alcance — o valor é calculado com a ficha de quem conjura</span>
          </div>
          ${helpOpen ? helpHtml() : ''}
          ${e.calc
            .map((r, i) => {
              const t = r.type || 'valor';
              const common = `<input type="text" class="msl-ed-label" data-ed-row="${i}:label" value="${escapeHtml(r.label || '')}" placeholder="nome (Alcance, Dano, Duração...)">`;
              const unit = `<input type="text" data-ed-row="${i}:unit" value="${escapeHtml(r.unit || '')}" placeholder="unidade (m de alcance, de dano, turnos...)">`;
              const body =
                t === 'passos'
                  ? `<span>+</span><input type="number" step="any" class="msl-ed-num" data-ed-row="${i}:amount" value="${r.amount ?? 1}"><span>a cada</span><input type="number" min="1" class="msl-ed-num" data-ed-row="${i}:every" value="${r.every ?? 10}"><span>pontos de</span><select data-ed-row="${i}:attr">${ATTR_OPTS(r.attr)}</select>${unit}`
                  : `<input type="text" class="msl-ed-formula" data-ed-row="${i}:formula" value="${escapeHtml(r.formula || '')}" placeholder="fórmula: ARM × 2">${t === 'dados' ? `<span>d</span><input type="number" min="2" class="msl-ed-num" data-ed-row="${i}:sides" value="${r.sides ?? 6}">` : ''}${unit}`;
              return `<div class="msl-ed-row">${common}<select data-ed-row="${i}:type"><option value="valor" ${t === 'valor' ? 'selected' : ''}>valor</option><option value="dados" ${t === 'dados' ? 'selected' : ''}>dados</option><option value="passos" ${t === 'passos' ? 'selected' : ''}>passos (+X a cada N)</option></select><div class="msl-ed-rowbody">${body}</div><button type="button" class="msl-x" data-act="ed-del-row" data-i="${i}" title="remover linha">×</button></div>`;
            })
            .join('')}
          <button type="button" class="btn btn-ghost" data-act="ed-add-row">+ linha de cálculo</button>
          <div class="msl-ed-preview" id="msl-ed-preview">${editorPreviewHtml()}</div>
        </div>
        ${edError ? `<p class="admin-error" style="display:block;">${escapeHtml(edError)}</p>` : ''}
        <div class="msl-ed-actions">
          <button type="button" class="btn" data-act="ed-save">${e.dbId ? 'salvar alterações' : 'criar magia'}</button>
          <button type="button" class="btn btn-ghost" data-act="ed-cancel">cancelar</button>
        </div>
      </div>`;
  }

  async function saveEditor() {
    edError = '';
    try {
      const wasEditing = !!spellEditor.dbId;
      await saveCustomSpell(campaign.id, spellEditor, isMaster ? spellEditor.family : '', spellEditor.dbId, { userId: session.user.id, privateTo: isMaster ? null : sheet.id });
      await refreshCustomSpells();
      spellEditor = null;
      spellMsg = wasEditing ? 'Magia atualizada.' : isMaster ? 'Magia criada! Já aparece no grimório (se tiver família, só quem é dela a vê).' : 'Magia criada! Ela é só do seu personagem — procure no grimório (+ aprender magia).';
    } catch (err) {
      edError = err.message;
    }
    render();
  }

  // ---------------------------------------------------------------- magias ATIVAS: sustentadas, formas e invocações
  // Manutenção (vagas) = magias sustentadas + criaturas invocadas; Formas (vagas) = estruturas, armas e terrenos moldados.
  // Sustentada paga a manutenção a CADA turno (padrão 1 MP); forma não paga manutenção; invocação custa MP = tier por turno.
  const KIND = {
    sustentada: { icon: '🔁', label: 'sustentada' },
    forma: { icon: '🗿', label: 'forma' },
    invocacao: { icon: '🐾', label: 'invocação' },
  };
  function slotsUsed(msl) {
    return msl.active.reduce((a, e) => ({ m: a.m + (e.manut || 0), f: a.f + (e.formas || 0), mp: a.mp + (e.upkeep || 0) }), { m: 0, f: 0, mp: 0 });
  }
  const newId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // quantas vagas de Formas a magia ocupa (0 = não é uma forma): texto "Ocupa N vagas" ou estilo Construções/Armamento/Terreno
  function formasSlots(s) {
    const ef = String(s.efeito || '');
    const m = /Ocupa\s+(\d+)\s+vagas?\s+de\s+Formas/i.exec(ef);
    if (m) return parseInt(m[1], 10);
    if (/vaga de Formas/i.test(ef)) return 1;
    if (s.escola === 'Mágica' && ['Construções', 'Armamento', 'Terreno'].includes(s.estilo)) return 1;
    return 0;
  }
  function durationTurns(s) {
    const m = /Dura[çc][ãa]o\s+(\d+)\s+turnos?/i.exec(String(s.efeito || '')) || /por\s+(\d+)\s+turnos?/i.exec(String(s.efeito || ''));
    return m ? parseInt(m[1], 10) : null;
  }

  function activePanelHtml(msl, d) {
    const u = slotsUsed(msl);
    const pill = (label, used, max, tip) => `<span class="msl-stat ${used > max ? 'over' : ''}" title="${escapeHtml(tip)}"><b>${used}/${max}</b>${label}</span>`;
    const vinc = msl.active.filter((e) => e.kind === 'invocacao').length;
    return `
      <div class="ficha-section msl-active">
        <div class="ficha-section-head">
          <span class="ficha-section-title">MAGIAS ATIVAS</span>
          <div class="msl-active-pills">
            ${pill('Manutenção', u.m, d.manutencao, 'vagas de magias sustentadas e criaturas invocadas')}
            ${pill('Formas', u.f, d.formas, 'vagas de estruturas, armas e terrenos moldados')}
            ${pill('Vínculos', vinc, d.decifracao, 'criaturas vinculadas ao mesmo tempo (máx. = Decifração)')}
            <span class="msl-stat" title="MP de manutenção que sai todo turno"><b>${u.mp}</b>MP/turno</span>
          </div>
        </div>
        ${
          msl.active.length
            ? msl.active
                .map((e) => {
                  const k = KIND[e.kind] || KIND.sustentada;
                  const bits = [
                    e.manut ? `${e.manut} vaga de Manutenção` : '',
                    e.formas ? `${e.formas} vaga(s) de Formas` : '',
                    e.upkeep ? `${e.upkeep} MP por turno` : 'sem custo de manutenção',
                    e.turns !== null && e.turns !== undefined ? `${e.turns} turno(s) restantes` : '',
                    e.kind === 'invocacao' ? `tier ${e.tier} · age logo depois de você` : '',
                  ].filter(Boolean);
                  return `
          <div class="msl-act-item ${e.kind}">
            <span class="msl-act-ico">${k.icon}</span>
            <div class="msl-act-main"><b>${escapeHtml(e.name)}</b><small>${escapeHtml(k.label)} — ${bits.map(escapeHtml).join(' · ')}</small>${e.note ? `<small class="msl-act-note">${escapeHtml(e.note)}</small>` : ''}</div>
            ${e.kind === 'invocacao' && canEdit() ? `<button type="button" class="btn btn-ghost" data-act-ctrl="${e.id}" title="teste de controle: Interpretação contra CD 10 + 2 × tier">🎲 controle (CD ${10 + 2 * (e.tier || 1)})</button>` : ''}
            ${canEdit() ? `<button type="button" class="msl-x" data-act-del="${e.id}" title="encerrar">✕</button>` : ''}
          </div>`;
                })
                .join('')
            : '<p class="msl-hint">nada ativo. Conjurar uma magia sustentada ou moldada registra aqui sozinho (você confirma).</p>'
        }
        ${
          canEdit()
            ? `<div class="msl-act-btns">
          <button type="button" class="btn btn-ghost" data-act="act-add-forma" title="estrutura, arma ou terreno moldado, ou âncora de maldição de gatilho: ocupa vaga de Formas">+ forma / âncora</button>
          <button type="button" class="btn btn-ghost" data-act="act-add-inv" title="criatura invocada: ocupa 1 vaga de Manutenção e custa MP = tier por turno">+ invocar criatura</button>
          <button type="button" class="btn" data-act="new-turn" title="novo turno: paga a manutenção de tudo que está ativo, desconta a duração e zera o Fluxo">↺ novo turno</button>
        </div>
        <p class="msl-hint">Pontuais gastam MP uma vez. "Novo turno" cobra a manutenção (conta no Fluxo); se faltar MP, as últimas magias da lista se encerram.</p>`
            : ''
        }
      </div>`;
  }

  // novo turno: cobra a manutenção, conta a duração, encerra o que acabou ou não pôde ser pago e zera o Fluxo (a manutenção já conta nele)
  async function newTurn() {
    const r = upkeepTurn(sheet);
    spellMsg = `Novo turno: manutenção ${r.paid} MP${r.before ? ` · ${r.active.length}/${r.before} continuam ativas` : ''}${r.lines.length ? ' · ' + r.lines.join('; ') : ''}.`;
    await commit((m) => {
      m.active = r.active;
      m.mp = r.mp;
      m.fluxoUsed = r.paid;
    });
  }

  async function addForma() {
    const name = window.prompt('Nome da forma (ex.: Parede de pedra, Lança de gelo, âncora da maldição):');
    if (!name || !name.trim()) return;
    const n = Math.max(1, parseInt(window.prompt('Quantas vagas de Formas ela ocupa?', '1'), 10) || 1);
    const msl = mslOf(sheet);
    const d = derive(sheet);
    if (slotsUsed(msl).f + n > d.formas && !window.confirm(`Você só tem ${d.formas} vaga(s) de Formas (já usa ${slotsUsed(msl).f}). Registrar mesmo assim?`)) return;
    const turns = parseInt(window.prompt('Duração em turnos (deixe vazio = até encerrar):', ''), 10);
    await commit((m) => m.active.push({ id: newId(), kind: 'forma', name: name.trim().slice(0, 60), manut: 0, formas: n, upkeep: 0, tier: null, turns: Number.isFinite(turns) && turns > 0 ? turns : null, note: '' }));
  }

  async function addInvocation() {
    const name = window.prompt('Nome da criatura invocada:');
    if (!name || !name.trim()) return;
    const tier = Math.min(5, Math.max(1, parseInt(window.prompt('Tier da criatura (1 a 5):', '1'), 10) || 1));
    const msl = mslOf(sheet);
    const d = derive(sheet);
    const u = slotsUsed(msl);
    const vinc = msl.active.filter((e) => e.kind === 'invocacao').length;
    const problems = [];
    if (tier > d.decifracao) problems.push(`tier ${tier} acima da sua Decifração (${d.decifracao}): você não consegue invocar nem comandar`);
    if (vinc + 1 > d.decifracao) problems.push(`vínculos ao mesmo tempo passariam da Decifração (${d.decifracao})`);
    if (u.m + 1 > d.manutencao) problems.push(`sem vaga de Manutenção (${u.m}/${d.manutencao})`);
    const curMp = msl.mp === null ? d.mpMax : msl.mp;
    if (curMp < tier) problems.push(`MP insuficiente pra manutenção (${tier} por turno)`);
    if (problems.length && !window.confirm('Atenção: ' + problems.join('; ') + '.\nRegistrar mesmo assim?')) return;
    await commit((m) => m.active.push({ id: newId(), kind: 'invocacao', name: name.trim().slice(0, 60), manut: 1, formas: 0, upkeep: tier, tier, turns: null, note: '' }));
  }

  async function controlTest(id) {
    const e = mslOf(sheet).active.find((x) => x.id === id);
    if (!e) return;
    const cd = 10 + 2 * (e.tier || 1);
    const mod = attrMod(sheet, 'interpretacao') + derive(sheet).exaustaoPenalidade;
    try {
      const row = await rollD20Test(campaign.id, session.user.id, rollerName(), mod, `Controle: ${e.name}`, rollMode, getHiddenRollMode() && isMaster);
      const ok = row.total >= cd;
      spellMsg = `Controle de ${e.name} (tier ${e.tier}): d20 ${row.kept} ${signed(mod)} = ${row.total} contra CD ${cd} → ${ok ? 'mantém o controle: a criatura obedece neste turno' : 'FALHOU: a criatura age sozinha neste turno'}.`;
    } catch (err) {
      spellMsg = 'não deu pra rolar: ' + err.message;
    }
    render();
  }

  function spellsTab(msl, d) {
    const known = msl.spells;
    const canEditSchool = canEditSetup();
    return `
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">ESCOLA E ELEMENTO</span></div>
        <div class="msl-school-row">
          <label>Escola básica <select data-field="school" ${canEditSchool ? '' : 'disabled'}><option value="">—</option>${SCHOOLS.map((s) => `<option ${msl.school === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Elemento (Mágica) <select data-field="element" ${canEditSchool ? '' : 'disabled'}><option value="">—</option>${ELEMENTS.map((s) => `<option ${msl.element === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <span class="msl-stat"><b>${msl.fluxoUsed || 0}/${d.fluxo}</b>Fluxo no turno${canEdit() ? ' <button type="button" data-act="new-turn" title="novo turno: zera o MP gasto">↺</button>' : ''}</span>
        </div>
        ${spellMsg ? `<div class="msl-lastroll">${escapeHtml(spellMsg)}</div>` : ''}
      </div>
      ${spellEditor && canCreateSpell() ? editorHtml() : ''}
      ${activePanelHtml(msl, d)}
      <div class="ficha-section">
        <div class="ficha-section-head">
          <span class="ficha-section-title">MAGIAS CONHECIDAS (${known.length})</span>
          ${canCreateSpell() ? '<button type="button" class="btn btn-ghost" data-act="ed-new" title="' + (isMaster ? 'cria uma magia da campanha (ou de uma família), com cálculos automáticos a partir da ficha' : 'cria uma magia só pro seu personagem, com cálculos automáticos a partir da ficha') + '">' + (isMaster ? '✚ criar magia' : '✚ criar minha magia') + '</button>' : ''}
          ${canEdit() ? `<button type="button" class="btn btn-ghost" data-act="spell-browser">${spellBrowserOpen ? 'fechar' : '+ aprender magia'}</button>` : ''}
        </div>
        <div id="msl-known-spells">${known.length ? '<p class="msl-hint">carregando magias...</p>' : '<p class="msl-hint">nenhuma magia conhecida ainda — use "+ aprender magia"</p>'}</div>
      </div>
      ${spellBrowserOpen ? '<div class="ficha-section" id="msl-spell-browser"></div>' : ''}`;
  }

  async function fillSpells() {
    const msl = mslOf(sheet);
    const list = await allSpells();
    const d = derive(sheet);
    const knownBox = $('msl-known-spells');
    if (knownBox && msl.spells.length) {
      knownBox.innerHTML = msl.spells
        .map((id) => list.find((s) => s.id === id))
        .filter(Boolean)
        .sort((a, b) => a.nivel - b.nivel || a.nome.localeCompare(b.nome))
        .map((s) => spellCard(s, msl, d, true))
        .join('');
    }
    const box = $('msl-spell-browser');
    if (box) {
      const f = spellFilter;
      const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const rows = list.filter(
        (s) =>
          (!f.school || s.escola === f.school) &&
          (!f.level || String(s.nivel) === String(f.level)) &&
          (!f.text || norm(s.nome + ' ' + s.estilo + ' ' + s.descricao).includes(norm(f.text))) &&
          (!f.learned || !msl.spells.includes(s.id)) &&
          (!f.source || (f.source === 'livro' ? !s.custom : f.source === 'custom' ? !!s.custom && !s.familia : !!s.familia))
      );
      box.innerHTML = `
        <div class="ficha-section-head"><span class="ficha-section-title">GRIMÓRIO — ${rows.length} magia(s)</span></div>
        <div class="msl-filters">
          <select data-spellf="school"><option value="">todas as escolas</option>${SCHOOLS.map((s) => `<option ${f.school === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <select data-spellf="level"><option value="">todos os níveis</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${String(f.level) === String(n) ? 'selected' : ''}>nível ${n}</option>`).join('')}</select>
          <input type="text" data-spellf="text" placeholder="buscar nome, estilo, descrição…" value="${escapeHtml(f.text)}">
          ${customSpells.length ? `<select data-spellf="source"><option value="">livro + personalizadas</option><option value="livro" ${f.source === 'livro' ? 'selected' : ''}>só as do livro</option><option value="custom" ${f.source === 'custom' ? 'selected' : ''}>personalizadas</option><option value="familia" ${f.source === 'familia' ? 'selected' : ''}>de família</option></select>` : ''}
          <label class="msl-check"><input type="checkbox" data-spellf="learned" ${f.learned ? 'checked' : ''}> esconder as que já sei</label>
        </div>
        <p class="msl-hint">Só dá pra aprender magia de nível ≤ sua Decifração (${d.decifracao}). Magias de família só aparecem pra quem o mestre marcou como dessa família.</p>
        ${rows.map((s) => spellCard(s, msl, d, false)).join('') || '<p class="msl-hint">nada encontrado</p>'}`;
    }
  }

  function spellCard(s, msl, d, known) {
    const open = spellOpen.has((known ? 'k' : 'b') + s.id);
    const calcSpell = computeSpell(s, sheet, sheet.level);
    const dc = calcSpell.dc;
    const famMismatch = !!s.familia && s.familia.trim().toLowerCase() !== familyOf();
    const tooHigh = s.nivel > d.decifracao;
    const learned = msl.spells.includes(s.id);
    const tags = [s.escola, s.estilo, 'nív ' + s.nivel, s.classificacao + (s.contexto_legal ? ` (${s.contexto_legal})` : ''), s.rastro, s.familia ? '🏛 família ' + s.familia : '', s.privateTo ? '✚ pessoal' : s.custom && !s.familia ? '✚ personalizada' : ''].filter(Boolean);
    return `
      <div class="msl-spell ${open ? 'open' : ''}" data-spell-card="${(known ? 'k' : 'b') + s.id}">
        <div class="msl-spell-head" data-spell-toggle="${(known ? 'k' : 'b') + s.id}">
          <b>${escapeHtml(s.nome)}</b><span class="msl-lvl">nív ${s.nivel}</span>
          <span class="msl-spell-cost">${escapeHtml(s.custo_texto || (s.custo_mp === null ? 'MP variável' : s.custo_mp + ' MP'))}</span>
          <span class="msl-spell-caret">${open ? '▾' : '▸'}</span>
        </div>
        <div class="msl-spell-desc">${escapeHtml(s.descricao)}</div>
        ${
          open
            ? `<div class="msl-spell-more">
          <div class="msl-tags">${tags.map((t) => `<span class="msl-tag">${escapeHtml(t)}</span>`).join('')}</div>
          <p><b>Ativação:</b> ${escapeHtml(s.ativacao || '—')}${s.sustentada ? ' · sustentada' + (s.manutencao ? ' (manutenção ' + s.manutencao + ' MP/turno)' : '') : ''}</p>
          <p><b>Alvo:</b> ${escapeHtml(s.alvo || '—')}</p>
          <p><b>Resistência:</b> ${escapeHtml(s.resistencia || '—')}${dc ? ` · dificuldade <b>${dc}</b>` : ''}</p>
          <p><b>Efeito:</b> ${escapeHtml(s.efeito || '—')}</p>
          <p><b>Atributo principal:</b> ${escapeHtml(s.atributo_principal || '—')}${(s.atributos_secundarios || []).length ? ' · secundários: ' + escapeHtml(s.atributos_secundarios.join(', ')) : ''}</p>
          ${computedBoxHtml(s)}
          ${(s.escalamentos || []).length ? `<p class="msl-hint"><b>Texto do livro (escalamentos):</b></p><ul class="msl-hint">${s.escalamentos.map((e) => `<li>${escapeHtml(e.atributo)}: ${escapeHtml(e.efeito)}</li>`).join('')}</ul>` : ''}
          ${s.preparo ? `<p><b>Preparo:</b> ${escapeHtml(s.preparo)}</p>` : ''}${s.modos ? `<p><b>Modos:</b> ${escapeHtml(s.modos)}</p>` : ''}
          ${s.requisitos ? `<p><b>Requisitos:</b> ${escapeHtml(s.requisitos)}</p>` : ''}${s.variacoes ? `<p><b>Variações:</b> ${escapeHtml(s.variacoes)}</p>` : ''}${s.informacoes ? `<p><b>Informações:</b> ${escapeHtml(s.informacoes)}</p>` : ''}
        </div>`
            : ''
        }
        <div class="msl-spell-btns">
          ${known && canEdit() ? `<button type="button" class="btn" data-cast="${s.id}">✨ Conjurar</button><button type="button" class="btn btn-ghost" data-forget="${s.id}">esquecer</button>` : ''}
          ${s.custom && canCreateSpell() && (isMaster || (s.privateTo && s.createdBy === session.user.id)) ? `<button type="button" class="btn btn-ghost" data-ed-edit="${s.dbId}">✎ editar</button>` : ''}
          ${s.custom && (isMaster || (s.privateTo && s.createdBy === session.user.id)) ? `<button type="button" class="btn btn-ghost" data-ed-delete="${s.dbId}">🗑 apagar</button>` : ''}
          ${famMismatch && !known && isMaster ? `<span class="msl-hint">⚠ esse personagem não é da família ${escapeHtml(s.familia)}</span>` : ''}
          ${!known && canEdit() ? (learned ? '<span class="msl-hint">já conhecida</span>' : `<button type="button" class="btn ${tooHigh ? 'btn-ghost' : ''}" data-learn="${s.id}" title="${tooHigh ? 'acima da sua Decifração' : ''}">${tooHigh ? 'aprender (acima da Decifração)' : 'aprender'}</button>`) : ''}
        </div>
      </div>`;
  }
  // personagem com os bônus de vantagens já embutidos (spellDifficulty usa attrEffective)
  const sheetWithMods = () => sheet;

  // conjurar: gasta PE = PA e MP da magia; confere o Fluxo do turno
  async function cast(spellId) {
    const list = await allSpells();
    const s = list.find((x) => x.id === spellId);
    if (!s) return;
    const msl = mslOf(sheet);
    const d = derive(sheet);
    const paMatch = /(\d+)\s*PA/i.exec(s.ativacao || '');
    const pa = paMatch ? parseInt(paMatch[1], 10) : 2;
    let mp = s.custo_mp;
    if (mp === null || mp === undefined) {
      const v = window.prompt(`"${s.nome}" tem custo de MP variável (${s.custo_texto || '?'}). Quanto MP vai gastar?`, '1');
      if (v === null) return;
      mp = Math.max(0, parseInt(v, 10) || 0);
    }
    const curMp = msl.mp === null ? d.mpMax : msl.mp;
    const used = (msl.fluxoUsed || 0) + mp;
    const problems = [];
    if (sheet.estamina_current < pa) problems.push(`PE insuficiente (precisa de ${pa}, tem ${sheet.estamina_current})`);
    if (curMp < mp) problems.push(`MP insuficiente (precisa de ${mp}, tem ${curMp})`);
    if (used > d.fluxo) problems.push(`passa do Fluxo do turno (${used}/${d.fluxo})`);
    if (s.nivel > d.decifracao) problems.push(`nível ${s.nivel} acima da sua Decifração (${d.decifracao})`);
    // sustentada ocupa 1 vaga de Manutenção; estrutura/arma/terreno moldado ocupa vaga(s) de Formas
    const others = msl.active.filter((e) => e.spellId !== s.id);
    const u0 = slotsUsed({ active: others });
    const regs = [];
    if (s.sustentada) regs.push({ kind: 'sustentada', manut: 1, formas: 0, upkeep: Math.max(0, parseInt(s.manutencao, 10) || 1) });
    const fn = formasSlots(s);
    if (fn > 0) regs.push({ kind: 'forma', manut: 0, formas: fn, upkeep: 0 });
    const addM = regs.reduce((a, r) => a + r.manut, 0);
    const addF = regs.reduce((a, r) => a + r.formas, 0);
    if (u0.m + addM > d.manutencao) problems.push(`sem vaga de Manutenção (${u0.m + addM}/${d.manutencao})`);
    if (u0.f + addF > d.formas) problems.push(`sem vaga de Formas (${u0.f + addF}/${d.formas})`);
    if (problems.length && !window.confirm('Atenção: ' + problems.join('; ') + '.\nConjurar mesmo assim?')) return;
    const dc = computeSpell(s, sheet, sheet.level).dc;
    spellMsg = `${s.nome}: −${pa} PE, −${mp} MP${dc ? ` · dificuldade pra resistir ${dc}` : ''}${/instabilidade_magica/.test(JSON.stringify(msl.disadvantages)) ? ' · Instabilidade Mágica: role 1d10 (1 = falha)' : ''}`;
    const turns = durationTurns(s);
    if (regs.length) spellMsg += ' · registrada em Magias ativas (' + regs.map((r) => r.kind === 'forma' ? r.formas + ' vaga(s) de Formas' : 'Manutenção ' + r.upkeep + ' MP/turno').join(' + ') + ')';
    await commit(
      (m) => {
        m.mp = Math.max(0, curMp - mp);
        m.fluxoUsed = used;
        if (regs.length) {
          m.active = m.active.filter((e) => e.spellId !== s.id);
          regs.forEach((r) => m.active.push({ id: newId(), spellId: s.id, name: s.nome, tier: null, turns, note: '', ...r }));
        }
      },
      { estamina_current: Math.max(0, sheet.estamina_current - pa) }
    );
  }

  // ---------------------------------------------------------------- aba: regras (consulta)
  function rulesTab(d) {
    return `
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">AÇÕES (6 PA por rodada — ação e reação saem do mesmo total; cada PA gasta também custa 1 PE)</span></div>
        <table class="msl-table"><tr><th>Ação</th><th>Tipo</th><th>PA</th></tr>${ACTIONS.map((a) => `<tr><td>${escapeHtml(a.name)}</td><td>${a.kind}</td><td>${a.pa}</td></tr>`).join('')}</table>
      </div>
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">ATAQUE E DANO</span></div>
        <ul class="msl-list">
          <li>Acerto: 1d20 + Precisão Física//2 (magia com mira: Precisão Mágica) ≥ CE do alvo. Sua CE: <b>${d.ce}</b>.</li>
          <li>Desviar (reação, antes da rolagem do atacante): CE + Reflexos//2 contra esse ataque.</li>
          <li>Bloquear (reação, depois de ser acertado): reduz Força//2 + bloqueio (escudo 3, arma 1, desarmado 0). Sem escudo não bloqueia projéteis.</li>
          <li>Dano de arma: dado da arma + Força//2. Dano final = dano − armadura (<b>${d.armadura}</b>). Dano por turno ignora armadura.</li>
          <li>Crítico: d20 = ${d.critico}${d.critico < 20 ? ' ou mais' : ''}. Falha crítica: 1.</li>
          <li>Iniciativa: 1d20 + Reflexos//2 (${signed(d.iniciativaMod)}). Empate: maior Agilidade.</li>
          <li>Estados: Bem (&gt;60% HP) · Ferido (&gt;30%) · Gravemente ferido (≥0) · Morrendo (≥ −15${d.morteHp === -10 ? '; você: ≥ −9' : ''}) · Morto. Ataque letal: dano &gt; metade do HP máximo.</li>
          <li>Exaustão (0 PE): 1d6 PA no turno e +1 nível; −2 em testes e CE por nível; desmaia no nível ${d.exaustaoMax}. Descanso zera.</li>
        </ul>
      </div>
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">TIPOS DE DANO (d100 pro efeito)</span></div>
        <table class="msl-table"><tr><th>Tipo</th><th>Chance</th><th>Efeito</th></tr>${DAMAGE_TYPES.map((t) => `<tr><td>${t.name}</td><td>${t.chance}</td><td>${escapeHtml(t.effect)}</td></tr>`).join('')}</table>
        <p class="msl-hint">Dano em %: mínimo 1, máximo 10 por turno. A cada 5 pontos de RF (efeitos físicos) ou RM (mágicos): −1 turno de duração e −1 de dano por turno.</p>
      </div>
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">MANOBRAS</span></div>
        <ul class="msl-list">
          <li><b>Agarrar</b> (2 PA): Força contra Força ou Agilidade do alvo. Quem agarra paga 3 PE por turno (+1 por fuga resistida).</li>
          <li><b>Escapar</b> (2 PA): Força ou Agilidade contra Força de quem agarra.</li>
          <li><b>Empurrar</b> (2 PA): empurra 2 m · <b>Derrubar</b> (2 PA): alvo caído (corpo a corpo contra ele +2, à distância −2; levantar custa 2 PA).</li>
          <li><b>Arremessar objeto</b>: Precisão Física contra CE; alcance 3 m + Força//2 (<b>${d.arremesso} m</b>) · <b>Arremessar alguém</b>: só alvo agarrado, 1d6 de dano.</li>
          <li><b>Golpe de oportunidade</b> (reação, 1 PA, 1×/rodada) quando um engajado sai do alcance sem recuar com cuidado.</li>
        </ul>
      </div>
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">TESTES SOCIAIS E MÁGICOS</span></div>
        <ul class="msl-list">
          <li>Ameaçar e Acalmar: o alvo defende com Autocontrole. Enganação: o alvo defende com Perspicácia.</li>
          <li>Resistir a magia: o conjurador não rola. Dificuldade = 10 + atributo principal//2 + escalamentos; o alvo rola 1d20 + RM//2.</li>
          <li>Magia: custa PA (padrão 2) + PE igual + MP; o MP gasto no turno não passa do Fluxo (<b>${d.fluxo}</b>).</li>
          <li>Aprender magia: Decifração ≥ nível; dificuldade 10 + 2×nível; precisa de (nível) sucessos em testes de Intelecto (técnicas físicas: Disciplina).</li>
        </ul>
      </div>`;
  }

  // ---------------------------------------------------------------- aba: notas
  function notesTab(msl) {
    const data = sheetDataOf(sheet);
    const f = (id, label) => `<div><label class="msl-lbl">${label}</label><input type="text" data-sheetfield="${id}" value="${escapeHtml(data[id] || '')}" ${canEdit() ? '' : 'disabled'}></div>`;
    return `
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">FICHA</span></div>
        <div class="ficha-fields-grid">${f('jogador', 'Jogador')}${f('idade', 'Idade')}${f('trabalho', 'Ocupação')}${f('genero', 'Gênero')}${f('nacionalidade', 'Nacionalidade')}${f('raca', 'Raça')}</div>
      </div>
      ${isMaster
        ? `<div class="ficha-section msl-master-magic">
        <div class="ficha-section-head"><span class="ficha-section-title">MAGIA DESTE PERSONAGEM (mestre)</span></div>
        <label class="msl-check"><input type="checkbox" data-field-bool="noMagic" ${msl.noMagic ? 'checked' : ''}> <b>Ainda não tem magia</b> — esconde os atributos e status mágicos e não cobra a distribuição dos pontos mágicos (dá pra desmarcar quando ele despertar)</label>
        <label class="msl-check"><input type="checkbox" data-field-bool="canCreateSpells" ${msl.canCreateSpells ? 'checked' : ''}> <b>Pode criar magias</b> — libera o botão "✚ criar minha magia" pro jogador (por padrão ele NÃO pode; o mestre sempre pode)</label>
        <div class="msl-armor-row"><label class="msl-lbl">Família mágica</label><input type="text" data-field="family" style="width:240px" value="${escapeHtml(msl.family)}" placeholder="ex.: Lunaris (Herança Arcana)"></div>
        <p class="msl-hint">Quem é da família vê e pode aprender as magias personalizadas marcadas com esse mesmo nome de família (aba Magias → ✚ criar magia).</p>
      </div>`
        : ''}
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">HISTÓRIA</span></div>
        <textarea class="ficha-historia-box" data-sheetfield="historia" placeholder="conte a história do personagem..." ${canEdit() ? '' : 'disabled'}>${escapeHtml(data.historia)}</textarea>
      </div>
      <div class="ficha-section">
        <div class="ficha-section-head"><span class="ficha-section-title">ANOTAÇÕES</span></div>
        <textarea class="ficha-historia-box" data-field="notes" placeholder="equipamento, aliados, pendências..." ${canEdit() ? '' : 'disabled'}>${escapeHtml(msl.notes)}</textarea>
        <div class="msl-armor-row"><label class="msl-lbl">Armadura de itens</label><input type="number" min="0" data-field="armor" value="${msl.armor}" ${canEdit() ? '' : 'disabled'}></div>
        ${
          isMaster
            ? `<div class="msl-armor-row">${
                msl.done
                  ? '<button type="button" class="btn btn-ghost" data-act="reopen-creation">reabrir a criação do personagem</button>'
                  : ''
              }</div>`
            : ''
        }
        ${
          !msl.done && (isOwner() || isMaster)
            ? `<div class="msl-armor-row"><button type="button" class="btn" data-act="finish-creation" title="trava vantagens/desvantagens/escola para o jogador; depois só o mestre altera">✔ concluir a criação do personagem</button></div>`
            : ''
        }
      </div>`;
  }

  // ---------------------------------------------------------------- eventos
  async function handleClick(e) {
    const t = e.target;
    const btn = (sel) => t.closest(sel);
    let el;

    if ((el = btn('[data-tab]'))) {
      tab = el.dataset.tab;
      render();
      if (tab === 'magias') refreshCustomSpells().then(fillSpells);
      return;
    }
    if ((el = btn('[data-rollmode]'))) {
      rollMode = el.dataset.rollmode;
      render();
      return;
    }
    if ((el = btn('[data-roll-attr]'))) {
      const k = el.dataset.rollAttr;
      return doRoll(attrDef(k).label, attrMod(sheet, k));
    }
    if ((el = btn('[data-roll-skill]'))) {
      const s = SKILLS.find((x) => x.id === el.dataset.rollSkill);
      const msl = mslOf(sheet);
      const name = s.custom && msl.oficio ? `${s.name} (${msl.oficio})` : s.name;
      return doRoll(name, testMod(sheet, s.attr, s.id));
    }
    if ((el = btn('[data-vital]'))) return vitalDelta(el.dataset.vital, parseInt(el.dataset.delta, 10));
    if ((el = btn('[data-exh]'))) {
      const d = derive(sheet);
      return commit((m) => {
        m.exaustao = Math.max(0, Math.min(d.exaustaoMax, m.exaustao + parseInt(el.dataset.exh, 10)));
      });
    }
    if ((el = btn('[data-attr]'))) return attrStep(el.dataset.attr, parseInt(el.dataset.d, 10));
    if ((el = btn('[data-skill]'))) return setSkill(el.dataset.skill, parseInt(el.dataset.grade, 10));
    if ((el = btn('[data-del-lang]'))) return commit((m) => m.idiomas.splice(parseInt(el.dataset.delLang, 10), 1));
    if ((el = btn('[data-del-adv]'))) return commit((m) => (m.advantages = m.advantages.filter((x) => x.id !== el.dataset.delAdv)), {}, { syncMax: true });
    if ((el = btn('[data-del-dis]'))) return commit((m) => (m.disadvantages = m.disadvantages.filter((x) => x.id !== el.dataset.delDis)), {}, { syncMax: true });
    if ((el = btn('[data-del-talent]'))) return commit((m) => (m.talents = m.talents.filter((x) => x !== el.dataset.delTalent)));
    if ((el = btn('[data-del-trauma]'))) return commit((m) => m.traumas.splice(parseInt(el.dataset.delTrauma, 10), 1));
    if ((el = btn('[data-perk-add]'))) {
      const [kind, id] = el.dataset.perkAdd.split(':');
      return commit((m) => m[kind === 'adv' ? 'advantages' : 'disadvantages'].push({ id, note: '' }), {}, { syncMax: true });
    }
    if ((el = btn('[data-perkf-level]'))) {
      perkFilter.level = el.dataset.perkfLevel;
      return render();
    }
    if ((el = btn('[data-sanity]'))) return sanityHit(el.dataset.sanity);
    if ((el = btn('[data-cast]'))) return cast(el.dataset.cast);
    if ((el = btn('[data-forget]'))) {
      if (window.confirm('Esquecer essa magia?')) await commit((m) => (m.spells = m.spells.filter((x) => x !== el.dataset.forget)));
      return fillSpells();
    }
    if ((el = btn('[data-learn]'))) {
      const id = el.dataset.learn;
      await commit((m) => {
        if (!m.spells.includes(id)) m.spells.push(id);
      });
      spellBrowserOpen = true;
      return fillSpells();
    }
    if ((el = btn('[data-spell-toggle]'))) {
      const id = el.dataset.spellToggle;
      if (spellOpen.has(id)) spellOpen.delete(id);
      else spellOpen.add(id);
      const y = window.scrollY;
      render();
      await fillSpells();
      window.scrollTo(0, y);
      return;
    }

    if ((el = btn('[data-act-del]'))) return commit((m) => (m.active = m.active.filter((x) => x.id !== el.dataset.actDel)));
    if ((el = btn('[data-act-ctrl]'))) return controlTest(el.dataset.actCtrl);
    if ((el = btn('[data-ed-insert]'))) {
      insertSigla(el.dataset.edInsert);
      return;
    }
    if ((el = btn('[data-ed-edit]'))) {
      const sp = customSpells.find((x) => x.dbId === el.dataset.edEdit);
      if (sp) startEditor(sp);
      return;
    }
    if ((el = btn('[data-ed-delete]'))) {
      const sp = customSpells.find((x) => x.dbId === el.dataset.edDelete);
      if (sp && window.confirm('Apagar a magia "' + sp.nome + '" da campanha? Quem já a aprendeu perde o acesso.')) {
        try {
          await deleteCustomSpell(sp.dbId);
          await refreshCustomSpells();
        } catch (err) {
          window.alert('Erro: ' + err.message);
        }
        render();
      }
      return;
    }
    if ((el = btn('[data-act]'))) {
      const act = el.dataset.act;
      if (act === 'ed-new') return startEditor(null);
      if (act === 'ed-cancel') {
        spellEditor = null;
        edError = '';
        return render();
      }
      if (act === 'ed-save') return saveEditor();
      if (act === 'ed-help') {
        helpOpen = !helpOpen;
        return render();
      }
      if (act === 'ed-add-row') {
        spellEditor.calc.push({ label: '', type: 'valor', formula: '', sides: 6, unit: '', attr: 'armazenamento', every: 10, amount: 1 });
        return render();
      }
      if (act === 'ed-del-row') {
        spellEditor.calc.splice(parseInt(el.dataset.i, 10), 1);
        return render();
      }
      const msl = mslOf(sheet);
      if (act === 'back') return onBack && onBack();
      if (act === 'avatar') return $('msl-avatar-input').click();
      if (act === 'toggle-help') {
        showHelp = !showHelp;
        return render();
      }
      if (act === 'toggle-temp') {
        showTemp = !showTemp;
        return render();
      }
      if (act === 'init') {
        const d = derive(sheet);
        return doRoll('Iniciativa', d.iniciativaMod);
      }
      if (act === 'rest') {
        const d = derive(sheet);
        const heal = rollDie(6);
        return commit(
          (m) => {
            m.mp = d.mpMax;
            m.exaustao = 0;
            m.fluxoUsed = 0;
            m.sanidade = Math.min(d.sanidadeMax, m.sanidade + heal);
          },
          { hp_current: d.hpMax, estamina_current: d.peMax }
        ).then(() => {
          spellMsg = `Descanso: HP, PE e MP restaurados; exaustão zerada; +${heal} de Sanidade.`;
          render();
        });
      }
      if (act === 'new-turn') return msl.active.length ? newTurn() : commit((m) => (m.fluxoUsed = 0));
      if (act === 'act-add-forma') return addForma();
      if (act === 'act-add-inv') return addInvocation();
      if (act === 'xp-give' || act === 'xp-take') {
        const v = parseInt($('msl-xp-input').value, 10);
        if (!v || v < 1) return;
        try {
          if (act === 'xp-give') await grantXp([characterId], v);
          else await revokeXp([characterId], v);
          const fresh = await getCharacterSheet(characterId);
          if (fresh) sheet = fresh;
        } catch (err) {
          window.alert('Erro: ' + err.message);
        }
        return render();
      }
      if (act === 'draft-start') {
        draft = { ...msl.attrs };
        return render();
      }
      if (act === 'draft-cancel') {
        draft = null;
        return render();
      }
      if (act === 'draft-confirm') {
        const used = { basicos: 0, sociais: 0, magicos: 0 };
        attrDefs.forEach((a) => (used[poolKeyOfAttr(a.key)] += draft[a.key] - msl.attrs[a.key]));
        const next = draft;
        draft = null;
        return commit((m) => {
          m.attrs = next;
          m.pool = { basicos: m.pool.basicos - used.basicos, sociais: m.pool.sociais - used.sociais, magicos: m.pool.magicos - used.magicos };
        }, {}, { syncMax: true });
      }
      if (act === 'perks-confirm') {
        const pv = pvSummary(msl);
        if (pv.left < 0) return window.alert('Você gastou ' + -pv.left + ' PV a mais do que ganhou. Tire alguma vantagem ou pegue mais desvantagens antes de confirmar.');
        if (pv.lvl3adv > 1) return window.alert('Só uma vantagem de nível 3 na criação. Tire a que sobra antes de confirmar.');
        const rest = pv.left > 0 ? '\n\nVocê ainda tem ' + pv.left + ' PV sem usar. Tudo bem: gastar todos não é obrigatório (PV não usado na criação se perde).' : '';
        if (!window.confirm('Confirmar as vantagens e desvantagens? Depois disso só o mestre consegue mudar.' + rest)) return;
        perkPicker = null;
        return commit((m) => (m.perksConfirmed = true));
      }
      if (act === 'perks-unlock') return commit((m) => (m.perksConfirmed = false));
      if (act === 'perk-open') {
        perkPicker = el.dataset.kind;
        perkFilter = { level: '', text: '' };
        render();
        const box = app.querySelector('.msl-picker');
        if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      if (act === 'perk-close') {
        perkPicker = null;
        return render();
      }
      if (act === 'add-talent') {
        const sel = $('msl-talent-select');
        if (sel.value) await commit((m) => m.talents.push(sel.value));
        return;
      }
      if (act === 'roll-trauma') {
        const n = rollDie(8);
        const tr = TRAUMAS.find((x) => x.d === n);
        return commit((m) => m.traumas.push({ d: n, name: tr.name, text: tr.text }));
      }
      if (act === 'spell-browser') {
        spellBrowserOpen = !spellBrowserOpen;
        render();
        return fillSpells();
      }
      if (act === 'finish-creation') {
        if (!window.confirm('Concluir a criação? Depois só o mestre altera vantagens, desvantagens e escola.')) return;
        return commit((m) => (m.done = true));
      }
      if (act === 'reopen-creation') return commit((m) => (m.done = false));
    }
  }

  async function vitalDelta(kind, delta) {
    const d = derive(sheet);
    if (kind === 'hp') return saveVital('hp', sheet.hp_current + delta);
    if (kind === 'pe') return saveVital('pe', sheet.estamina_current + delta);
    if (kind === 'mp') return saveVital('mp', (mslOf(sheet).mp === null ? d.mpMax : mslOf(sheet).mp) + delta);
    if (kind === 'san') return saveVital('san', mslOf(sheet).sanidade + delta);
  }
  async function saveVital(kind, value) {
    const d = derive(sheet);
    if (kind === 'hp') {
      // HP pode ir abaixo de zero (Morrendo até −15; Propenso a Ferimentos morre antes)
      const v = Math.max(-30, Math.min(d.hpMax, value));
      sheet.hp_current = v;
      render();
      await saveColumns({ hp_current: v });
    } else if (kind === 'pe') {
      const v = Math.max(0, Math.min(d.peMax, value));
      sheet.estamina_current = v;
      render();
      await saveColumns({ estamina_current: v });
    } else if (kind === 'mp') {
      await commit((m) => (m.mp = Math.max(0, Math.min(d.mpMax, value))));
    } else if (kind === 'san') {
      await commit((m) => (m.sanidade = Math.max(0, Math.min(d.sanidadeMax, value))));
    }
  }

  function attrStep(key, step) {
    const msl = mslOf(sheet);
    if (isMaster) {
      return commit((m) => (m.attrs[key] = Math.max(0, m.attrs[key] + step)), {}, { syncMax: true });
    }
    if (!draft) return;
    const pk = poolKeyOfAttr(key);
    const used = attrDefs.filter((a) => poolKeyOfAttr(a.key) === pk).reduce((s, a) => s + draft[a.key] - msl.attrs[a.key], 0);
    if (step > 0 && msl.pool[pk] - used <= 0) return;
    if (step < 0 && draft[key] <= msl.attrs[key]) return;
    draft[key] += step;
    render();
  }

  function setSkill(id, grade) {
    const msl = mslOf(sheet);
    const cur = skillGrade(msl, id);
    if (grade === cur) return;
    const diff = grade - cur;
    if (!isMaster) {
      if (diff > 0 && msl.skillGrades < diff) return;
      if (grade > (msl.done ? 3 : 2)) return;
      if (diff < 0 && msl.done) return;
    }
    return commit((m) => {
      m.skills[id] = grade;
      if (!isMaster) m.skillGrades -= diff;
    });
  }

  async function sanityHit(id) {
    const def = SANITY_LOSS.find((s) => s.id === id);
    const msl = mslOf(sheet);
    const dice = rollDice(def.dice[0], def.dice[1]);
    const loss = dice.reduce((a, b) => a + b, 0);
    const fragmented = msl.disadvantages.some((e) => e.id === 'mente_fragmentada');
    let text = `Perda ${def.label.toLowerCase()}: ${def.dice[0]}d${def.dice[1]} = ${loss}.`;
    let final = loss;
    if (!fragmented) {
      const bonus = (msl.advantages.some((e) => e.id === 'resistencia_mental') ? 2 : 0) + (msl.advantages.some((e) => e.id === 'estavel') ? 2 : 0);
      const mod = attrMod(sheet, 'autocontrole') + bonus + derive(sheet).exaustaoPenalidade;
      const d20 = rollDie(20);
      const ok = d20 + mod >= def.dc;
      text += ` Autocontrole: ${d20}${signed(mod)} = ${d20 + mod} vs CD ${def.dc} → ${ok ? 'passou (perde metade)' : 'falhou'}.`;
      if (ok) final = Math.floor(loss / 2);
    } else text += ' Mente Fragmentada: sem teste.';
    const before = msl.sanidade;
    const after = Math.max(0, before - final);
    const stage = sanityStage(after);
    text += ` Sanidade ${before} → ${after}.${stage.id !== 'ok' && sanityStage(before).id !== stage.id ? ' ' + stage.label + '!' : ''}`;
    spellMsg = text;
    await commit((m) => (m.sanidade = after));
  }

  async function handleChange(e) {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-vital-input]'))) return saveVital(el.dataset.vitalInput, parseInt(el.value, 10) || 0);
    if ((el = t.closest('[data-temp]'))) return commit((m) => (m.temp[el.dataset.temp] = parseInt(el.value, 10) || 0));
    if ((el = t.closest('[data-pool]'))) return commit((m) => (m.pool[el.dataset.pool] = Math.max(0, parseInt(el.value, 10) || 0)));
    if ((el = t.closest('[data-skillgrades]'))) return commit((m) => (m.skillGrades = Math.max(0, parseInt(el.value, 10) || 0)));
    if ((el = t.closest('[data-field]'))) {
      const f = el.dataset.field;
      const v = el.type === 'number' ? Math.max(0, parseInt(el.value, 10) || 0) : el.value;
      return commit((m) => (m[f] = v), {}, { rerender: f === 'school' || f === 'element' || f === 'family' });
    }
    if ((el = t.closest('[data-perk-note]'))) {
      const [kind, id] = el.dataset.perkNote.split(':');
      return commit((m) => {
        const arr = kind === 'adv' ? m.advantages : m.disadvantages;
        const item = arr.find((x) => x.id === id);
        if (item) item.note = el.value;
      }, {}, { rerender: false });
    }
    if ((el = t.closest('[data-sheetfield]'))) {
      const data = { ...sheetDataOf(sheet), [el.dataset.sheetfield]: el.value };
      sheet.sheet_data = data;
      busy = true;
      try {
        await updateSheetData(characterId, data);
      } catch (err) {
        window.alert('Erro ao salvar: ' + err.message);
      }
      busy = false;
      return;
    }
    if ((el = t.closest('[data-ed], [data-ed-row], [data-ed-base]'))) {
      applyEditorField(el, true);
      return;
    }
    if ((el = t.closest('[data-field-bool]'))) {
      const f = el.dataset.fieldBool;
      return commit((m) => (m[f] = el.checked), {}, { rerender: true });
    }
    if ((el = t.closest('[data-perkf-text]'))) {
      perkFilter.text = el.value;
      return render();
    }
    if ((el = t.closest('[data-spellf]'))) {
      const k = el.dataset.spellf;
      spellFilter[k] = el.type === 'checkbox' ? el.checked : el.value;
      return fillSpells();
    }
    if (t.closest('#msl-avatar-input') && t.files && t.files[0]) {
      const file = t.files[0];
      t.value = '';
      const { openAvatarEditor } = await import('../avatarEditor.js');
      const blob = await openAvatarEditor(file);
      if (!blob) return;
      uploadingAvatar = true;
      render();
      try {
        sheet.avatar_url = await uploadAvatar(characterId, new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      } catch (err) {
        window.alert('Erro ao enviar foto: ' + err.message);
      }
      uploadingAvatar = false;
      render();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' && e.target.id === 'msl-lang-input') {
      const v = e.target.value.trim();
      if (v) commit((m) => m.idiomas.push(v.slice(0, 40)));
    }
  }

  // editor de magia: guarda o que é digitado e atualiza só a prévia (sem refazer a tela e perder o cursor)
  function applyEditorField(el, fromChange) {
    if (!spellEditor) return;
    if (el.dataset.edBase) {
      spellEditor.base = { ...(spellEditor.base || {}), [el.dataset.edBase]: el.value };
    } else if (el.dataset.ed) {
      spellEditor[el.dataset.ed] = el.type === 'checkbox' ? el.checked : el.value;
    } else if (el.dataset.edRow) {
      const [i, f] = el.dataset.edRow.split(':');
      spellEditor.calc[parseInt(i, 10)][f] = el.value;
      if (f === 'type' && fromChange) return render();
    }
    const pv = $('msl-ed-preview');
    if (pv) pv.innerHTML = editorPreviewHtml();
  }
  function handleInput(e) {
    const el = e.target.closest && e.target.closest('[data-ed], [data-ed-row], [data-ed-base]');
    if (el && el.tagName !== 'SELECT') applyEditorField(el, false);
  }
  function handleFocusIn(e) {
    const el = e.target.closest && e.target.closest('[data-ed-row$=":formula"]');
    if (el) lastFormulaIdx = parseInt(el.dataset.edRow, 10);
  }
  // botão da sigla no painel "?": coloca no campo de fórmula em que você estava
  function insertSigla(abbr) {
    if (!spellEditor) return;
    let i = lastFormulaIdx;
    if (i === null || !spellEditor.calc[i] || (spellEditor.calc[i].type || 'valor') === 'passos') i = spellEditor.calc.findIndex((r) => (r.type || 'valor') !== 'passos');
    if (i < 0) return;
    const input = app.querySelector('[data-ed-row="' + i + ':formula"]');
    const cur = spellEditor.calc[i].formula || '';
    const pos = input && typeof input.selectionStart === 'number' ? input.selectionStart : cur.length;
    spellEditor.calc[i].formula = cur.slice(0, pos) + abbr + cur.slice(pos);
    render();
    const again = app.querySelector('[data-ed-row="' + i + ':formula"]');
    if (again) {
      again.focus();
      const np = pos + abbr.length;
      again.setSelectionRange(np, np);
    }
  }
  app.addEventListener('input', handleInput);
  app.addEventListener('focusin', handleFocusIn);
  app.addEventListener('click', handleClick);
  app.addEventListener('change', handleChange);
  app.addEventListener('keydown', handleKeydown);
  app._fichaCleanup = () => {
    app.removeEventListener('click', handleClick);
    app.removeEventListener('change', handleChange);
    app.removeEventListener('keydown', handleKeydown);
    app.removeEventListener('input', handleInput);
    app.removeEventListener('focusin', handleFocusIn);
    if (activeChannel) {
      supabase.removeChannel(activeChannel);
      activeChannel = null;
    }
  };

  load().then(() => {
    if (tab === 'magias') fillSpells();
  });
}
