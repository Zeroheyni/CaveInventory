// Camada de combate do Magic Learning dentro da tela de combate (screens/combat.js): painel de ações com Pontos de Ação, exaustão,
// ataque/esquiva/bloqueio, iniciativa automática e ferramenta de dano com armadura e tipos de dano. As regras e escritas no banco
// ficam em src/systems/msl-combat.js; aqui só tem a interface. Só é montada quando o sistema da campanha é o Magic Learning.
import { supabase } from '../supabaseClient.js';
import { escapeHtml } from '../shared/gameData.js';
import { reorderParticipants } from '../combat.js';
import { rollD20Test } from '../dice.js';
import { derive, mslOf, attrMod, woundState } from '../systems/magic-learning.js';
import { ACTIONS, DAMAGE_TYPES } from '../systems/msl-data.js';
import {
  PA_PER_ROUND,
  basePa,
  paOf,
  isExhaustedRound,
  spendAction,
  refundAction,
  enterExhaustion,
  initiativeFor,
  sortByInitiative,
  applyDamage,
  rollExpr,
} from '../systems/msl-combat.js';

const signed = (n) => (n >= 0 ? '+' + n : String(n));

export function createMslCombatUi(ctx) {
  const { campaignId, isMaster, userId } = ctx;
  const ui = {
    targetPid: null, // participante cujo painel de ações está aberto (mestre); jogador sempre vê o próprio
    atkTarget: '', // alvo do ataque (mestre): compara o total com a CE dele
    rollMode: 'normal',
    msg: '',
    dmg: { pid: '', expr: '', type: 'cortante', origin: 'auto', undead: false },
    dmgLines: [],
    busy: false,
  };

  const round = () => ctx.getState().round;
  const list = () => ctx.getParticipants().slice().sort((a, b) => a.position - b.position);
  const byId = (id) => ctx.getParticipants().find((p) => p.id === id) || null;

  function panelTarget() {
    if (!isMaster) return ctx.getMySelf();
    return byId(ui.targetPid) || ctx.getCurrent() || list()[0] || null;
  }
  const hasAdv = (char, id) => !!(char && char.system_data && mslOf(char).advantages.some((e) => e.id === id));
  // −2 por nível de exaustão em testes e CE (Foco de Batalha ignora 1 nível)
  function exhPenalty(p, char) {
    const lvl = Math.max(0, (p.exaustao || 0) - (hasAdv(char, 'foco_de_batalha') ? 1 : 0));
    return -2 * lvl;
  }
  const ceOf = (p, char) => (char && char.system_data ? derive(char).ce : 10) + exhPenalty(p, char);

  // ------------------------------------------------------------------ HTML
  function pips(p) {
    const now = paOf(p, round());
    let h = '';
    for (let i = 0; i < PA_PER_ROUND; i++) h += `<i class="${i < now ? 'on' : ''}"></i>`;
    return `<span class="mslc-pips" title="Pontos de Ação desta rodada">${h}<b>${now}/${PA_PER_ROUND}</b></span>`;
  }
  function rowBadges(p) {
    const char = ctx.charOf(p);
    const d = char && char.system_data ? derive(char) : null;
    const ws = woundState(p.hp_current, p.hp_max, d ? d.morteHp : -16);
    return `<div class="mslc-badges">
      ${pips(p)}
      <span class="mslc-wound mslc-wound-${ws.tone}">${ws.label}</span>
      ${p.exaustao ? `<span class="mslc-exh" title="exaustão: −2 em testes e CE por nível">😮‍💨 ${p.exaustao}</span>` : ''}
      ${isMaster ? `<button type="button" class="mslc-open" data-msl-target="${p.id}" title="abrir o painel de ações dele">⚔ ações</button>` : ''}
    </div>`;
  }

  function panelHtml() {
    const p = panelTarget();
    if (!p) return '';
    const char = ctx.charForParticipant(p);
    const d = char && char.system_data ? derive(char) : null;
    const now = paOf(p, round());
    const exh = isExhaustedRound(p, round());
    const canAct = isMaster || p.character_id === ctx.characterId;
    const ce = ceOf(p, char);
    const pen = exhPenalty(p, char);
    const dodgeCost = hasAdv(char, 'reflexos_sobre_humanos') ? 1 : 2;
    const chip = (a) => {
      const cost = typeof a.pa === 'number' ? a.pa : 2;
      const low = cost > now;
      return `<button type="button" class="mslc-act ${a.kind === 'Reação' ? 'react' : ''}" data-msl-spend="${cost}|${escapeHtml(a.name)}" ${low || !canAct ? 'disabled' : ''} title="${escapeHtml(a.kind)} — ${cost} PA + ${cost} PE">
        <span>${escapeHtml(a.name.replace(/\s*\(.*$/, ''))}</span><b>${cost}</b></button>`;
    };
    const others = ACTIONS.filter((a) => !/^Atacar|^Desviar|^Bloquear/.test(a.name));
    return `
      <div class="mslc-panel">
        <div class="mslc-head">
          <div class="mslc-who">
            <b>⚔ ${escapeHtml(p.display_name)}</b>
            ${isMaster ? `<select data-msl-pick>${list().map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${escapeHtml(x.display_name)}</option>`).join('')}</select>` : ''}
          </div>
          <div class="mslc-stats">
            ${pips(p)}
            <span class="mslc-pill" title="Classe de Esquiva${pen ? ' (com a penalidade de exaustão)' : ''}">CE <b>${ce}</b></span>
            ${p.exaustao ? `<span class="mslc-pill bad">exaustão <b>${p.exaustao}</b> (${pen})</span>` : ''}
            ${exh ? '<span class="mslc-pill bad">agindo exausto</span>' : ''}
            ${d ? `<span class="mslc-pill" title="Fluxo: MP por turno">Fluxo <b>${d.fluxo}</b></span>` : ''}
          </div>
        </div>
        ${
          canAct
            ? `
        <div class="mslc-row">
          <span class="mslc-lbl">teste</span>
          <div class="mslc-mode">${['normal', 'vantagem', 'desvantagem'].map((m) => `<button type="button" class="${ui.rollMode === m ? 'active' : ''}" data-msl-mode="${m}">${m}</button>`).join('')}</div>
          ${isMaster ? `<select data-msl-atk-target title="alvo do ataque: compara o total com a CE dele"><option value="">alvo (opcional)</option>${list().filter((x) => x.id !== p.id).map((x) => `<option value="${x.id}" ${ui.atkTarget === x.id ? 'selected' : ''}>${escapeHtml(x.display_name)}</option>`).join('')}</select>` : ''}
        </div>
        <div class="mslc-acts">
          <button type="button" class="mslc-act main" data-msl-attack="fisico" ${now < 2 ? 'disabled' : ''} title="2 PA + 2 PE · 1d20 + Precisão Física÷2 contra a CE">🗡 Atacar <small>(Prec. Física)</small><b>2</b></button>
          <button type="button" class="mslc-act main magic" data-msl-attack="magico" ${now < 2 ? 'disabled' : ''} title="2 PA + 2 PE · 1d20 + Precisão Mágica÷2 contra a CE">✨ Atacar <small>(Prec. Mágica)</small><b>2</b></button>
          <button type="button" class="mslc-act react" data-msl-dodge ${now < dodgeCost ? 'disabled' : ''} title="reação, antes da rolagem do atacante: CE + Reflexos÷2">🌀 Desviar<b>${dodgeCost}</b></button>
          <button type="button" class="mslc-act react" data-msl-block ${now < 2 ? 'disabled' : ''} title="reação, depois de ser acertado: reduz Força÷2 + bloqueio do equipamento">🛡 Bloquear<b>2</b></button>
          ${others.map(chip).join('')}
        </div>
        <div class="mslc-foot">
          ${p.stamina_current <= 0 && !exh ? '<button type="button" class="btn" data-msl-exhaust title="0 PE: rola 1d6 de PA nesta rodada e ganha +1 de exaustão">😮‍💨 agir exausto (0 PE)</button>' : ''}
          <button type="button" class="btn btn-ghost" data-msl-refund title="devolve 1 PA (e 1 PE) — corrige um clique errado">↺ devolver 1 PA</button>
          <span class="mslc-hint">Cada ação gasta PA e PE iguais. 6 PA por rodada, ações e reações do mesmo total. Rodada nova = PA cheios.</span>
        </div>`
            : '<p class="mslc-hint">só o dono do personagem ou o mestre usam as ações.</p>'
        }
        ${ui.msg ? `<div class="mslc-msg">${ui.msg}</div>` : ''}
      </div>`;
  }

  function topButtonsHtml() {
    if (!isMaster) return '';
    return `
      <button type="button" class="btn btn-ghost" data-msl-init-all title="rola 1d20 + Reflexos÷2 (+4 Mãos Rápidas) de todo mundo; empate: maior Agilidade">🎲 iniciativa de todos</button>
      <button type="button" class="btn btn-ghost" data-msl-sort title="ordena a lista pela iniciativa (maior primeiro)">↕ ordenar</button>`;
  }

  function damageHtml() {
    if (!isMaster) return '';
    const L = list();
    if (!ui.dmg.pid || !byId(ui.dmg.pid)) ui.dmg.pid = L[0] ? L[0].id : '';
    return `
      <div class="mslc-dmg">
        <div class="mslc-dmg-head"><b>💥 Aplicar dano</b><span class="mslc-hint">dano bruto − armadura do alvo; rola o d100 do efeito do tipo e aplica a condição</span></div>
        <div class="mslc-dmg-form">
          <label>alvo<select data-msl-f="pid">${L.map((x) => `<option value="${x.id}" ${x.id === ui.dmg.pid ? 'selected' : ''}>${escapeHtml(x.display_name)} (${x.hp_current}/${x.hp_max})</option>`).join('')}</select></label>
          <label>dano<input type="text" data-msl-f="expr" value="${escapeHtml(ui.dmg.expr)}" placeholder="ex: 1d8+3 ou 7"></label>
          <label>tipo<select data-msl-f="type">${DAMAGE_TYPES.map((t) => `<option value="${t.id}" ${ui.dmg.type === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>
          <label>origem<select data-msl-f="origin"><option value="auto" ${ui.dmg.origin === 'auto' ? 'selected' : ''}>automática</option><option value="fisico" ${ui.dmg.origin === 'fisico' ? 'selected' : ''}>física (RF)</option><option value="magico" ${ui.dmg.origin === 'magico' ? 'selected' : ''}>mágica (RM)</option></select></label>
          ${ui.dmg.type === 'luz' ? `<label class="mslc-check"><input type="checkbox" data-msl-f="undead" ${ui.dmg.undead ? 'checked' : ''}> morto-vivo / sombrio (+20%)</label>` : ''}
          <button type="button" class="btn" data-msl-dmg-apply>aplicar</button>
        </div>
        ${ui.dmgLines.length ? `<ul class="mslc-dmg-out">${ui.dmgLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}
      </div>`;
  }

  // ------------------------------------------------------------------ ações
  async function guard(fn) {
    if (ui.busy) return;
    ui.busy = true;
    try {
      await fn();
    } catch (err) {
      ui.msg = '⚠ ' + escapeHtml(err.message || String(err));
    }
    ui.busy = false;
    ctx.rerender();
  }

  async function spend(p, cost, label) {
    await spendAction(p, round(), { cost, label });
    ui.msg = `${escapeHtml(label)}: −${cost} PA. Restam <b>${paOf(p, round())}</b> PA.`;
  }

  async function attack(p, kind) {
    const char = ctx.charForParticipant(p);
    if (!char || !char.system_data) throw new Error('esse participante não tem ficha com Precisão — role o ataque à mão.');
    const key = kind === 'magico' ? 'prec_magica' : 'prec_fisica';
    const name = kind === 'magico' ? 'Precisão Mágica' : 'Precisão Física';
    await spendAction(p, round(), { cost: 2, label: `Atacar (${name})` });
    const mod = attrMod(char, key) + exhPenalty(p, char);
    const row = await rollD20Test(campaignId, userId, p.display_name, mod, `Ataque (${name})`, ui.rollMode);
    const d = derive(char);
    let txt = `Ataque (${name}): d20 <b>${row.kept}</b> ${signed(mod)} = <b>${row.total}</b>${row.kept >= d.critico ? ' · <b>CRÍTICO!</b>' : row.kept === 1 ? ' · falha crítica' : ''}.`;
    const target = isMaster ? byId(ui.atkTarget) : null;
    if (target) {
      const ce = ceOf(target, ctx.charForParticipant(target));
      txt += ` CE de ${escapeHtml(target.display_name)}: ${ce} → ${row.total >= ce || row.kept >= d.critico ? '<b>ACERTOU</b>' : 'errou'}.`;
    } else txt += ' Compare com a CE do alvo.';
    ui.msg = txt + ` Restam ${paOf(p, round())} PA.`;
  }

  async function initAll() {
    const all = list();
    const lines = [];
    for (const p of all) {
      const char = ctx.charOf(p);
      const r = initiativeFor(char);
      const { error } = await supabase.from('combat_participants').update({ initiative: r.total }).eq('id', p.id);
      if (error) throw error;
      p.initiative = r.total;
      lines.push(`${escapeHtml(p.display_name)}: ${r.d}${signed(r.mod)} = ${r.total}`);
    }
    const st = ctx.getState();
    // só reordena se o combate ainda não andou (depois a lista já girou a cada turno)
    if (st.round === 1 && !(st.turns_passed_this_round > 0)) {
      const order = sortByInitiative(all, ctx.charOf);
      order.forEach((id, i) => (byId(id).position = i));
      await reorderParticipants(order);
    }
    ui.msg = `Iniciativas: ${lines.join(' · ')}`;
  }

  async function sortNow() {
    const order = sortByInitiative(list(), ctx.charOf);
    order.forEach((id, i) => (byId(id).position = i));
    await reorderParticipants(order);
    ui.msg = 'Lista ordenada pela iniciativa (empate: maior Agilidade).';
  }

  async function applyDmg() {
    const p = byId(ui.dmg.pid);
    if (!p) throw new Error('escolha um alvo.');
    const r = rollExpr(ui.dmg.expr);
    if (!r) throw new Error('dano inválido — use um número ou dados, como 1d8+3.');
    const rep = await applyDamage(p, ctx.charOf(p), { amount: r.total, type: ui.dmg.type, origin: ui.dmg.origin === 'auto' ? undefined : ui.dmg.origin, undead: ui.dmg.undead });
    ui.dmgLines = [`${p.display_name} sofre ${r.text} = ${r.total}`, ...rep.lines];
    await ctx.reload();
  }

  // ------------------------------------------------------------------ eventos (devolvem true se trataram o clique)
  async function onClick(e) {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-msl-target]'))) {
      ui.targetPid = el.dataset.mslTarget;
      ctx.rerender();
      const box = document.querySelector('.mslc-panel');
      if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return true;
    }
    if ((el = t.closest('[data-msl-mode]'))) {
      ui.rollMode = el.dataset.mslMode;
      ctx.rerender();
      return true;
    }
    const p = panelTarget();
    if ((el = t.closest('[data-msl-spend]')) && p) {
      const [cost, label] = el.dataset.mslSpend.split('|');
      await guard(() => spend(p, parseInt(cost, 10), label));
      return true;
    }
    if ((el = t.closest('[data-msl-attack]')) && p) {
      await guard(() => attack(p, el.dataset.mslAttack));
      return true;
    }
    if (t.closest('[data-msl-dodge]') && p) {
      await guard(async () => {
        const char = ctx.charForParticipant(p);
        const cost = hasAdv(char, 'reflexos_sobre_humanos') ? 1 : 2;
        await spendAction(p, round(), { cost, label: 'Desviar' });
        const vs = ceOf(p, char) + (char && char.system_data ? attrMod(char, 'reflexos') : 0);
        ui.msg = `Desviar (antes da rolagem do atacante): CE contra esse ataque = CE + Reflexos÷2 = <b>${vs}</b>. Restam ${paOf(p, round())} PA.`;
      });
      return true;
    }
    if (t.closest('[data-msl-block]') && p) {
      await guard(async () => {
        const char = ctx.charForParticipant(p);
        await spendAction(p, round(), { cost: 2, label: 'Bloquear' });
        const f = char && char.system_data ? attrMod(char, 'forca') : 0;
        ui.msg = `Bloquear: reduz o dano em <b>${f}</b> (Força÷2) + bloqueio do equipamento (escudo 3, arma 1, desarmado 0). Sem escudo não bloqueia projéteis. Restam ${paOf(p, round())} PA.`;
      });
      return true;
    }
    if (t.closest('[data-msl-exhaust]') && p) {
      await guard(async () => {
        const char = ctx.charForParticipant(p);
        const r = await enterExhaustion(p, round(), char);
        ui.msg = `Agindo exausto: <b>${r.d6}</b> PA nesta rodada (1d6) · exaustão ${r.level} (−${2 * r.level} em testes e CE)${r.fainted ? ' · <b>DESMAIOU</b>' : ''}.`;
      });
      return true;
    }
    if (t.closest('[data-msl-refund]') && p) {
      await guard(async () => {
        await refundAction(p, round(), 1);
        ui.msg = `PA devolvido. Restam <b>${paOf(p, round())}</b>.`;
      });
      return true;
    }
    if (t.closest('[data-msl-init-all]')) {
      await guard(initAll);
      return true;
    }
    if (t.closest('[data-msl-sort]')) {
      await guard(sortNow);
      return true;
    }
    if (t.closest('[data-msl-dmg-apply]')) {
      await guard(applyDmg);
      return true;
    }
    return false;
  }

  function onChange(e) {
    const t = e.target;
    let el;
    if ((el = t.closest('[data-msl-pick]'))) {
      ui.targetPid = el.value;
      ctx.rerender();
      return true;
    }
    if ((el = t.closest('[data-msl-atk-target]'))) {
      ui.atkTarget = el.value;
      return true;
    }
    if ((el = t.closest('[data-msl-f]'))) {
      const k = el.dataset.mslF;
      ui.dmg[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'type') ctx.rerender();
      return true;
    }
    return false;
  }

  // digitar o dano não pode ser perdido por um re-render do realtime
  function onInput(e) {
    const el = e.target.closest && e.target.closest('[data-msl-f="expr"]');
    if (!el) return false;
    ui.dmg.expr = el.value;
    return true;
  }

  // depois de adicionar alguém com iniciativa, no começo do combate, já deixa a lista na ordem certa
  async function autoSort() {
    const st = ctx.getState();
    if (!(st.round === 1 && !(st.turns_passed_this_round > 0)) || !list().some((p) => p.initiative !== null && p.initiative !== undefined)) return;
    const order = sortByInitiative(list(), ctx.charOf);
    if (order.join() === list().map((p) => p.id).join()) return;
    await reorderParticipants(order);
  }

  return { panelHtml, rowBadges, topButtonsHtml, damageHtml, onClick, onChange, onInput, autoSort, basePa };
}
