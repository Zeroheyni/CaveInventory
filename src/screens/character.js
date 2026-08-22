import { supabase } from '../supabaseClient.js';
import { signOut } from '../auth.js';

export function renderCharacterScreen(app, { session, profile, campaign }) {
  const campaignId = campaign.id;
  const userId = session.user.id;

  app.innerHTML = `
<div class="wrap">

  <div class="campaign-strip" id="campaign-strip"></div>

  <div class="header">
    <div>
      <div class="title"><span class="dot"></span><span id="main-title-text">INVENTÁRIO</span></div>
      <div class="id" id="save-status">TERMINAL DE CAMPO // sincronizado</div>
    </div>
    <div style="display:flex; align-items:flex-start; gap:8px;">
      <button class="undo-trigger-btn" id="undo-trigger" title="desfazer última ação (Ctrl+Z)" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/></svg>
        <span class="undo-count-badge" id="undo-count-badge" style="display:none;">0</span>
      </button>
      <div class="log-picker-wrap" id="summary-picker-wrap">
        <button class="theme-trigger-btn" id="summary-trigger" title="ver resumo do inventário">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="4" height="10" rx="1"/><rect x="10" y="6" width="4" height="14" rx="1"/><rect x="16" y="13" width="4" height="7" rx="1"/></svg>
        </button>
        <div class="summary-panel" id="summary-panel" style="display:none;">
          <div class="summary-panel-head">RESUMO</div>
          <div id="summary-content"></div>
        </div>
      </div>
      <div class="log-picker-wrap" id="log-picker-wrap">
        <button class="theme-trigger-btn" id="log-trigger" title="ver log de atividades">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        </button>
        <div class="log-panel" id="log-panel" style="display:none;">
          <div class="log-panel-head">ATIVIDADE RECENTE</div>
          <div id="activity-log-list"></div>
        </div>
      </div>
      <div class="theme-picker-wrap" id="theme-picker-wrap">
        <button class="theme-trigger-btn" id="theme-trigger" title="mudar tema">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3a9 9 0 100 18c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a4 4 0 004-4c0-4.4-3.6-8-8-8z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor" stroke="none"/></svg>
        </button>
        <div class="theme-panel" id="theme-panel" style="display:none;">
          <div class="theme-group-label">ESCUROS</div>
          <div class="theme-swatch-row" data-group="dark"></div>
          <div class="theme-group-label">CLAROS</div>
          <div class="theme-swatch-row" data-group="light"></div>
          <div class="theme-group-label">NEUTROS</div>
          <div class="theme-swatch-row" data-group="neutral"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="currency-wrap" id="currency-wrap" style="display:flex; align-items:flex-start; gap:8px;">
    <button class="currency-strip" id="currency-strip" title="clique para editar suas moedas">
      <span class="coin-badge coin-bronze"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/></svg><b id="coin-bronze-val">0</b></span>
      <span class="coin-badge coin-silver"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1"/></svg><b id="coin-silver-val">0</b></span>
      <span class="coin-badge coin-gold"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="1"/></svg><b id="coin-gold-val">0</b></span>
      <span class="coin-badge coin-platinum"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1"/></svg><b id="coin-platinum-val">0</b></span>
    </button>
    <div class="currency-edit-menu" id="currency-edit-menu" style="display:none;">
      <div class="currency-edit-row"><span class="coin-badge coin-bronze"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-bronze" min="0" step="1" value="0"></div>
      <div class="currency-edit-row"><span class="coin-badge coin-silver"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-silver" min="0" step="1" value="0"></div>
      <div class="currency-edit-row"><span class="coin-badge coin-gold"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-gold" min="0" step="1" value="0"></div>
      <div class="currency-edit-row"><span class="coin-badge coin-platinum"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-platinum" min="0" step="1" value="0"></div>
      <div class="currency-hint">100 bronze = 1 prata · 100 prata = 1 ouro · 100 ouro = 1 platina</div>
      <button class="btn" id="currency-save-btn">salvar</button>
    </div>
    <button class="currency-transfer-btn" id="currency-transfer-btn" title="transferir moedas entre pessoal e público" style="display:none;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7h13M17 4l3 3-3 3"/><path d="M17 17H4M7 20l-3-3 3-3"/></svg>
    </button>
    <div class="currency-transfer-menu" id="currency-transfer-menu" style="display:none;">
      <div class="field" style="margin-bottom:8px;"><label style="font-size:9px;">De</label><select class="transfer-select" id="transfer-from-select"></select></div>
      <div class="field" style="margin-bottom:8px;"><label style="font-size:9px;">Para</label><select class="transfer-select" id="transfer-to-select"></select></div>
      <div class="currency-edit-row"><span class="coin-badge coin-bronze"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="transfer-input-bronze" min="0" step="1" value="0"></div>
      <div class="currency-edit-row"><span class="coin-badge coin-silver"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="transfer-input-silver" min="0" step="1" value="0"></div>
      <div class="currency-edit-row"><span class="coin-badge coin-gold"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="transfer-input-gold" min="0" step="1" value="0"></div>
      <div class="currency-edit-row"><span class="coin-badge coin-platinum"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="transfer-input-platinum" min="0" step="1" value="0"></div>
      <div class="currency-hint">funciona entre Pessoal, Público (avulso) e qualquer compartimento. Se faltar de uma moeda específica, quebra as maiores automaticamente (ex: pedir 150 de bronze com só 1 ouro guardado funciona — o troco sobra sozinho).</div>
      <button class="btn" id="currency-transfer-confirm">transferir</button>
    </div>
  </div>

  <div id="inventory-mode-wrap">
    <div class="gauge-panel" id="gauge-panel-main">
      <div class="gauge-top">
        <span class="gauge-label">CARGA</span>
        <span class="gauge-readout" id="gauge-readout">0 / 60 CARGA</span>
      </div>
      <div class="gauge-track"><div class="gauge-fill" id="gauge-fill" style="width:0%"></div></div>
      <div class="gauge-bottom">
        <div class="gauge-max">
          <label for="max-carga-input">CAPACIDADE MÁX.</label>
          <input type="number" id="max-carga-input" min="0" step="0.5" value="60">
        </div>
        <span class="overload-warn" id="overload-warn">⚠ SOBRECARGA DETECTADA</span>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" data-tab="itens">ITENS</button>
      <button class="tab-btn" data-tab="equipados">EQUIPADOS</button>
    </div>

    <!-- ABA ITENS -->
    <div class="panel active" id="panel-itens">
    <div class="search-toggle-wrap">
      <button class="search-toggle-btn" id="search-toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.5-4.5"/></svg>
        <span>Pesquisar / filtrar</span>
        <span class="search-toggle-count" id="search-toggle-count" style="display:none;"></span>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="search-panel" id="search-panel">
        <div class="search-panel-inner">
          <div class="search-bar">
            <input type="text" id="search-input" placeholder="pesquisar por nome ou tag...">
            <button class="icon-btn search-clear-btn" id="search-clear" title="limpar pesquisa" style="display:none;">✕</button>
          </div>
          <div class="tag-chip-row" id="tag-chip-row"></div>
        </div>
      </div>
    </div>

    <div class="add-trigger-wrap" id="add-trigger-wrap">
      <button class="btn add-trigger-btn" id="add-trigger">+ adicionar</button>
      <div class="add-menu" id="add-menu" style="display:none;">
        <button type="button" data-addmode="item">+ novo item</button>
        <button type="button" data-addmode="container">+ novo recipiente</button>
      </div>
    </div>

    <div class="add-card" id="item-form-wrap" style="display:none;">
      <div class="add-card-head">
        <h3 id="form-title">// REGISTRAR ITEM</h3>
        <button class="icon-btn" id="item-form-close" title="fechar">✕</button>
      </div>
      <div class="form-grid">
        <div class="field"><label for="f-name">Nome</label><input type="text" id="f-name" placeholder="ex: Lanterna de sinal"></div>
        <div class="field"><label for="f-weight">Carga (un.)</label><input type="number" id="f-weight" min="0" step="0.1" value="1"></div>
        <div class="field"><label for="f-qty">Qtd.</label><input type="number" id="f-qty" min="1" step="1" value="1"></div>
      </div>
      <div class="field" style="margin-bottom:6px;"><label>Categoria</label></div>
      <div class="tag-picker" id="item-tag-picker"></div>
      <div class="weapon-stats-form-wrap" id="weapon-stats-form-wrap">
        <div class="field"><label for="f-damage">Dano</label><input type="text" id="f-damage" placeholder="ex: 2d6+1"></div>
        <div class="field"><label for="f-range">Alcance</label><input type="text" id="f-range" placeholder="ex: 30m"></div>
      </div>
      <div class="uses-row">
        <label class="checkbox-wrap"><input type="checkbox" id="f-has-uses"> Consumível / com carga de usos</label>
        <div class="uses-input" id="uses-input-wrap"><input type="number" id="f-uses" min="1" step="1" value="1"><span>usos máx.</span></div>
      </div>
      <div class="uses-row" id="ammo-checkbox-row" style="display:none;">
        <label class="checkbox-wrap"><input type="checkbox" id="f-ammo-linked"> Munição (recarrega consumindo outro item)</label>
      </div>
      <div class="field" id="ammo-select-wrap" style="display:none; margin-bottom:14px;">
        <label for="f-ammo-item">Item de munição</label>
        <select id="f-ammo-item"></select>
      </div>
      <div class="uses-row">
        <label class="checkbox-wrap"><input type="checkbox" id="f-has-durability"> Tem durabilidade</label>
        <div class="uses-input" id="durability-input-wrap">
          <input type="number" id="f-durability-current" min="0" step="1" value="70" style="width:56px;">
          <span>/</span>
          <input type="number" id="f-durability-max" min="1" step="1" value="70" style="width:56px;">
          <span>durabilidade</span>
        </div>
      </div>
      <div class="uses-row">
        <label class="checkbox-wrap"><input type="checkbox" id="f-has-description"> Tem descrição</label>
      </div>
      <textarea id="f-description" class="description-textarea" rows="3" placeholder="Descreva o item..." style="display:none; width:100%; margin-bottom:14px; background:var(--stone-900); border:1px solid var(--stone-line); color:var(--ink); font-family:var(--font-mono); font-size:12.5px; padding:9px 10px; border-radius:5px; resize:vertical;"></textarea>
      <div class="form-actions">
        <button class="btn btn-ghost" id="cancel-edit" style="display:none;">cancelar edição</button>
        <button class="btn" id="submit-item">adicionar item</button>
      </div>
    </div>

    <div class="add-card" id="container-form-wrap" style="display:none;">
      <div class="add-card-head">
        <h3 id="container-form-title">// NOVO RECIPIENTE</h3>
        <button class="icon-btn" id="container-form-close" title="fechar">✕</button>
      </div>
      <div class="form-grid">
        <div class="field"><label for="c-name">Nome</label><input type="text" id="c-name" placeholder="ex: Mochila de couro"></div>
        <div class="field"><label for="c-weight">Carga própria</label><input type="number" id="c-weight" min="0" step="0.1" value="1"></div>
        <div class="field"><label for="c-slots">Slots</label><input type="number" id="c-slots" min="1" step="1" value="4"></div>
      </div>
      <div class="field" style="margin-bottom:6px;"><label>Categoria</label></div>
      <div class="tag-picker" id="container-tag-picker"></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="cancel-container-edit" style="display:none;">cancelar edição</button>
        <button class="btn" id="submit-container">adicionar recipiente</button>
      </div>
    </div>

    <div class="section-hint">Arraste (⋮⋮) para reordenar ou guardar dentro de um recipiente — a carga cai pela metade, arredondada pra baixo, inclusive de recipientes dentro de recipientes. Cada unidade de um item ocupa 1 slot. Sem mouse, use "guardar em" e o ícone de "tirar".</div>

    <div class="unified-list" id="unified-list"></div>
    </div>

    <!-- ABA EQUIPADOS -->
    <div class="panel" id="panel-equipados">
      <div class="add-trigger-wrap" id="slot-trigger-wrap">
        <button class="btn add-trigger-btn" id="slot-trigger">+ adicionar slot de equipamento</button>
      </div>
      <div class="add-card" id="slot-form-wrap" style="display:none;">
        <div class="add-card-head">
          <h3>// NOVO SLOT DE EQUIPAMENTO</h3>
          <button class="icon-btn" id="slot-form-close" title="fechar">✕</button>
        </div>
        <div class="field" style="margin-bottom:12px;"><label for="slot-name-input">Nome do slot</label><input type="text" id="slot-name-input" placeholder="ex: Cintura"></div>
        <div class="field" style="margin-bottom:12px;"><label>Ícone</label><div class="icon-picker" id="icon-picker"></div></div>
        <label class="checkbox-wrap" style="margin-bottom:14px;"><input type="checkbox" id="slot-reduce-input"> Reduz a carga do que for equipado aqui pela metade (como um recipiente)</label>
        <div class="form-actions"><button class="btn" id="submit-slot">adicionar slot</button></div>
      </div>
      <div class="slots-grid" id="slots-grid"></div>
    </div>

    <footer>SISTEMA DE INVENTÁRIO — SINCRONIZADO NA CAMPANHA</footer>
  </div>

  <!-- MODO TRANSPORTE (baú do veículo, inventário à parte) -->
  <div id="transport-mode-wrap" style="display:none;">
    <div class="tabs transport-subtabs">
      <button class="tab-btn transport-subtab-btn active" data-transport-tab="personal">ESPAÇO PESSOAL</button>
    </div>
    <div class="section-hint">A área Pública (baú compartilhado com o grupo) chega na Fase 2b.</div>

    <div class="panel active" id="panel-transport-personal">
      <div class="gauge-panel" id="gauge-panel-personal">
        <div class="gauge-top">
          <span class="gauge-label">CARGA PESSOAL</span>
          <span class="gauge-readout" id="gauge-readout-personal">0 / 100 CARGA</span>
        </div>
        <div class="gauge-track"><div class="gauge-fill" id="gauge-fill-personal" style="width:0%"></div></div>
        <div class="gauge-bottom">
          <div class="gauge-max">
            <label for="max-carga-input-personal">CAPACIDADE MÁX.</label>
            <input type="number" id="max-carga-input-personal" min="0" step="0.5" value="100">
          </div>
          <span class="overload-warn" id="overload-warn-personal">⚠ SOBRECARGA DETECTADA</span>
        </div>
      </div>
      <div class="section-hint">Espaço pessoal — guardado aqui não conta na carga do inventário, não pode ser equipado e não serve de munição pra armas de fora. Use o ícone de mochila pra devolver ao inventário, ou o ícone de troca pra mover pro Público.</div>
      <div class="unified-list" id="transport-personal-list"></div>
    </div>

    <div class="panel" id="panel-transport-public">
      <div class="currency-wrap" id="currency-wrap-public">
        <button class="currency-strip" id="currency-strip-public" title="clique para editar as moedas do público">
          <span class="coin-badge coin-bronze"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/></svg><b id="coin-bronze-val-public">0</b></span>
          <span class="coin-badge coin-silver"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1"/></svg><b id="coin-silver-val-public">0</b></span>
          <span class="coin-badge coin-gold"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="1"/></svg><b id="coin-gold-val-public">0</b></span>
          <span class="coin-badge coin-platinum"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1"/></svg><b id="coin-platinum-val-public">0</b></span>
        </button>
        <div class="currency-edit-menu" id="currency-edit-menu-public" style="display:none;">
          <div class="currency-edit-row"><span class="coin-badge coin-bronze"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-bronze-public" min="0" step="1" value="0"></div>
          <div class="currency-edit-row"><span class="coin-badge coin-silver"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-silver-public" min="0" step="1" value="0"></div>
          <div class="currency-edit-row"><span class="coin-badge coin-gold"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-gold-public" min="0" step="1" value="0"></div>
          <div class="currency-edit-row"><span class="coin-badge coin-platinum"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg></span><input type="number" id="currency-input-platinum-public" min="0" step="1" value="0"></div>
          <div class="currency-hint">100 bronze = 1 prata · 100 prata = 1 ouro · 100 ouro = 1 platina<br>o número mostrado na faixa é a soma de tudo (avulso + compartimentos). Aqui você edita só a parte avulsa.</div>
          <button class="btn" id="currency-save-btn-public">salvar</button>
        </div>
      </div>
      <div class="gauge-panel" id="gauge-panel-public">
        <div class="gauge-top">
          <span class="gauge-label">CARGA PÚBLICA</span>
          <span class="gauge-readout" id="gauge-readout-public">0 / 50 CARGA</span>
        </div>
        <div class="gauge-track"><div class="gauge-fill" id="gauge-fill-public" style="width:0%"></div></div>
        <div class="gauge-bottom">
          <div class="gauge-max">
            <label for="max-carga-input-public">CAPACIDADE MÁX.</label>
            <input type="number" id="max-carga-input-public" min="0" step="0.5" value="50">
          </div>
          <span class="overload-warn" id="overload-warn-public">⚠ SOBRECARGA DETECTADA</span>
        </div>
      </div>
      <div class="section-hint">Espaço público — carga própria, separada do pessoal. Use o ícone de troca em um item pra movê-lo de volta pro Espaço Pessoal, ou a mochila pra devolver direto ao inventário.</div>

      <div class="add-trigger-wrap" id="compartment-trigger-wrap">
        <button class="btn add-trigger-btn" id="compartment-trigger">+ novo compartimento</button>
      </div>
      <div class="add-card" id="compartment-form-wrap" style="display:none;">
        <div class="add-card-head">
          <h3>// NOVO COMPARTIMENTO</h3>
          <button class="icon-btn" id="compartment-form-close" title="fechar">✕</button>
        </div>
        <div class="field" style="margin-bottom:14px;"><label for="compartment-name-input">Nome</label><input type="text" id="compartment-name-input" placeholder="ex: Ala médica"></div>
        <div class="form-actions"><button class="btn" id="compartment-submit-btn">criar compartimento</button></div>
      </div>
      <div id="compartments-list"></div>

      <div class="unified-list" id="transport-public-list"></div>
    </div>

    <footer>BAÚ DO VEÍCULO — SEPARADO DO INVENTÁRIO PRINCIPAL</footer>
  </div>
</div>

<button class="vehicle-dropzone" id="vehicle-dropzone" title="arraste um item aqui para guardar no veículo, sem peso">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 9V7a2 2 0 012-2h8a2 2 0 012 2v2"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/><path d="M9.5 12h1.5M13 12h1.5"/></svg>
</button>
<button class="vehicle-dropzone" id="backpack-return-btn" title="voltar pro inventário" style="display:none;">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 8V6a5 5 0 0110 0v2"/><rect x="5" y="8" width="14" height="13" rx="2"/><rect x="9.5" y="12" width="5" height="4" rx="1"/></svg>
</button>

<div class="copy-fab-wrap">
  <div class="copy-feedback" id="copy-feedback">COPIADO!</div>
  <button class="copy-fab" id="copy-fab" title="copiar inventário para a área de transferência">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H6a2 2 0 00-2 2v11a2 2 0 002 2h2"/></svg>
  </button>
</div>

<div class="selection-bar" id="selection-bar" style="display:none;">
  <span class="selection-count" id="selection-count">0 selecionados</span>
  <button class="selection-btn" data-batch-move="top">→ Inventário</button>
  <button class="selection-btn" data-batch-move="transport-personal">→ Pessoal</button>
  <button class="selection-btn danger" id="batch-delete-btn">Excluir</button>
  <button class="selection-btn cancel-btn" id="batch-cancel-btn">✕</button>
</div>

`;

  document.body.style.pointerEvents = 'none';
  document.body.style.opacity = '0.55';
  document.body.style.transition = 'opacity 0.25s ease';

  const ICONS = {
    mao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11.5V6a1.5 1.5 0 013 0v7M17 12v-2a1.5 1.5 0 013 0v5c0 3.5-2.5 6-6 6h-2c-3 0-4.5-1-6-3l-2.7-4a1.4 1.4 0 012-2L8 14"/></svg>',
    vestindo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 4l4 2 4-2 4 3-2 3-2-1v10H8V9L6 10 4 7z"/></svg>',
    bolso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 8h14l-1 11a2 2 0 01-2 2H8a2 2 0 01-2-2L5 8z"/><path d="M8 8V6a4 4 0 018 0v2"/></svg>',
    cabeca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 13a8 8 0 0116 0v3H4v-3z"/><path d="M4 16h16v2H4z"/></svg>',
    acessorios: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></svg>',
    costas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="6" width="14" height="15" rx="2"/><path d="M9 6V4a3 3 0 016 0v2"/></svg>',
    calca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 3h10l1 6-1 12h-3.5l-1.2-10L11 21H7.5L6 9z"/></svg>',
    colar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 4c0 6.5 3.5 11 7 11s7-4.5 7-11"/><circle cx="12" cy="17" r="2.2"/></svg>',
    pes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3v9c0 1-1 2-3 3.5S4 18 4 19.5c0 .8.7 1.5 1.5 1.5H14a2 2 0 002-2v-3l3-2a2 2 0 000-3l-3-2V3z"/></svg>',
    cinto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="10" width="19" height="4.5" rx="1"/><rect x="9.5" y="8.5" width="5" height="7.5" rx="1.2"/></svg>',
    rosto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.2"/><circle cx="9" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none"/><path d="M8.7 15c1 1 2.1 1.5 3.3 1.5s2.3-.5 3.3-1.5"/></svg>'
  };

  const TAG_ICONS = {
    arma: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20l9-9"/><path d="M13 11l4-4 3 3-4 4"/><path d="M14 6l3-3"/><path d="M17 3l1 1"/></svg>',
    bolsa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 9c0-3 1.8-5 4-5s4 2 4 5"/><path d="M6 9h12l1 10a2 2 0 01-2 2H7a2 2 0 01-2-2z"/></svg>',
    vestimenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 4l4 2 4-2 4 3-2 3-2-1v10H8V9L6 10 4 7z"/></svg>',
    alimento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 8c-3 0-5 2.2-5 5.3 0 3 2 6.2 5 6.2s5-3.2 5-6.2C17 10.2 15 8 12 8z"/><path d="M12 8c0-2 1-3 2.5-3.3"/><path d="M11 5.5c-.8-1-2-1.3-3-1"/></svg>',
    pocao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3h4v4l4 8a3 3 0 01-3 4H9a3 3 0 01-3-4l4-8z"/><path d="M9 3h6"/><path d="M8.5 14h7"/></svg>',
    ferramenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 005.4-5.4l-2.3 2.3-2-2z"/></svg>',
    material: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 14l4-9 8 2 4 7-6 6z"/></svg>',
    acessorio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="14" r="5"/><path d="M9 9l3-6 3 6"/></svg>',
    municao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l3 3v9a3 3 0 01-6 0V6z"/><path d="M9 9h6"/></svg>',
    consumivel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="3" width="6" height="18" rx="2"/><path d="M9 10h6"/><path d="M12 7v6"/></svg>',
    quest: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l2.5 6.5L21 10l-5 4.5L17.5 21 12 17l-5.5 4L8 14.5 3 10l6.5-.5z"/></svg>',
    recipiente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 8l9-4 9 4-9 4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/></svg>',
    tesouro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="9" rx="1.5"/><path d="M4 10a8 4 0 0116 0"/><path d="M9 14h6"/></svg>',
    outro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/></svg>'
  };

  const TAGS = {
    arma:{label:'Arma', emoji:'⚔️'},
    bolsa:{label:'Bolsa', emoji:'🎒'},
    vestimenta:{label:'Vestimenta', emoji:'🛡️'},
    alimento:{label:'Alimento', emoji:'🍞'},
    pocao:{label:'Poção', emoji:'🧪'},
    ferramenta:{label:'Ferramenta', emoji:'🛠️'},
    material:{label:'Material', emoji:'🧱'},
    acessorio:{label:'Acessório', emoji:'💍'},
    municao:{label:'Munição', emoji:'🎯'},
    consumivel:{label:'Consumível', emoji:'💊'},
    quest:{label:'Quest', emoji:'⭐'},
    recipiente:{label:'Recipiente', emoji:'📦'},
    tesouro:{label:'Tesouro', emoji:'💰'},
    outro:{label:'Outros', emoji:'❔'}
  };
  const TAG_ORDER = ['arma','vestimenta','acessorio','alimento','pocao','consumivel','ferramenta','material','municao','quest','tesouro','recipiente','bolsa','outro'];

  const THEMES = [
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

    {id:'cinza-grafite', label:'Cinza Grafite', group:'neutral', accent:'#9db4c7', void:'#202226'},
    {id:'bege-militar', label:'Bege Militar', group:'neutral', accent:'#c9b878', void:'#2b2a22'},
    {id:'aco-frio', label:'Aço Frio', group:'neutral', accent:'#7fb0d6', void:'#21252b'},
    {id:'terracota', label:'Terracota Neutro', group:'neutral', accent:'#d99a72', void:'#2b2420'},
    {id:'musgo-neutro', label:'Musgo Neutro', group:'neutral', accent:'#a8c46e', void:'#242820'},
    {id:'ardosia', label:'Ardósia', group:'neutral', accent:'#7fa3c4', void:'#1e2226'},
    {id:'argila', label:'Argila', group:'neutral', accent:'#c67f52', void:'#28211d'},
    {id:'chumbo', label:'Chumbo', group:'neutral', accent:'#a08fc4', void:'#212024'},
    {id:'areia-neutra', label:'Areia Neutra', group:'neutral', accent:'#d4b56a', void:'#2b2820'},
    {id:'ametista-neutra', label:'Ametista Neutra', group:'neutral', accent:'#b98fd6', void:'#241f28'}
  ];

  let characterId = null;
  let characterName = 'Personagem';

  let state = {
    maxCarga: 60, transportPersonalMaxCarga: 100, transportPublicMaxCarga: 50, theme: 'caverna-azul',
    currency: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
    currencyPublic: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
    compartments: [],
    items: [],
    containers: [],
    order: [],
    transportPersonal: [],
    transportPublic: [],
    equipSlots: [
      {key:'mao', label:'MÃO', icon:'mao', reduceWeight:false},
      {key:'vestindo', label:'VESTINDO', icon:'vestindo', reduceWeight:false},
      {key:'bolso', label:'BOLSO', icon:'bolso', reduceWeight:false},
      {key:'cabeca', label:'CABEÇA', icon:'cabeca', reduceWeight:false},
      {key:'acessorios', label:'ACESSÓRIOS', icon:'acessorios', reduceWeight:false},
      {key:'costas', label:'COSTAS', icon:'costas', reduceWeight:false}
    ],
    equip: {mao:'', vestindo:'', bolso:'', cabeca:'', acessorios:'', costas:''}
  };

  let editingId = null;
  let editingContainerId = null;
  let selectedIconKey = 'mao';
  let selectedItemTag = 'outro';
  let selectedContainerTag = 'bolsa';
  let saveTimer = null;
  let dragSource = null;
  let openMenuFor = null;
  let durabilityEditFor = null;
  const expandedDescriptions = new Set();
  let ammoPickerOpenFor = null;
  let equipSearchOpenFor = null;
  let equipSearchQuery = '';
  let addMode = null;
  let slotFormOpen = false;
  let searchQuery = '';
  let currentMode = 'inventory'; // 'inventory' | 'transport'
  let compCurrencyEditFor = null;
  let renamingCompartmentId = null;
  const confirmingDeletes = new Set();
  const selectedEntries = new Set(); // chaves "item:ID" / "container:ID" selecionadas com Ctrl+clique
  let undoStack = [];
  const UNDO_LIMIT = 30;
  let activityLog = [];
  const ACTIVITY_LOG_LIMIT = 60;
  let activeTagFilter = null;

  async function loadState(){
    const { data: rows } = await supabase
      .from('characters')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('owner_id', userId)
      .limit(1);
    let row = rows && rows[0];
    if(!row){
      const { data: created } = await supabase
        .from('characters')
        .insert({
          campaign_id: campaignId,
          owner_id: userId,
          data: {
            items: [], containers: [], order: [],
            equipSlots: state.equipSlots, equip: state.equip,
            transportPersonal: [], transportPersonalMaxCarga: 100,
            transportPublic: [], transportPublicMaxCarga: 50,
            currencyPublic: { bronze:0, silver:0, gold:0, platinum:0 },
            compartments: [], theme: 'caverna-azul'
          }
        })
        .select()
        .single();
      row = created;
    }
    characterId = row.id;
    characterName = row.name || 'Personagem';
    const d = row.data || {};

    state.items = Array.isArray(d.items) ? d.items : [];
    state.containers = Array.isArray(d.containers) ? d.containers : [];
    state.order = Array.isArray(d.order) ? d.order : [];
    state.equipSlots = Array.isArray(d.equipSlots) ? d.equipSlots : state.equipSlots;
    state.equip = (d.equip && typeof d.equip === 'object') ? d.equip : state.equip;
    state.transportPersonal = Array.isArray(d.transportPersonal) ? d.transportPersonal : [];
    state.transportPublic = Array.isArray(d.transportPublic) ? d.transportPublic : [];
    state.transportPersonalMaxCarga = d.transportPersonalMaxCarga !== undefined ? d.transportPersonalMaxCarga : 100;
    state.transportPublicMaxCarga = d.transportPublicMaxCarga !== undefined ? d.transportPublicMaxCarga : 50;
    state.compartments = Array.isArray(d.compartments) ? d.compartments : [];
    state.currencyPublic = (d.currencyPublic && typeof d.currencyPublic === 'object') ? d.currencyPublic : { bronze:0, silver:0, gold:0, platinum:0 };
    state.theme = d.theme || 'caverna-azul';
    state.maxCarga = (row.max_carga !== undefined && row.max_carga !== null) ? row.max_carga : 60;
    state.currency = (row.currency && typeof row.currency === 'object') ? row.currency : { bronze:0, silver:0, gold:0, platinum:0 };

    ['bronze','silver','gold','platinum'].forEach(k => { if(typeof state.currency[k] !== 'number' || isNaN(state.currency[k])) state.currency[k] = 0; });
    ['bronze','silver','gold','platinum'].forEach(k => { if(typeof state.currencyPublic[k] !== 'number' || isNaN(state.currencyPublic[k])) state.currencyPublic[k] = 0; });
    state.compartments.forEach(comp => {
      if(comp.collapsed === undefined) comp.collapsed = false;
      if(!Array.isArray(comp.contents)) comp.contents = [];
      if(!comp.currency || typeof comp.currency !== 'object') comp.currency = { bronze:0, silver:0, gold:0, platinum:0 };
      ['bronze','silver','gold','platinum'].forEach(k => { if(typeof comp.currency[k] !== 'number' || isNaN(comp.currency[k])) comp.currency[k] = 0; });
    });
    state.items.forEach(it => {
      if(!it.tag) it.tag = 'outro';
      if(it.durability === undefined) it.durability = null;
      if(it.maxDurability === undefined) it.maxDurability = null;
      if(it.description === undefined) it.description = null;
      if(it.ammoLinked === undefined) it.ammoLinked = false;
      if(it.ammoItemId === undefined) it.ammoItemId = null;
      if(it.pinned === undefined) it.pinned = false;
      if(it.damage === undefined) it.damage = null;
      if(it.range === undefined) it.range = null;
    });
    state.containers.forEach(c => {
      if(c.collapsed === undefined) c.collapsed = false;
      if(!c.tag) c.tag = 'bolsa';
      if(!Array.isArray(c.contents)) c.contents = [];
      c.contents = c.contents.map(entry => typeof entry === 'string' ? {type:'item', id: entry} : entry);
    });
    state.equipSlots.forEach(s => { if(!(s.key in state.equip)) state.equip[s.key] = ''; if(s.reduceWeight === undefined) s.reduceWeight = false; });
    Object.keys(state.equip).forEach(k => { const v = state.equip[k]; if(v && typeof v === 'string' && v.indexOf(':') === -1){ state.equip[k] = 'item:' + v; } });

    applyTheme(state.theme, false);
    renderAll();
    renderCampaignStrip();

    document.body.style.pointerEvents = '';
    document.body.style.opacity = '';
  }

  function saveState(){
    const statusEl = document.getElementById('save-status');
    if(statusEl) statusEl.textContent = 'TERMINAL DE CAMPO // gravando...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async ()=>{
      try{
        await supabase.from('characters').update({
          data: {
            items: state.items, containers: state.containers, order: state.order,
            equipSlots: state.equipSlots, equip: state.equip,
            transportPersonal: state.transportPersonal, transportPersonalMaxCarga: state.transportPersonalMaxCarga,
            transportPublic: state.transportPublic, transportPublicMaxCarga: state.transportPublicMaxCarga,
            currencyPublic: state.currencyPublic, compartments: state.compartments,
            theme: state.theme
          },
          currency: state.currency,
          max_carga: state.maxCarga,
          name: characterName,
          updated_at: new Date().toISOString(),
        }).eq('id', characterId);
        if(statusEl) statusEl.textContent = 'TERMINAL DE CAMPO // sincronizado';
      }catch(e){ console.error('falha ao salvar', e); if(statusEl) statusEl.textContent = 'TERMINAL DE CAMPO // erro ao gravar'; }
    }, 300);
  }
  function flashStatus(msg){
    const el = document.getElementById('save-status');
    if(!el) return;
    el.textContent = 'TERMINAL DE CAMPO // ' + msg;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{ el.textContent = 'TERMINAL DE CAMPO // sincronizado'; saveState(); }, 1800);
  }
  function uid(){ return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function round(n){ return Math.round(n * 100) / 100; }
  function escapeHtml(str){ const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  // ---- faixa da campanha (nome da campanha, personagem, papel, sair) ----
  function renderCampaignStrip(){
    const el = document.getElementById('campaign-strip');
    if(!el) return;
    el.innerHTML = `
      <div class="campaign-strip-left">
        <span class="campaign-strip-item"><b>${escapeHtml(campaign.name)}</b></span>
        <span class="campaign-strip-sep">·</span>
        <span class="campaign-strip-item">${profile.role === 'master' ? 'MESTRE' : 'JOGADOR'}</span>
        <span class="campaign-strip-sep">·</span>
        <button type="button" class="campaign-strip-name-btn" id="character-name-btn" title="renomear personagem">${escapeHtml(characterName)} ✎</button>
      </div>
      <button type="button" class="campaign-strip-signout" id="campaign-signout-btn">sair</button>
    `;
    document.getElementById('character-name-btn').addEventListener('click', ()=>{
      const next = window.prompt('Nome do personagem', characterName);
      if(next && next.trim() && next.trim() !== characterName){
        characterName = next.trim();
        renderCampaignStrip();
        addLog(`Personagem renomeado para "${characterName}"`);
        saveState();
      }
    });
    document.getElementById('campaign-signout-btn').addEventListener('click', async ()=>{
      await signOut();
      window.location.reload();
    });
  }

  // ---- estrutura / hierarquia ----
  function findItemContainer(itemId){ return state.containers.find(c => c.contents.some(e => e.type === 'item' && e.id === itemId)) || null; }
  function findParentContainer(type, id){ return state.containers.find(c => c.contents.some(e => e.type === type && e.id === id)) || null; }
  function collectDescendantContainerIds(containerId, acc){
    acc = acc || [];
    const c = state.containers.find(c => c.id === containerId);
    if(!c) return acc;
    c.contents.forEach(e => { if(e.type === 'container'){ acc.push(e.id); collectDescendantContainerIds(e.id, acc); } });
    return acc;
  }
  function wouldCreateCycle(draggedContainerId, targetContainerId){
    if(draggedContainerId === targetContainerId) return true;
    return collectDescendantContainerIds(draggedContainerId).includes(targetContainerId);
  }

  // ---- slots (quantidade-consciente) ----
  function entrySlotCost(type, id){
    if(type === 'item'){ const it = state.items.find(i => i.id === id); return it ? it.qty : 0; }
    return 1;
  }
  function containerUsedSlots(c){
    return c.contents.reduce((sum, entry) => sum + entrySlotCost(entry.type, entry.id), 0);
  }

  // ---- cálculos de carga ----
  function isEquippedInReducingSlot(type, id){
    const val = type + ':' + id;
    return state.equipSlots.some(s => s.reduceWeight && state.equip[s.key] === val);
  }
  function applyEquipReduction(weight, type, id){ return isEquippedInReducingSlot(type, id) ? Math.floor(weight / 2) : weight; }
  function effectiveUnitWeight(item){
    let w = item.weight;
    if(findItemContainer(item.id)) w = Math.floor(w / 2);
    w = applyEquipReduction(w, 'item', item.id);
    return w;
  }
  function itemSubtotal(item){ return effectiveUnitWeight(item) * item.qty; }
  function containerIntrinsicTotal(c){
    let total = c.ownWeight;
    c.contents.forEach(entry => {
      if(entry.type === 'item'){ const it = state.items.find(i => i.id === entry.id); if(it) total += itemSubtotal(it); }
      else if(entry.type === 'container'){
        const nested = state.containers.find(cc => cc.id === entry.id);
        if(nested){ let contrib = Math.floor(containerIntrinsicTotal(nested) / 2); contrib = applyEquipReduction(contrib, 'container', nested.id); total += contrib; }
      }
    });
    return total;
  }
  function totalWeight(){
    return state.order.reduce((sum, entry) => {
      if(entry.type === 'item'){ const it = state.items.find(i => i.id === entry.id); return sum + (it ? itemSubtotal(it) : 0); }
      const c = state.containers.find(c => c.id === entry.id);
      if(!c) return sum;
      return sum + applyEquipReduction(containerIntrinsicTotal(c), 'container', c.id);
    }, 0);
  }
  function transportListWeight(list){
    // itens no transporte não são equipáveis, então não há redução por equip a considerar aqui
    return list.reduce((sum, entry) => {
      if(entry.type === 'item'){ const it = state.items.find(i => i.id === entry.id); return sum + (it ? itemSubtotal(it) : 0); }
      const c = state.containers.find(c => c.id === entry.id);
      return c ? sum + containerIntrinsicTotal(c) : sum;
    }, 0);
  }
  function compartmentWeight(comp){
    // itens dentro do compartimento pesam normal (cheio) — o compartimento não reduz carga, só organiza
    return transportListWeight(comp.contents);
  }
  function publicTotalWeight(){
    return transportListWeight(state.transportPublic) + state.compartments.reduce((sum, comp) => sum + compartmentWeight(comp), 0);
  }

  function renderGauge(){
    const total = totalWeight();
    const max = state.maxCarga || 0;
    const pct = max > 0 ? Math.min(100, (total/max)*100) : 0;
    const over = total > max;
    document.getElementById('gauge-fill').style.width = pct + '%';
    document.getElementById('gauge-fill').classList.toggle('over', over);
    document.getElementById('gauge-readout').classList.toggle('over', over);
    document.getElementById('gauge-readout').textContent = round(total) + ' / ' + round(max) + ' CARGA';
    document.getElementById('overload-warn').classList.toggle('show', over);
    document.getElementById('max-carga-input').value = state.maxCarga;
    const panelEl = document.getElementById('gauge-panel-main');
    if(panelEl) panelEl.classList.toggle('over-limit', over);
  }
  function renderTransportSubGauge(total, maxCarga, suffix){
    const max = maxCarga || 0;
    const pct = max > 0 ? Math.min(100, (total/max)*100) : 0;
    const over = total > max;
    document.getElementById('gauge-fill-' + suffix).style.width = pct + '%';
    document.getElementById('gauge-fill-' + suffix).classList.toggle('over', over);
    document.getElementById('gauge-readout-' + suffix).classList.toggle('over', over);
    document.getElementById('gauge-readout-' + suffix).textContent = round(total) + ' / ' + round(max) + ' CARGA';
    document.getElementById('overload-warn-' + suffix).classList.toggle('show', over);
    document.getElementById('max-carga-input-' + suffix).value = maxCarga;
    const panelEl = document.getElementById('gauge-panel-' + suffix);
    if(panelEl) panelEl.classList.toggle('over-limit', over);
  }
  function renderTransportGauge(){
    renderTransportSubGauge(transportListWeight(state.transportPersonal), state.transportPersonalMaxCarga, 'personal');
    renderTransportSubGauge(publicTotalWeight(), state.transportPublicMaxCarga, 'public');
  }

  // ---- moedas (bronze -> prata -> ouro -> platina, base 100) ----
  function normalizeCurrencyObj(c){
    ['bronze','silver','gold','platinum'].forEach(k => { if(c[k] < 0) c[k] = 0; });
    c.silver += Math.floor(c.bronze / 100); c.bronze = c.bronze % 100;
    c.gold += Math.floor(c.silver / 100); c.silver = c.silver % 100;
    c.platinum += Math.floor(c.gold / 100); c.gold = c.gold % 100;
  }
  function renderCurrencyObj(c, suffix){
    document.getElementById('coin-bronze-val' + suffix).textContent = c.bronze;
    document.getElementById('coin-silver-val' + suffix).textContent = c.silver;
    document.getElementById('coin-gold-val' + suffix).textContent = c.gold;
    document.getElementById('coin-platinum-val' + suffix).textContent = c.platinum;
  }
  function publicCurrencyTotal(){
    const total = { bronze:0, silver:0, gold:0, platinum:0 };
    ['bronze','silver','gold','platinum'].forEach(k => { total[k] += state.currencyPublic[k]; });
    state.compartments.forEach(comp => { ['bronze','silver','gold','platinum'].forEach(k => { total[k] += comp.currency[k]; }); });
    normalizeCurrencyObj(total);
    return total;
  }
  function renderCurrency(){
    renderCurrencyObj(state.currency, '');
    renderCurrencyObj(publicCurrencyTotal(), '-public');
  }

  // ---- movimentação ----
  function resolveList(listKey){
    if(listKey === 'top') return state.order;
    if(listKey === 'transport-personal') return state.transportPersonal;
    if(listKey === 'transport-public') return state.transportPublic;
    const comp = state.compartments.find(c => c.id === listKey);
    if(comp) return comp.contents;
    const c = state.containers.find(c => c.id === listKey);
    return c ? c.contents : [];
  }
  function currentTopLevelHome(type, id){
    let curType = type, curId = id;
    while(true){
      const parent = findParentContainer(curType, curId);
      if(!parent) break;
      curType = 'container'; curId = parent.id;
    }
    if(state.transportPersonal.some(e => e.type === curType && e.id === curId)) return state.transportPersonal;
    if(state.transportPublic.some(e => e.type === curType && e.id === curId)) return state.transportPublic;
    for(const comp of state.compartments){
      if(comp.contents.some(e => e.type === curType && e.id === curId)) return comp.contents;
    }
    return state.order;
  }
  function getWorld(type, id){
    const home = currentTopLevelHome(type, id);
    if(home === state.transportPersonal) return 'personal';
    if(home === state.transportPublic) return 'public';
    if(state.compartments.some(comp => comp.contents === home)) return 'public'; // compartimentos são parte do mundo público
    return 'main';
  }
  function isInTransport(type, id){
    return getWorld(type, id) !== 'main';
  }
  function collectSubtreeAll(type, id, acc){
    acc = acc || [];
    acc.push({type, id});
    if(type === 'container'){
      const c = state.containers.find(c => c.id === id);
      if(c) c.contents.forEach(e => collectSubtreeAll(e.type, e.id, acc));
    }
    return acc;
  }
  function clearEquipForSubtree(type, id){
    collectSubtreeAll(type, id).forEach(en => {
      const val = en.type + ':' + en.id;
      Object.keys(state.equip).forEach(k => { if(state.equip[k] === val) state.equip[k] = ''; });
    });
  }
  function sanitizeAmmoLinks(){
    state.items.forEach(it => {
      if(it.ammoLinked && it.ammoItemId){
        const ammoItem = state.items.find(i => i.id === it.ammoItemId);
        if(!ammoItem || getWorld('item', it.id) !== getWorld('item', ammoItem.id)){
          it.ammoLinked = false; it.ammoItemId = null;
        }
      }
    });
  }
  function removeFromEverywhere(type, id){
    state.order = state.order.filter(e => !(e.type === type && e.id === id));
    state.transportPersonal = state.transportPersonal.filter(e => !(e.type === type && e.id === id));
    state.transportPublic = state.transportPublic.filter(e => !(e.type === type && e.id === id));
    state.containers.forEach(c => { c.contents = c.contents.filter(e => !(e.type === type && e.id === id)); });
  }
  function moveTopLevel(type, id, dir){
    const idx = state.order.findIndex(e => e.type === type && e.id === id);
    if(idx === -1) return;
    const newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= state.order.length) return;
    const tmp = state.order[idx]; state.order[idx] = state.order[newIdx]; state.order[newIdx] = tmp;
  }
  function moveNested(containerId, type, id, dir){
    const c = state.containers.find(c => c.id === containerId);
    if(!c) return;
    const idx = c.contents.findIndex(e => e.type === type && e.id === id);
    if(idx === -1) return;
    const newIdx = idx + dir;
    if(newIdx < 0 || newIdx >= c.contents.length) return;
    const tmp = c.contents[idx]; c.contents[idx] = c.contents[newIdx]; c.contents[newIdx] = tmp;
  }
  function insertIntoContainerEnd(containerId, type, id){
    const c = state.containers.find(c => c.id === containerId);
    if(!c) return false;
    if(containerUsedSlots(c) + entrySlotCost(type, id) > c.maxSlots) return false;
    c.contents.push({type, id});
    return true;
  }
  function extractEntry(parentId, type, id){
    const parent = state.containers.find(c => c.id === parentId);
    if(parent){
      parent.contents = parent.contents.filter(e => !(e.type === type && e.id === id));
      const grandParent = findParentContainer('container', parentId);
      if(grandParent){ grandParent.contents.push({type, id}); return; }
      currentTopLevelHome('container', parentId).push({type, id});
      return;
    }
    const comp = state.compartments.find(c => c.id === parentId);
    if(comp){
      comp.contents = comp.contents.filter(e => !(e.type === type && e.id === id));
      state.transportPublic.push({type, id}); // sai do compartimento pro público solto
    }
  }
  function removeContainer(id){
    const c = state.containers.find(c => c.id === id);
    if(!c) return;
    const parentContainer = findParentContainer('container', id);
    const destList = parentContainer ? parentContainer.contents : currentTopLevelHome('container', id);
    c.contents.forEach(entry => destList.push(entry));
    removeFromEverywhere('container', id);
    state.containers = state.containers.filter(cc => cc.id !== id);
    const val = 'container:' + id;
    Object.keys(state.equip).forEach(k => { if(state.equip[k] === val) state.equip[k] = ''; });
  }

  // ---- ícones ----
  function renderIconPicker(){
    const wrap = document.getElementById('icon-picker');
    wrap.innerHTML = Object.keys(ICONS).map(k => `<button type="button" class="icon-pick-btn ${k === selectedIconKey ? 'selected' : ''}" data-icon="${k}" title="${k}">${ICONS[k]}</button>`).join('');
  }
  function renderTagPicker(containerId, selectedTag){
    const wrap = document.getElementById(containerId);
    if(!wrap) return;
    wrap.innerHTML = TAG_ORDER.map(k => `<button type="button" class="tag-pick-btn ${k === selectedTag ? 'selected' : ''}" data-tag="${k}">${TAG_ICONS[k]}<span>${TAGS[k].label}</span></button>`).join('');
  }

  // ---- guardar-menu genérico ----
  function renderGuardarMenu(type, id){
    if(state.containers.length === 0) return '';
    const sourceWorld = getWorld(type, id);
    const available = state.containers.filter(c => {
      if(getWorld('container', c.id) !== sourceWorld) return false; // não cruza inventário <-> pessoal <-> público
      if(type === 'container'){ if(c.id === id) return false; if(collectDescendantContainerIds(id).includes(c.id)) return false; }
      return true;
    });
    if(available.length === 0) return '';
    const menuKey = type + ':' + id;
    const menuOpen = openMenuFor === menuKey;
    const cost = entrySlotCost(type, id);
    const options = available.map(c => {
      const full = containerUsedSlots(c) + cost > c.maxSlots;
      return `<button data-guardaraction data-guardar-type="${type}" data-guardar-id="${id}" data-container-id="${c.id}" ${full ? 'disabled' : ''}>${escapeHtml(c.name)}${full ? ' (cheio)' : ''}</button>`;
    }).join('');
    return `<div class="guardar-menu-wrap"><button class="guardar-btn" data-toggle-menu="${menuKey}">guardar em ▾</button>${menuOpen ? `<div class="guardar-menu">${options}</div>` : ''}</div>`;
  }

  // ---- filtro / busca ----
  function passesFilter(name, tag){
    const q = searchQuery.trim().toLowerCase();
    let matchQuery = true;
    if(q){
      const tagLabel = (TAGS[tag]||TAGS.outro).label.toLowerCase();
      matchQuery = name.toLowerCase().includes(q) || tagLabel.includes(q) || (tag||'').toLowerCase().includes(q);
    }
    let matchTag = true;
    if(activeTagFilter) matchTag = tag === activeTagFilter;
    return matchQuery && matchTag;
  }
  function isFilterActive(){ return !!(searchQuery.trim() || activeTagFilter); }
  function isEntryVisible(entry){
    if(!isFilterActive()) return true;
    if(entry.type === 'item'){ const it = state.items.find(i => i.id === entry.id); return it ? passesFilter(it.name, it.tag) : false; }
    const c = state.containers.find(c => c.id === entry.id);
    if(!c) return false;
    if(passesFilter(c.name, c.tag)) return true;
    return c.contents.some(isEntryVisible);
  }

  // ---- classe de borda do item (saúde / munição) ----
  function sortPinnedFirst(entries){
    return entries
      .map((e, i) => ({ e, i, pinned: e.type === 'item' && !!(state.items.find(it => it.id === e.id) || {}).pinned }))
      .sort((a, b) => (a.pinned === b.pinned) ? a.i - b.i : (a.pinned ? -1 : 1))
      .map(x => x.e);
  }

  function itemBorderClass(it){
    if(it.qty <= 0) return 'qty-zero';
    if(it.maxDurability !== null && it.maxDurability !== undefined){
      const pct = it.maxDurability > 0 ? (it.durability / it.maxDurability) * 100 : 0;
      if(pct <= 15) return 'dur-critical';
      if(pct <= 50) return 'dur-warn';
    }
    return '';
  }

  // ---- renderização de item ----
  function renderItemInner(it, opts){
    opts = opts || {};
    const unitEff = effectiveUnitWeight(it);
    const subtotal = round(itemSubtotal(it));
    const hasUses = it.maxUses !== null && it.maxUses !== undefined;
    const usesEmpty = hasUses && it.uses <= 0;
    const reducedNote = (findItemContainer(it.id) || isEquippedInReducingSlot('item', it.id)) ? ` <span class="reduced">(reduzida de ${round(it.weight)})</span>` : '';
    let usesBadge = '';
    if(hasUses){
      const ammoItem = (it.ammoLinked && it.ammoItemId) ? state.items.find(i => i.id === it.ammoItemId) : null;
      const incDisabled = it.uses >= it.maxUses || (it.ammoLinked && (!ammoItem || ammoItem.qty <= 0));
      const incTitle = it.ammoLinked ? (ammoItem ? `recarregar (consome 1x ${escapeHtml(ammoItem.name)})` : 'nenhuma munição vinculada') : '+1 carga';
      const usesPct = it.maxUses > 0 ? (it.uses / it.maxUses) * 100 : 0;
      const usesLevel = usesPct <= 15 ? 'critical-level' : (usesPct <= 50 ? 'warn-level' : '');
      const segGap = it.maxUses <= 15 ? 3 : (it.maxUses <= 30 ? 2 : (it.maxUses <= 50 ? 1 : 0));
      const segments = Array.from({length: it.maxUses}).map((_, i) => `<span class="ammo-seg ${i < it.uses ? ('filled ' + usesLevel) : ''}"></span>`).join('');
      const pickerOpen = ammoPickerOpenFor === it.id;
      const weaponWorld = getWorld('item', it.id);
      const ammoChoicesHtml = state.items.filter(i => i.tag === 'municao' && i.id !== it.id && getWorld('item', i.id) === weaponWorld)
        .map(i => `<button data-ammo-pick="${i.id}" data-target="${it.id}">${escapeHtml(i.name)} <span style="opacity:.6">(${i.qty} em estoque)</span></button>`).join('');
      usesBadge = `
        <div class="ammo-wrap" title="${it.uses}/${it.maxUses} usos">
          <button class="icon-btn" data-action="use" data-id="${it.id}" title="usar 1 carga" ${usesEmpty ? 'disabled' : ''}>−</button>
          <div class="ammo-bar" style="gap:${segGap}px;">${segments}</div>
          <button class="icon-btn" data-action="use-inc" data-id="${it.id}" title="${incTitle}" ${incDisabled ? 'disabled' : ''}>+</button>
          <span class="durability-label ${usesLevel}"><b>${it.uses}</b>/${it.maxUses}</span>
          <div class="ammo-picker-wrap">
            <button class="ammo-icon-btn ${it.ammoLinked ? 'linked' : ''}" data-ammo-picker-toggle="${it.id}" title="${it.ammoLinked ? 'trocar munição vinculada' : 'vincular munição'}">${TAG_ICONS.municao}</button>
            ${pickerOpen ? `
              <div class="ammo-picker-menu">
                ${it.ammoLinked ? `<button data-ammo-pick="" data-target="${it.id}">desvincular munição</button>` : ''}
                ${ammoChoicesHtml || '<div class="equip-search-empty">nenhum item com categoria Munição</div>'}
              </div>` : ''}
          </div>
        </div>`;
    }
    const guardarHtml = opts.nested ? '' : renderGuardarMenu('item', it.id);
    const hasDurability = it.maxDurability !== null && it.maxDurability !== undefined;
    const durPct = hasDurability && it.maxDurability > 0 ? Math.max(0, Math.min(100, (it.durability / it.maxDurability) * 100)) : 0;
    const durLevel = !hasDurability ? '' : (durPct <= 15 ? 'critical-level' : (durPct <= 50 ? 'warn-level' : ''));
    const isBroken = hasDurability && it.durability <= 0;
    let durabilityHtml = '';
    if(hasDurability){
      const editOpen = durabilityEditFor === it.id;
      durabilityHtml = `
        <div class="durability-wrap" title="durabilidade">
          <button class="durability-btn" data-action="dur-dec" data-id="${it.id}" title="-1 durabilidade" ${it.durability <= 0 ? 'disabled' : ''}>−</button>
          <div class="durability-track"><div class="durability-fill ${durLevel}" style="width:${durPct}%"></div></div>
          <button class="durability-btn" data-action="dur-inc" data-id="${it.id}" title="+1 durabilidade" ${it.durability >= it.maxDurability ? 'disabled' : ''}>+</button>
          <button class="durability-label ${durLevel}" data-durability-toggle="${it.id}" title="editar valores"><b>${it.durability}</b>/${it.maxDurability}</button>
          ${editOpen ? `
            <div class="durability-edit-menu">
              <input type="number" min="0" step="1" id="dur-edit-current-${it.id}" value="${it.durability}">
              <span>/</span>
              <input type="number" min="1" step="1" id="dur-edit-max-${it.id}" value="${it.maxDurability}">
              <button data-durability-save="${it.id}" title="salvar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4 10-10"/></svg></button>
            </div>` : ''}
        </div>`;
    }
    const extractBtn = opts.nested
      ? `<button class="icon-btn" data-extract data-extract-type="item" data-extract-id="${it.id}" data-container-id="${opts.containerId}" title="tirar do recipiente"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7l10 10M17 7v6M17 7h-6"/></svg></button>`
      : '';
    const tagIcon = TAG_ICONS[it.tag] || TAG_ICONS.outro;
    const descOpen = expandedDescriptions.has(it.id);
    const descHtml = it.description
      ? `<div class="item-desc-wrap">
           <button class="item-desc-toggle ${descOpen ? 'open' : ''}" data-desc-toggle="${it.id}">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 6l6 6-6 6"/></svg>
             descrição
           </button>
           <div class="item-desc-body ${descOpen ? 'open' : ''}"><div class="item-desc-inner"><div class="item-desc-text">${escapeHtml(it.description)}</div></div></div>
         </div>`
      : '';
    const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><path d="M12 17v5"/><path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6z"/></svg>';
    const pinBtn = `<button class="pin-btn ${it.pinned ? 'pinned' : ''}" data-action="toggle-pin" data-id="${it.id}" title="${it.pinned ? 'desafixar do topo' : 'fixar no topo'}">${PIN_ICON}</button>`;
    const itemDeleteConfirming = confirmingDeletes.has('item:' + it.id);
    const DAMAGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20l9-9"/><path d="M13 11l4-4 3 3-4 4"/><path d="M14 6l3-3"/></svg>';
    const RANGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17l14-14"/><path d="M7 13l2 2M11 9l2 2M15 5l2 2"/></svg>';
    const COPY_MINI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="12" rx="1.5"/><path d="M15 9V6a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 6v9A1.5 1.5 0 006 16.5h3"/></svg>';
    const weaponStatsHtml = (it.tag === 'arma' && (it.damage || it.range))
      ? `<div class="weapon-stats">
           ${it.damage ? `<span class="weapon-stat-badge" title="dano">${DAMAGE_ICON}${escapeHtml(it.damage)}<button class="weapon-copy-btn" data-copy-text="${escapeHtml(it.damage)}" title="copiar dano">${COPY_MINI_ICON}</button></span>` : ''}
           ${it.range ? `<span class="weapon-stat-badge" title="alcance">${RANGE_ICON}${escapeHtml(it.range)}</span>` : ''}
         </div>`
      : '';
    return `
      <div class="item-main">
        <div class="item-name-row"><span class="tag-icon" title="${TAGS[it.tag] ? TAGS[it.tag].label : ''}">${tagIcon}</span><span class="item-name ${isBroken ? 'item-broken' : ''}">${escapeHtml(it.name)}${isBroken ? ' (quebrado)' : ''}</span></div>
        <div class="item-meta"><b>${round(unitEff)}</b> carga cada${reducedNote} &nbsp;·&nbsp; subtotal <b>${subtotal}</b> carga &nbsp;·&nbsp; ${it.qty} slot${it.qty>1?'s':''}</div>
        ${weaponStatsHtml}
      </div>
      <div class="item-controls">
        <div class="qty-stepper"><button data-action="dec" data-id="${it.id}">−</button><span class="qty-val">${it.qty}</span><button data-action="inc" data-id="${it.id}">+</button></div>
        ${usesBadge}${durabilityHtml}${guardarHtml}${extractBtn}${pinBtn}
        <button class="icon-btn" data-action="edit" data-id="${it.id}" title="editar">✎</button>
        <button class="icon-btn danger ${itemDeleteConfirming ? 'confirm-pending' : ''}" data-action="remove" data-id="${it.id}" title="${itemDeleteConfirming ? 'clique de novo para confirmar' : 'remover'}">${itemDeleteConfirming ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>' : '✕'}</button>
      </div>
      ${descHtml}`;
  }
  const BACKPACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 8V6a5 5 0 0110 0v2"/><rect x="5" y="8" width="14" height="13" rx="2"/><rect x="9.5" y="12" width="5" height="4" rx="1"/></svg>';
  const SWAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7h13M17 4l3 3-3 3"/><path d="M17 17H4M7 20l-3-3 3-3"/></svg>';

  function renderNestedItemRow(it, containerId, isFirst, isLast){
    const sel = selectedEntries.has('item:' + it.id) ? 'is-selected' : '';
    return `<div class="nested-item-row ${itemBorderClass(it)} ${it.pinned ? 'is-pinned' : ''} ${sel}" draggable="true" data-entry data-entry-type="item" data-id="${it.id}" data-list="${containerId}">${renderItemInner(it, {nested:true, containerId, isFirst, isLast})}</div>`;
  }
  function renderItemTopCard(it, isFirst, isLast, listKey){
    listKey = listKey || 'top';
    const returnBtn = (listKey === 'transport-personal' || listKey === 'transport-public')
      ? `<button class="icon-btn" data-return-to-inventory data-return-type="item" data-return-id="${it.id}" title="voltar pro inventário">${BACKPACK_ICON}</button>`
      : '';
    // "mover pro Público" removido por enquanto — a área pública chega na Fase 2b
    const swapBtn = '';
    const sel = selectedEntries.has('item:' + it.id) ? 'is-selected' : '';
    return `<div class="top-card" draggable="true" data-entry data-entry-type="item" data-id="${it.id}" data-list="${listKey}"><div class="item-card ${itemBorderClass(it)} ${it.pinned ? 'is-pinned' : ''} ${sel}"><div class="drag-handle" title="arraste">⋮⋮</div>${renderItemInner(it, {isFirst, isLast})}${swapBtn}${returnBtn}</div></div>`;
  }

  function renderEntry(entry, ctx){
    if(!isEntryVisible(entry)) return '';
    if(entry.type === 'item'){
      const it = state.items.find(i => i.id === entry.id);
      if(!it) return '';
      return ctx.nested ? renderNestedItemRow(it, ctx.containerId, ctx.isFirst, ctx.isLast) : renderItemTopCard(it, ctx.isFirst, ctx.isLast, ctx.listKey);
    }
    const c = state.containers.find(c => c.id === entry.id);
    if(!c) return '';
    return renderContainerCard(c, ctx);
  }

  function renderContainerCard(c, ctx){
    ctx = ctx || {};
    const nested = !!ctx.nested;
    const used = containerUsedSlots(c);
    const pct = c.maxSlots > 0 ? Math.min(100, (used / c.maxSlots) * 100) : 0;
    const total = round(containerIntrinsicTotal(c));
    const filterActive = isFilterActive();
    const selfMatches = filterActive ? passesFilter(c.name, c.tag) : true;
    const collapsed = filterActive ? !selfMatches ? false : c.collapsed : c.collapsed;
    const visibleContents = sortPinnedFirst(filterActive ? c.contents.filter(isEntryVisible) : c.contents);

    let contentsHtml = '';
    if(c.contents.length === 0){
      contentsHtml = '<div class="container-empty-txt">vazio — arraste itens ou recipientes para cá</div>';
    } else if(filterActive && visibleContents.length === 0){
      contentsHtml = '<div class="container-empty-txt">sem resultados aqui</div>';
    } else {
      contentsHtml = visibleContents.map((entry, idx) => renderEntry(entry, { nested:true, containerId:c.id, isFirst: idx===0, isLast: idx===visibleContents.length-1, depth:(ctx.depth||0)+1 })).join('');
    }

    const listAttr = nested ? ctx.containerId : (ctx.listKey || 'top');
    const headerAttrs = `data-entry data-entry-type="container" data-id="${c.id}" data-list="${listAttr}"`;
    const extractBtn = nested
      ? `<button class="icon-btn" data-extract data-extract-type="container" data-extract-id="${c.id}" data-container-id="${ctx.containerId}" title="tirar do recipiente pai"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7l10 10M17 7v6M17 7h-6"/></svg></button>`
      : '';
    const returnBtn = (!nested && (listAttr === 'transport-personal' || listAttr === 'transport-public'))
      ? `<button class="icon-btn" data-return-to-inventory data-return-type="container" data-return-id="${c.id}" title="voltar pro inventário">${BACKPACK_ICON}</button>`
      : '';
    // "mover pro Público" removido por enquanto — a área pública chega na Fase 2b
    const swapBtn = '';
    const guardarHtml = nested ? '' : renderGuardarMenu('container', c.id);
    const contributeNote = nested ? `<div class="container-meta contribute-note"><span>contribui com <b>${Math.floor(total/2)}</b> carga pro recipiente pai (reduzida pela metade)</span></div>` : '';
    const wrapClass = nested ? 'nested-container-card' : 'top-card container-top';
    const tagIcon = TAG_ICONS[c.tag] || TAG_ICONS.bolsa;
    const containerDeleteConfirming = confirmingDeletes.has('container:' + c.id);
    const containerSel = selectedEntries.has('container:' + c.id) ? 'is-selected' : '';

    return `
      <div class="${wrapClass}" ${headerAttrs}>
        <div class="container-card ${containerSel}">
          <div class="container-header" draggable="true" ${headerAttrs}>
            <button class="collapse-toggle ${collapsed ? 'is-collapsed' : ''}" data-caction="toggle" data-id="${c.id}" title="${collapsed ? 'expandir' : 'recolher'}">▾</button>
            <div class="drag-handle">⋮⋮</div>
            <div class="container-name-row"><span class="tag-icon" title="${TAGS[c.tag] ? TAGS[c.tag].label : ''}">${tagIcon}</span><span class="container-name">${escapeHtml(c.name)}</span></div>
            <div class="container-actions">${guardarHtml}${extractBtn}${swapBtn}${returnBtn}
              <button class="icon-btn" data-caction="edit" data-id="${c.id}" title="editar">✎</button>
              <button class="icon-btn danger ${containerDeleteConfirming ? 'confirm-pending' : ''}" data-caction="remove" data-id="${c.id}" title="${containerDeleteConfirming ? 'clique de novo para confirmar' : 'remover'}">${containerDeleteConfirming ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>' : '✕'}</button>
            </div>
          </div>
          <div class="mini-track"><div class="mini-fill" style="width:${pct}%"></div></div>
          <div class="container-meta"><span>${used}/${c.maxSlots} slots</span><span><b>${total}</b> carga total (própria ${round(c.ownWeight)} + conteúdo)</span></div>
          ${contributeNote}
          <div class="container-dropzone ${collapsed ? 'is-collapsed' : ''}" data-container-id="${c.id}"><div class="dropzone-inner">${contentsHtml}</div></div>
        </div>
      </div>`;
  }

  function renderUnifiedList(){
    const list = document.getElementById('unified-list');
    const visibleOrder = sortPinnedFirst(isFilterActive() ? state.order.filter(isEntryVisible) : state.order);
    if(state.order.length === 0){
      list.innerHTML = '<div class="empty-state">NENHUM ITEM OU RECIPIENTE REGISTRADO<br>use o botão "+ adicionar" acima</div>';
      return;
    }
    if(isFilterActive() && visibleOrder.length === 0){
      list.innerHTML = `<div class="filter-empty">NENHUM RESULTADO PARA "${escapeHtml(searchQuery)}"${activeTagFilter ? ' NA CATEGORIA ' + TAGS[activeTagFilter].label.toUpperCase() : ''}</div>`;
      return;
    }
    list.innerHTML = visibleOrder.map((entry, idx) => renderEntry(entry, { nested:false, isFirst: idx === 0, isLast: idx === visibleOrder.length - 1, depth: 0, listKey:'top' })).join('');
  }

  function renderTransportSubList(listArray, elId, listKey, emptyMsg){
    const list = document.getElementById(elId);
    if(listArray.length === 0){
      list.innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
      return;
    }
    const sorted = sortPinnedFirst(listArray);
    list.innerHTML = sorted.map((entry, idx) => renderEntry(entry, { nested:false, isFirst: idx === 0, isLast: idx === sorted.length - 1, depth: 0, listKey })).join('');
  }

  const COIN_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="1"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1"/></svg>';
  const COMPARTMENT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 11h18"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/></svg>';

  function renderCompartmentCard(comp){
    const collapsed = !!comp.collapsed;
    const total = round(compartmentWeight(comp));
    const editOpen = compCurrencyEditFor === comp.id;
    const isRenaming = renamingCompartmentId === comp.id;
    const deleteKey = 'comp:' + comp.id;
    const deleteConfirming = confirmingDeletes.has(deleteKey);
    const currencyHtml = `
      <div class="comp-currency-wrap">
        <button class="comp-currency-strip" data-comp-currency-toggle="${comp.id}" title="clique para editar as moedas deste compartimento">
          <span class="coin-badge coin-bronze">${COIN_SVG}<b>${comp.currency.bronze}</b></span>
          <span class="coin-badge coin-silver">${COIN_SVG}<b>${comp.currency.silver}</b></span>
          <span class="coin-badge coin-gold">${COIN_SVG}<b>${comp.currency.gold}</b></span>
          <span class="coin-badge coin-platinum">${COIN_SVG}<b>${comp.currency.platinum}</b></span>
        </button>
        ${editOpen ? `
          <div class="currency-edit-menu">
            <div class="currency-edit-row"><span class="coin-badge coin-bronze">${COIN_SVG}</span><input type="number" min="0" step="1" id="comp-currency-bronze-${comp.id}" value="${comp.currency.bronze}"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-silver">${COIN_SVG}</span><input type="number" min="0" step="1" id="comp-currency-silver-${comp.id}" value="${comp.currency.silver}"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-gold">${COIN_SVG}</span><input type="number" min="0" step="1" id="comp-currency-gold-${comp.id}" value="${comp.currency.gold}"></div>
            <div class="currency-edit-row"><span class="coin-badge coin-platinum">${COIN_SVG}</span><input type="number" min="0" step="1" id="comp-currency-platinum-${comp.id}" value="${comp.currency.platinum}"></div>
            <div class="currency-hint">100 bronze = 1 prata · 100 prata = 1 ouro · 100 ouro = 1 platina</div>
            <button class="btn" data-comp-currency-save="${comp.id}">salvar</button>
          </div>` : ''}
      </div>`;

    let contentsHtml = '';
    if(comp.contents.length === 0){
      contentsHtml = '<div class="container-empty-txt">vazio — arraste itens ou recipientes para cá</div>';
    } else {
      const sorted = sortPinnedFirst(comp.contents);
      contentsHtml = sorted.map((entry, idx) => renderEntry(entry, { nested:true, containerId: comp.id, isFirst: idx===0, isLast: idx===sorted.length-1, depth:1 })).join('');
    }

    return `
      <div class="compartment-card" data-compartment-id="${comp.id}">
        <div class="compartment-header">
          <button class="collapse-toggle ${collapsed ? 'is-collapsed' : ''}" data-comp-toggle="${comp.id}" title="${collapsed ? 'expandir' : 'recolher'}">▾</button>
          <div class="compartment-icon">${COMPARTMENT_ICON}</div>
          ${isRenaming
            ? `<input type="text" class="compartment-rename-input" id="comp-rename-input-${comp.id}" value="${escapeHtml(comp.name)}">
               <button class="icon-btn" data-comp-rename-save="${comp.id}" title="salvar nome"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg></button>`
            : `<div class="compartment-name">${escapeHtml(comp.name)}</div>
               <button class="icon-btn" data-comp-rename-start="${comp.id}" title="renomear">✎</button>`
          }
          <div class="compartment-actions">
            <button class="icon-btn danger ${deleteConfirming ? 'confirm-pending' : ''}" data-comp-remove="${comp.id}" title="${deleteConfirming ? 'clique de novo para confirmar' : 'excluir compartimento (devolve o conteúdo pro público solto)'}">${deleteConfirming ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l4 4L19 6"/></svg>' : '✕'}</button>
          </div>
        </div>
        ${currencyHtml}
        <div class="compartment-meta"><b>${total}</b> carga total dentro (sem redução)</div>
        <div class="container-dropzone ${collapsed ? 'is-collapsed' : ''}" data-container-id="${comp.id}"><div class="dropzone-inner">${contentsHtml}</div></div>
      </div>`;
  }

  function renderCompartmentsList(){
    const el = document.getElementById('compartments-list');
    if(!el) return;
    el.innerHTML = state.compartments.map(comp => renderCompartmentCard(comp)).join('');
  }

  function renderTransportList(){
    renderTransportSubList(state.transportPersonal, 'transport-personal-list', 'transport-personal', 'ESPAÇO PESSOAL VAZIO<br>arraste um item até o ícone do veículo, na aba Itens, pra guardar aqui');
    renderCompartmentsList();
    renderTransportSubList(state.transportPublic, 'transport-public-list', 'transport-public', 'PÚBLICO VAZIO<br>use o ícone de troca em um item do espaço pessoal pra movê-lo pra cá');
  }

  function renderTagChips(){
    const row = document.getElementById('tag-chip-row');
    row.innerHTML = TAG_ORDER.map(k => `<button type="button" class="tag-chip ${activeTagFilter === k ? 'active' : ''}" data-tagfilter="${k}">${TAG_ICONS[k]}<span>${TAGS[k].label}</span></button>`).join('');
  }

  // ---- slots de equipamento ----
  function renderSlots(){
    const grid = document.getElementById('slots-grid');
    if(state.equipSlots.length === 0){ grid.innerHTML = '<div class="empty-state">NENHUM SLOT DE EQUIPAMENTO<br>adicione um slot acima</div>'; return; }
    grid.innerHTML = state.equipSlots.map(slot => {
      const value = state.equip[slot.key] || '';
      const [vtype, vid] = value ? value.split(':') : [null, null];
      let equippedLabel = null, equippedDetail = null;
      if(vtype === 'item'){ const it = state.items.find(i => i.id === vid); if(it){ equippedLabel = it.name; equippedDetail = round(effectiveUnitWeight(it)) + ' carga por unidade'; } }
      else if(vtype === 'container'){ const c = state.containers.find(c => c.id === vid); if(c){ equippedLabel = c.name; equippedDetail = round(applyEquipReduction(containerIntrinsicTotal(c), 'container', c.id)) + ' carga total (recipiente)'; } }
      const icon = ICONS[slot.icon] || ICONS.acessorios;
      const detail = equippedLabel ? `<b>${escapeHtml(equippedLabel)}</b> — ${equippedDetail}` : '<span class="empty-txt">slot vazio</span>';
      const reduceBadge = slot.reduceWeight ? '<span class="reduce-badge">½ carga</span>' : '';

      const isOpen = equipSearchOpenFor === slot.key;
      const query = isOpen ? equipSearchQuery.trim().toLowerCase() : '';
      const itemOpts = state.items.filter(it => !isInTransport('item', it.id) && (!query || it.name.toLowerCase().includes(query)));
      const containerOpts = state.containers.filter(c => !isInTransport('container', c.id) && (!query || c.name.toLowerCase().includes(query)));
      const itemOptsHtml = itemOpts.map(it => {
        const val = 'item:' + it.id;
        const usedElsewhere = Object.entries(state.equip).some(([k,v]) => v === val && k !== slot.key);
        return `<button type="button" data-equip-pick="${val}" data-slot="${slot.key}">${escapeHtml(it.name)}${usedElsewhere ? ' (em outro slot)' : ''}</button>`;
      }).join('');
      const containerOptsHtml = containerOpts.map(c => {
        const val = 'container:' + c.id;
        const usedElsewhere = Object.entries(state.equip).some(([k,v]) => v === val && k !== slot.key);
        return `<button type="button" data-equip-pick="${val}" data-slot="${slot.key}">${escapeHtml(c.name)} (recipiente)${usedElsewhere ? ' (em outro slot)' : ''}</button>`;
      }).join('');
      const noResults = isOpen && !itemOptsHtml && !containerOptsHtml;

      return `
        <div class="slot-card ${equippedLabel ? 'filled' : ''}">
          <button class="slot-remove" data-remove-slot="${slot.key}" title="excluir slot">✕</button>
          <div class="slot-head"><div class="slot-icon">${icon}</div><div class="slot-name-wrap"><div class="slot-name">${escapeHtml(slot.label)}</div>${reduceBadge}</div></div>
          <div class="equip-search-wrap">
            <input type="text" class="equip-search-input" data-slot="${slot.key}" placeholder="pesquisar item ou recipiente..." value="${isOpen ? escapeHtml(equipSearchQuery) : (equippedLabel ? escapeHtml(equippedLabel) : '')}" autocomplete="off">
            ${isOpen ? `
              <div class="equip-search-dropdown">
                <button type="button" data-equip-pick="" data-slot="${slot.key}">— nenhum —</button>
                ${itemOptsHtml ? '<div class="equip-search-group">Itens</div>' + itemOptsHtml : ''}
                ${containerOptsHtml ? '<div class="equip-search-group">Recipientes</div>' + containerOptsHtml : ''}
                ${noResults ? '<div class="equip-search-empty">nada encontrado</div>' : ''}
              </div>` : ''}
          </div>
          <div class="slot-detail">${detail}</div>
        </div>`;
    }).join('');
  }

  function renderAll(){
    renderGauge();
    renderTransportGauge();
    renderCurrency();
    renderTagChips();
    renderUnifiedList();
    renderTransportList();
    renderIconPicker();
    renderSlots();
    renderSummary();
  }

  // ---- log de atividade ----
  function addLog(text){
    const now = new Date();
    const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    activityLog.unshift({ time, text });
    if(activityLog.length > ACTIVITY_LOG_LIMIT) activityLog.pop();
    renderActivityLog();
  }
  function renderActivityLog(){
    const el = document.getElementById('activity-log-list');
    if(!el) return;
    if(activityLog.length === 0){
      el.innerHTML = '<div class="log-empty">nenhuma ação registrada ainda</div>';
      return;
    }
    el.innerHTML = activityLog.map(entry => `<div class="log-entry"><span class="log-time">${entry.time}</span><span class="log-text">${escapeHtml(entry.text)}</span></div>`).join('');
  }

  // ---- resumo rápido ----
  function renderSummary(){
    const el = document.getElementById('summary-content');
    if(!el) return;
    const itemsInMain = state.items.filter(it => getWorld('item', it.id) === 'main');
    const itemTypeCount = itemsInMain.length;
    const totalUnits = itemsInMain.reduce((s, it) => s + it.qty, 0);
    const containerCountMain = state.containers.filter(c => getWorld('container', c.id) === 'main').length;
    const total = totalWeight();
    const max = state.maxCarga || 0;
    const pct = max > 0 ? Math.round((total / max) * 100) : 0;
    const pctClass = pct >= 100 ? 'summary-danger' : (pct >= 80 ? 'summary-warn' : '');
    const equippedCount = Object.values(state.equip).filter(v => !!v).length;
    const pinnedCount = state.items.filter(it => it.pinned).length;
    const transportItemsCount = state.items.filter(it => getWorld('item', it.id) !== 'main').length + state.containers.filter(c => getWorld('container', c.id) !== 'main').length;

    el.innerHTML = `
      <div class="summary-row"><span>Itens (tipos)</span><b>${itemTypeCount}</b></div>
      <div class="summary-row"><span>Unidades totais</span><b>${totalUnits}</b></div>
      <div class="summary-row"><span>Recipientes</span><b>${containerCountMain}</b></div>
      <div class="summary-row"><span>Carga usada</span><b class="${pctClass}">${pct}%</b></div>
      <div class="summary-row"><span>Equipados</span><b>${equippedCount}/${state.equipSlots.length}</b></div>
      <div class="summary-row"><span>Fixados</span><b>${pinnedCount}</b></div>
      <div class="summary-row"><span>No veículo</span><b>${transportItemsCount}</b></div>
      <div class="summary-row"><span>Compartimentos</span><b>${state.compartments.length}</b></div>
    `;
  }

  // ---- desfazer ----
  function snapshotState(){ return JSON.stringify(state); }
  function pushUndoIfChanged(before){
    const after = snapshotState();
    if(before !== after){
      undoStack.push(before);
      if(undoStack.length > UNDO_LIMIT) undoStack.shift();
      updateUndoButton();
    }
  }
  function updateUndoButton(){
    const btn = document.getElementById('undo-trigger');
    const badge = document.getElementById('undo-count-badge');
    if(!btn) return;
    btn.disabled = undoStack.length === 0;
    if(undoStack.length > 0){ badge.style.display = 'flex'; badge.textContent = undoStack.length; }
    else { badge.style.display = 'none'; }
  }
  function performUndo(){
    if(undoStack.length === 0){ flashStatus('NADA PRA DESFAZER'); return; }
    const prev = undoStack.pop();
    state = JSON.parse(prev);
    confirmingDeletes.clear();
    renamingCompartmentId = null;
    compCurrencyEditFor = null;
    renderAll();
    updateUndoButton();
    saveState();
    flashStatus('AÇÃO DESFEITA');
    addLog('Última ação desfeita');
  }

  // ---- tema ----
  function renderThemePanel(){
    ['dark','light','neutral'].forEach(group => {
      const row = document.querySelector(`.theme-swatch-row[data-group="${group}"]`);
      row.innerHTML = THEMES.filter(t => t.group === group).map(t =>
        `<button type="button" class="theme-swatch ${state.theme === t.id ? 'active' : ''}" data-theme-id="${t.id}" title="${t.label}" style="--swatch-accent:${t.accent}; --swatch-void:${t.void};"></button>`
      ).join('');
    });
  }
  function applyTheme(id, persist){
    state.theme = id;
    if(id === 'caverna-azul'){ document.documentElement.removeAttribute('data-theme'); }
    else { document.documentElement.setAttribute('data-theme', id); }
    renderThemePanel();
    if(persist) saveState();
  }
  renderThemePanel();

  document.getElementById('theme-trigger').addEventListener('click', ()=>{
    const panel = document.getElementById('theme-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('theme-panel').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-theme-id]');
    if(!btn) return;
    applyTheme(btn.dataset.themeId, true);
    document.getElementById('theme-panel').style.display = 'none';
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('#theme-picker-wrap')) document.getElementById('theme-panel').style.display = 'none';
  });

  // ---- controle do botão "+" (item / recipiente) ----
  const addTriggerBtn = document.getElementById('add-trigger');
  const addMenu = document.getElementById('add-menu');
  const itemFormWrap = document.getElementById('item-form-wrap');
  const containerFormWrap = document.getElementById('container-form-wrap');

  function updateAddUI(){
    addTriggerBtn.style.display = addMode === null ? 'block' : 'none';
    itemFormWrap.style.display = addMode === 'item' ? 'block' : 'none';
    containerFormWrap.style.display = addMode === 'container' ? 'block' : 'none';
    addMenu.style.display = 'none';
  }
  addTriggerBtn.addEventListener('click', ()=>{ addMenu.style.display = addMenu.style.display === 'none' ? 'flex' : 'none'; });
  addMenu.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-addmode]');
    if(!btn) return;
    addMode = btn.dataset.addmode;
    updateAddUI();
    if(addMode === 'item'){ resetForm(); document.getElementById('f-name').focus(); }
    if(addMode === 'container'){ resetContainerForm(); document.getElementById('c-name').focus(); }
  });
  document.addEventListener('click', (e)=>{ if(!e.target.closest('#add-trigger-wrap')) addMenu.style.display = 'none'; });
  document.getElementById('item-form-close').addEventListener('click', ()=>{ resetForm(); addMode = null; updateAddUI(); });
  document.getElementById('container-form-close').addEventListener('click', ()=>{ resetContainerForm(); addMode = null; updateAddUI(); });

  // ---- form adicionar/editar item ----
  const fName = document.getElementById('f-name');
  const fWeight = document.getElementById('f-weight');
  const fQty = document.getElementById('f-qty');
  const fHasUses = document.getElementById('f-has-uses');
  const fUses = document.getElementById('f-uses');
  const usesWrap = document.getElementById('uses-input-wrap');
  const ammoCheckboxRow = document.getElementById('ammo-checkbox-row');
  const fAmmoLinked = document.getElementById('f-ammo-linked');
  const ammoSelectWrap = document.getElementById('ammo-select-wrap');
  const fAmmoItem = document.getElementById('f-ammo-item');
  const fHasDurability = document.getElementById('f-has-durability');
  const durabilityWrap = document.getElementById('durability-input-wrap');
  const fDurCurrent = document.getElementById('f-durability-current');
  const fDurMax = document.getElementById('f-durability-max');
  const fHasDescription = document.getElementById('f-has-description');
  const fDescription = document.getElementById('f-description');
  const submitBtn = document.getElementById('submit-item');
  const cancelBtn = document.getElementById('cancel-edit');
  const formTitle = document.getElementById('form-title');

  function populateAmmoSelect(selectedId, excludeId){
    const weaponWorld = excludeId ? getWorld('item', excludeId) : 'main';
    const ammoItems = state.items.filter(it => it.tag === 'municao' && it.id !== excludeId && getWorld('item', it.id) === weaponWorld);
    if(ammoItems.length === 0){
      fAmmoItem.innerHTML = '<option value="">nenhum item com categoria Munição cadastrado</option>';
      return;
    }
    fAmmoItem.innerHTML = ammoItems.map(it => `<option value="${it.id}" ${it.id === selectedId ? 'selected' : ''}>${escapeHtml(it.name)} (${it.qty} em estoque)</option>`).join('');
  }
  function updateUsesUI(){
    usesWrap.classList.toggle('show', fHasUses.checked);
    ammoCheckboxRow.style.display = fHasUses.checked ? 'flex' : 'none';
    if(!fHasUses.checked){ fAmmoLinked.checked = false; ammoSelectWrap.style.display = 'none'; }
  }
  fHasUses.addEventListener('change', updateUsesUI);
  fAmmoLinked.addEventListener('change', ()=>{
    ammoSelectWrap.style.display = fAmmoLinked.checked ? 'block' : 'none';
    if(fAmmoLinked.checked) populateAmmoSelect(null, editingId);
  });
  fHasDurability.addEventListener('change', ()=> durabilityWrap.classList.toggle('show', fHasDurability.checked));
  fHasDescription.addEventListener('change', ()=>{ fDescription.style.display = fHasDescription.checked ? 'block' : 'none'; });

  function resetForm(){
    editingId = null; fName.value = ''; fWeight.value = 1; fQty.value = 1;
    fHasUses.checked = false; fUses.value = 1; fAmmoLinked.checked = false; ammoSelectWrap.style.display = 'none'; updateUsesUI();
    fHasDurability.checked = false; fDurCurrent.value = 70; fDurMax.value = 70; durabilityWrap.classList.remove('show');
    fHasDescription.checked = false; fDescription.value = ''; fDescription.style.display = 'none';
    document.getElementById('f-damage').value = ''; document.getElementById('f-range').value = '';
    submitBtn.textContent = 'adicionar item'; formTitle.textContent = '// REGISTRAR ITEM'; cancelBtn.style.display = 'none';
    selectedItemTag = 'outro'; renderTagPicker('item-tag-picker', selectedItemTag);
    updateWeaponStatsVisibility();
  }
  function startEdit(id){
    const it = state.items.find(i => i.id === id);
    if(!it) return;
    addMode = 'item'; updateAddUI();
    editingId = id; fName.value = it.name; fWeight.value = it.weight; fQty.value = it.qty;
    const hasUses = it.maxUses !== null && it.maxUses !== undefined;
    fHasUses.checked = hasUses; fUses.value = hasUses ? it.maxUses : 1; updateUsesUI();
    fAmmoLinked.checked = !!it.ammoLinked;
    ammoSelectWrap.style.display = it.ammoLinked ? 'block' : 'none';
    if(it.ammoLinked) populateAmmoSelect(it.ammoItemId, it.id);
    const hasDurability = it.maxDurability !== null && it.maxDurability !== undefined;
    fHasDurability.checked = hasDurability; durabilityWrap.classList.toggle('show', hasDurability);
    fDurCurrent.value = hasDurability ? it.durability : 70; fDurMax.value = hasDurability ? it.maxDurability : 70;
    fHasDescription.checked = !!it.description; fDescription.value = it.description || ''; fDescription.style.display = it.description ? 'block' : 'none';
    document.getElementById('f-damage').value = it.damage || ''; document.getElementById('f-range').value = it.range || '';
    submitBtn.textContent = 'salvar alterações'; formTitle.textContent = '// EDITANDO ITEM'; cancelBtn.style.display = 'inline-block';
    selectedItemTag = it.tag || 'outro'; renderTagPicker('item-tag-picker', selectedItemTag);
    updateWeaponStatsVisibility();
    fName.focus();
  }
  cancelBtn.addEventListener('click', resetForm);
  function updateWeaponStatsVisibility(){
    document.getElementById('weapon-stats-form-wrap').classList.toggle('show', selectedItemTag === 'arma');
  }
  document.getElementById('item-tag-picker').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-tag]');
    if(!btn) return;
    selectedItemTag = btn.dataset.tag;
    renderTagPicker('item-tag-picker', selectedItemTag);
    updateWeaponStatsVisibility();
  });

  submitBtn.addEventListener('click', ()=>{
    const name = fName.value.trim();
    if(!name){ fName.focus(); return; }
    const weight = Math.max(0, parseFloat(fWeight.value) || 0);
    const qty = Math.max(1, parseInt(fQty.value) || 1);
    const hasUses = fHasUses.checked;
    const maxUses = hasUses ? Math.max(1, parseInt(fUses.value) || 1) : null;
    const ammoLinked = hasUses && fAmmoLinked.checked;
    const ammoItemId = ammoLinked ? (fAmmoItem.value || null) : null;
    const hasDurability = fHasDurability.checked;
    let maxDurability = null, durability = null;
    if(hasDurability){
      maxDurability = Math.max(1, parseInt(fDurMax.value) || 1);
      durability = Math.max(0, Math.min(maxDurability, parseInt(fDurCurrent.value) || 0));
    }
    const description = fHasDescription.checked ? fDescription.value.trim() || null : null;
    const isWeapon = selectedItemTag === 'arma';
    const damage = isWeapon ? (document.getElementById('f-damage').value.trim() || null) : null;
    const range = isWeapon ? (document.getElementById('f-range').value.trim() || null) : null;

    if(editingId){
      const it = state.items.find(i => i.id === editingId);
      if(it){
        const parentContainer = findItemContainer(it.id);
        if(parentContainer){
          const otherUsed = containerUsedSlots(parentContainer) - it.qty;
          if(otherUsed + qty > parentContainer.maxSlots){
            flashStatus('RECIPIENTE CHEIO — reduza a quantidade ou tire o item de lá');
            return;
          }
        }
        const wasAmmoLinked = it.ammoLinked, prevAmmoItemId = it.ammoItemId;
        it.name = name; it.weight = weight; it.qty = qty; it.tag = selectedItemTag; it.description = description;
        it.damage = damage; it.range = range;
        if(hasUses){
          const wasUsing = it.maxUses !== null && it.maxUses !== undefined;
          it.maxUses = maxUses;
          if(ammoLinked && ammoItemId && (!wasAmmoLinked || prevAmmoItemId !== ammoItemId)){
            it.uses = 0; // recarrega do zero ao vincular ou trocar a munição
          } else {
            it.uses = wasUsing ? Math.min(it.uses, maxUses) : maxUses;
          }
        } else { it.maxUses = null; it.uses = null; }
        it.ammoLinked = ammoLinked; it.ammoItemId = ammoItemId;
        it.maxDurability = maxDurability; it.durability = durability;
      }
    } else {
      const newId = uid();
      const initialUses = hasUses ? ((ammoLinked && ammoItemId) ? 0 : maxUses) : null;
      state.items.push({ id: newId, name, weight, qty, maxUses, uses: initialUses, durability, maxDurability, description, ammoLinked, ammoItemId, damage, range, tag: selectedItemTag });
      state.order.push({type:'item', id: newId});
    }
    addLog(editingId ? `Item "${name}" editado` : `Item "${name}" criado`);
    resetForm(); renderAll(); saveState();
  });

  // ---- form adicionar/editar recipiente ----
  const cName = document.getElementById('c-name');
  const cWeight = document.getElementById('c-weight');
  const cSlots = document.getElementById('c-slots');
  const submitContainerBtn = document.getElementById('submit-container');
  const cancelContainerBtn = document.getElementById('cancel-container-edit');
  const containerFormTitle = document.getElementById('container-form-title');

  function resetContainerForm(){
    editingContainerId = null; cName.value = ''; cWeight.value = 1; cSlots.value = 4;
    submitContainerBtn.textContent = 'adicionar recipiente'; containerFormTitle.textContent = '// NOVO RECIPIENTE'; cancelContainerBtn.style.display = 'none';
    selectedContainerTag = 'bolsa'; renderTagPicker('container-tag-picker', selectedContainerTag);
  }
  function startEditContainer(id){
    const c = state.containers.find(c => c.id === id);
    if(!c) return;
    addMode = 'container'; updateAddUI();
    editingContainerId = id; cName.value = c.name; cWeight.value = c.ownWeight; cSlots.value = c.maxSlots;
    submitContainerBtn.textContent = 'salvar alterações'; containerFormTitle.textContent = '// EDITANDO RECIPIENTE'; cancelContainerBtn.style.display = 'inline-block';
    selectedContainerTag = c.tag || 'bolsa'; renderTagPicker('container-tag-picker', selectedContainerTag);
    cName.focus();
  }
  cancelContainerBtn.addEventListener('click', resetContainerForm);
  document.getElementById('container-tag-picker').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-tag]');
    if(!btn) return;
    selectedContainerTag = btn.dataset.tag;
    renderTagPicker('container-tag-picker', selectedContainerTag);
  });

  submitContainerBtn.addEventListener('click', ()=>{
    const name = cName.value.trim();
    if(!name){ cName.focus(); return; }
    const ownWeight = Math.max(0, parseFloat(cWeight.value) || 0);
    const maxSlots = Math.max(1, parseInt(cSlots.value) || 1);

    if(editingContainerId){
      const c = state.containers.find(c => c.id === editingContainerId);
      if(c){
        c.name = name; c.ownWeight = ownWeight; c.maxSlots = maxSlots; c.tag = selectedContainerTag;
        const parentContainer = findParentContainer('container', c.id);
        const destList = parentContainer ? parentContainer.contents : currentTopLevelHome('container', c.id);
        while(containerUsedSlots(c) > c.maxSlots && c.contents.length > 0){
          destList.push(c.contents.pop());
        }
      }
    } else {
      const newId = uid();
      state.containers.push({ id: newId, name, ownWeight, maxSlots, collapsed:false, contents:[], tag: selectedContainerTag });
      state.order.push({type:'container', id: newId});
    }
    addLog(editingContainerId ? `Recipiente "${name}" editado` : `Recipiente "${name}" criado`);
    resetContainerForm(); renderAll(); saveState();
  });

  // ---- delegate de cliques na lista unificada ----
  function entryName(type, id){
    if(type === 'item'){ const it = state.items.find(i => i.id === id); return it ? it.name : 'item'; }
    const c = state.containers.find(c => c.id === id);
    return c ? c.name : 'recipiente';
  }
  function requestDeleteConfirm(key){
    if(confirmingDeletes.has(key)){
      confirmingDeletes.delete(key);
      return true; // segundo clique: confirmado, prossegue com a exclusão
    }
    confirmingDeletes.add(key);
    setTimeout(()=>{
      if(confirmingDeletes.has(key)){ confirmingDeletes.delete(key); renderAll(); }
    }, 3000);
    renderAll();
    return false;
  }

  // ---- seleção em lote (Ctrl+clique) ----
  function moveTargetLabel(targetKey){
    if(targetKey === 'top') return 'Inventário';
    if(targetKey === 'transport-personal') return 'Espaço Pessoal';
    if(targetKey === 'transport-public') return 'Público';
    return targetKey;
  }
  function updateSelectionBar(){
    const bar = document.getElementById('selection-bar');
    const countEl = document.getElementById('selection-count');
    const n = selectedEntries.size;
    bar.style.display = n > 0 ? 'flex' : 'none';
    countEl.textContent = n === 1 ? '1 selecionado' : n + ' selecionados';
  }
  function clearSelection(){
    selectedEntries.clear();
    const bdBtn = document.getElementById('batch-delete-btn');
    if(bdBtn){ bdBtn.classList.remove('confirm-pending'); bdBtn.textContent = 'Excluir'; }
    updateSelectionBar();
    renderAll();
  }
  function moveSelectedTo(targetKey){
    if(selectedEntries.size === 0) return;
    const targetList = resolveList(targetKey);
    const isTransportTarget = targetKey !== 'top';
    const n = selectedEntries.size;
    selectedEntries.forEach(key => {
      const idx = key.indexOf(':');
      const type = key.slice(0, idx), id = key.slice(idx + 1);
      if(isTransportTarget) clearEquipForSubtree(type, id);
      removeFromEverywhere(type, id);
      targetList.push({type, id});
    });
    sanitizeAmmoLinks();
    addLog(`${n} ite${n > 1 ? 'ns' : 'm'} movido${n > 1 ? 's' : ''} pra ${moveTargetLabel(targetKey)}`);
    clearSelection();
    saveState();
  }
  function performBatchDelete(){
    if(selectedEntries.size === 0) return;
    const n = selectedEntries.size;
    selectedEntries.forEach(key => {
      const idx = key.indexOf(':');
      const type = key.slice(0, idx), id = key.slice(idx + 1);
      if(type === 'item'){
        state.items = state.items.filter(i => i.id !== id);
        removeFromEverywhere('item', id);
        const val = 'item:' + id;
        Object.keys(state.equip).forEach(k => { if(state.equip[k] === val) state.equip[k] = ''; });
      } else if(type === 'container'){
        removeContainer(id);
      }
    });
    addLog(`${n} ite${n > 1 ? 'ns' : 'm'} excluído${n > 1 ? 's' : ''} em lote`);
    clearSelection();
    saveState();
  }

  function handleListKeydown(e){
    if(e.key === 'Escape'){
      if(renamingCompartmentId){ renamingCompartmentId = null; renderTransportList(); }
      return;
    }
    if(e.key !== 'Enter') return;
    const durInput = e.target.closest('.durability-edit-menu input');
    if(durInput){
      const btn = durInput.closest('.durability-edit-menu').querySelector('button[data-durability-save]');
      if(btn) btn.click();
      return;
    }
    const compInput = e.target.closest('.comp-currency-wrap .currency-edit-menu input');
    if(compInput){
      const btn = compInput.closest('.currency-edit-menu').querySelector('button[data-comp-currency-save]');
      if(btn) btn.click();
      return;
    }
    const renameInput = e.target.closest('.compartment-rename-input');
    if(renameInput){
      const btn = renameInput.closest('.compartment-header').querySelector('button[data-comp-rename-save]');
      if(btn) btn.click();
    }
  }
  document.getElementById('unified-list').addEventListener('keydown', handleListKeydown);
  document.getElementById('transport-personal-list').addEventListener('keydown', handleListKeydown);
  document.getElementById('transport-public-list').addEventListener('keydown', handleListKeydown);
  document.getElementById('compartments-list').addEventListener('keydown', handleListKeydown);

  function handleListClick(e){
    const copyTextBtn = e.target.closest('button[data-copy-text]');
    if(copyTextBtn){
      copyTextToClipboard(copyTextBtn.dataset.copyText, 'DANO COPIADO!');
      return;
    }
    if(e.ctrlKey || e.metaKey){
      const entryEl = e.target.closest('[data-entry]');
      if(entryEl){
        e.preventDefault();
        const key = entryEl.dataset.entryType + ':' + entryEl.dataset.id;
        if(selectedEntries.has(key)) selectedEntries.delete(key); else selectedEntries.add(key);
        renderAll();
        updateSelectionBar();
        return;
      }
    }
    const returnBtn = e.target.closest('button[data-return-to-inventory]');
    if(returnBtn){
      const type = returnBtn.dataset.returnType, id = returnBtn.dataset.returnId;
      const name = entryName(type, id);
      removeFromEverywhere(type, id);
      state.order.push({type, id});
      sanitizeAmmoLinks();
      addLog(`"${name}" devolvido ao inventário`);
      renderAll(); saveState();
      return;
    }
    const swapBtn = e.target.closest('button[data-swap-world]');
    if(swapBtn){
      const type = swapBtn.dataset.swapType, id = swapBtn.dataset.swapId, target = swapBtn.dataset.swapTarget;
      const name = entryName(type, id);
      removeFromEverywhere(type, id);
      resolveList(target).push({type, id});
      sanitizeAmmoLinks();
      addLog(`"${name}" movido pra ${target === 'transport-public' ? 'Público' : 'Espaço Pessoal'}`);
      renderAll(); saveState();
      return;
    }
    const toggleMenuBtn = e.target.closest('button[data-toggle-menu]');
    if(toggleMenuBtn){ const key = toggleMenuBtn.dataset.toggleMenu; openMenuFor = openMenuFor === key ? null : key; renderUnifiedList(); renderTransportList(); return; }

    const guardarBtn = e.target.closest('button[data-guardaraction]');
    if(guardarBtn){
      const type = guardarBtn.dataset.guardarType, id = guardarBtn.dataset.guardarId, containerId = guardarBtn.dataset.containerId;
      if(type === 'container' && wouldCreateCycle(id, containerId)){ flashStatus('MOVIMENTO INVÁLIDO'); return; }
      const ok = insertIntoContainerEnd(containerId, type, id);
      if(ok){
        state.containers.forEach(c => { if(c.id !== containerId) c.contents = c.contents.filter(e2 => !(e2.type === type && e2.id === id)); });
        state.order = state.order.filter(e2 => !(e2.type === type && e2.id === id));
        state.transportPersonal = state.transportPersonal.filter(e2 => !(e2.type === type && e2.id === id));
        state.transportPublic = state.transportPublic.filter(e2 => !(e2.type === type && e2.id === id));
        openMenuFor = null; renderAll(); saveState();
      } else { flashStatus('RECIPIENTE CHEIO'); }
      return;
    }
    const toggleBtn = e.target.closest('button[data-caction="toggle"]');
    if(toggleBtn){ const c = state.containers.find(c => c.id === toggleBtn.dataset.id); if(c){ c.collapsed = !c.collapsed; renderAll(); saveState(); } return; }

    const compToggleBtn = e.target.closest('button[data-comp-toggle]');
    if(compToggleBtn){
      const comp = state.compartments.find(c => c.id === compToggleBtn.dataset.compToggle);
      if(comp){ comp.collapsed = !comp.collapsed; renderAll(); saveState(); }
      return;
    }
    const compRenameStartBtn = e.target.closest('button[data-comp-rename-start]');
    if(compRenameStartBtn){
      renamingCompartmentId = compRenameStartBtn.dataset.compRenameStart;
      renderTransportList();
      const inp = document.getElementById('comp-rename-input-' + renamingCompartmentId);
      if(inp) setTimeout(()=>{ inp.focus(); inp.select(); }, 10);
      return;
    }
    const compRenameSaveBtn = e.target.closest('button[data-comp-rename-save]');
    if(compRenameSaveBtn){
      const id = compRenameSaveBtn.dataset.compRenameSave;
      const comp = state.compartments.find(c => c.id === id);
      const inp = document.getElementById('comp-rename-input-' + id);
      if(comp && inp){
        const newName = inp.value.trim();
        if(newName && newName !== comp.name){
          addLog(`Compartimento "${comp.name}" renomeado para "${newName}"`);
          comp.name = newName;
        }
      }
      renamingCompartmentId = null;
      renderAll(); saveState();
      return;
    }
    const compRemoveBtn = e.target.closest('button[data-comp-remove]');
    if(compRemoveBtn){
      const id = compRemoveBtn.dataset.compRemove;
      const key = 'comp:' + id;
      if(!requestDeleteConfirm(key)) return;
      const comp = state.compartments.find(c => c.id === id);
      if(comp){
        comp.contents.forEach(entry => state.transportPublic.push(entry)); // devolve o conteúdo pro público solto
        ['bronze','silver','gold','platinum'].forEach(k => { state.currencyPublic[k] += comp.currency[k]; }); // devolve a moeda pro fundo geral
        normalizeCurrencyObj(state.currencyPublic);
        state.compartments = state.compartments.filter(c => c.id !== id);
        addLog(`Compartimento "${comp.name}" excluído (conteúdo devolvido ao público)`);
        renderAll(); saveState();
      }
      return;
    }
    const compCurrencyToggleBtn = e.target.closest('button[data-comp-currency-toggle]');
    if(compCurrencyToggleBtn){
      const id = compCurrencyToggleBtn.dataset.compCurrencyToggle;
      compCurrencyEditFor = compCurrencyEditFor === id ? null : id;
      renderTransportList();
      if(compCurrencyEditFor === id){
        const inp = document.getElementById('comp-currency-bronze-' + id);
        if(inp) setTimeout(()=>{ inp.focus(); inp.select(); }, 10);
      }
      return;
    }
    const compCurrencySaveBtn = e.target.closest('button[data-comp-currency-save]');
    if(compCurrencySaveBtn){
      const id = compCurrencySaveBtn.dataset.compCurrencySave;
      const comp = state.compartments.find(c => c.id === id);
      if(comp){
        comp.currency.bronze = Math.max(0, parseInt(document.getElementById('comp-currency-bronze-' + id).value) || 0);
        comp.currency.silver = Math.max(0, parseInt(document.getElementById('comp-currency-silver-' + id).value) || 0);
        comp.currency.gold = Math.max(0, parseInt(document.getElementById('comp-currency-gold-' + id).value) || 0);
        comp.currency.platinum = Math.max(0, parseInt(document.getElementById('comp-currency-platinum-' + id).value) || 0);
        normalizeCurrencyObj(comp.currency);
        compCurrencyEditFor = null;
        addLog(`Moedas do compartimento "${comp.name}" editadas`);
        renderAll(); saveState();
      }
      return;
    }

    const cActionBtn = e.target.closest('button[data-caction]');
    if(cActionBtn){
      const id = cActionBtn.dataset.id, action = cActionBtn.dataset.caction;
      if(action === 'edit'){ startEditContainer(id); return; }
      if(action === 'remove'){
        if(!requestDeleteConfirm('container:' + id)) return;
        const c = state.containers.find(c => c.id === id);
        const name = c ? c.name : 'recipiente';
        removeContainer(id);
        if(editingContainerId === id) resetContainerForm();
        addLog(`Recipiente "${name}" removido`);
        renderAll(); saveState();
      }
      return;
    }
    const extractBtn = e.target.closest('button[data-extract]');
    if(extractBtn){ extractEntry(extractBtn.dataset.containerId, extractBtn.dataset.extractType, extractBtn.dataset.extractId); renderAll(); saveState(); return; }

    const ammoPickerToggleBtn = e.target.closest('button[data-ammo-picker-toggle]');
    if(ammoPickerToggleBtn){
      const id = ammoPickerToggleBtn.dataset.ammoPickerToggle;
      ammoPickerOpenFor = ammoPickerOpenFor === id ? null : id;
      renderUnifiedList(); renderTransportList();
      return;
    }
    const ammoPickBtn = e.target.closest('button[data-ammo-pick]');
    if(ammoPickBtn){
      const targetId = ammoPickBtn.dataset.target;
      const newAmmoId = ammoPickBtn.dataset.ammoPick || '';
      const it = state.items.find(i => i.id === targetId);
      if(it){
        if(!newAmmoId){
          it.ammoLinked = false; it.ammoItemId = null;
        } else {
          if(it.ammoItemId !== newAmmoId){ it.uses = 0; } // recarrega do zero ao trocar a munição vinculada
          it.ammoItemId = newAmmoId; it.ammoLinked = true;
        }
      }
      ammoPickerOpenFor = null;
      renderAll(); saveState();
      return;
    }

    const descToggleBtn = e.target.closest('button[data-desc-toggle]');
    if(descToggleBtn){
      const id = descToggleBtn.dataset.descToggle;
      if(expandedDescriptions.has(id)) expandedDescriptions.delete(id); else expandedDescriptions.add(id);
      renderUnifiedList(); renderTransportList();
      return;
    }
    const durToggleBtn = e.target.closest('button[data-durability-toggle]');
    if(durToggleBtn){
      const id = durToggleBtn.dataset.durabilityToggle;
      durabilityEditFor = durabilityEditFor === id ? null : id;
      renderUnifiedList(); renderTransportList();
      if(durabilityEditFor === id){
        const inp = document.getElementById('dur-edit-current-' + id);
        if(inp) setTimeout(()=>{ inp.focus(); inp.select(); }, 10);
      }
      return;
    }
    const durSaveBtn = e.target.closest('button[data-durability-save]');
    if(durSaveBtn){
      const id = durSaveBtn.dataset.durabilitySave;
      const it = state.items.find(i => i.id === id);
      const curInp = document.getElementById('dur-edit-current-' + id);
      const maxInp = document.getElementById('dur-edit-max-' + id);
      if(it && curInp && maxInp){
        const newMax = Math.max(1, parseInt(maxInp.value) || 1);
        const newCur = Math.max(0, Math.min(newMax, parseInt(curInp.value) || 0));
        it.maxDurability = newMax; it.durability = newCur;
        durabilityEditFor = null;
        renderAll(); saveState();
      }
      return;
    }

    const actionBtn = e.target.closest('button[data-action]');
    if(actionBtn){
      const id = actionBtn.dataset.id, action = actionBtn.dataset.action;
      const it = state.items.find(i => i.id === id);
      if(!it) return;
      if(action === 'inc'){
        const parentContainer = findItemContainer(it.id);
        if(parentContainer && containerUsedSlots(parentContainer) + 1 > parentContainer.maxSlots){ flashStatus('RECIPIENTE CHEIO'); return; }
        it.qty += 1;
      }
      if(action === 'dec'){
        it.qty -= 1;
        if(it.qty <= 0){
          state.items = state.items.filter(i => i.id !== id);
          removeFromEverywhere('item', id);
          const val = 'item:' + id;
          Object.keys(state.equip).forEach(k => { if(state.equip[k] === val) state.equip[k] = ''; });
        }
      }
      if(action === 'use'){ if(it.maxUses !== null && it.uses > 0){ it.uses -= 1; } }
      if(action === 'use-inc'){
        if(it.maxUses !== null && it.uses < it.maxUses){
          if(it.ammoLinked && it.ammoItemId){
            const ammoItem = state.items.find(i => i.id === it.ammoItemId);
            if(ammoItem && ammoItem.qty > 0){
              ammoItem.qty -= 1; // consome 1 unidade de munição (não deleta o item mesmo chegando a 0)
              it.uses += 1;
            } else {
              flashStatus('SEM MUNIÇÃO DISPONÍVEL');
            }
          } else {
            it.uses += 1;
          }
        }
      }
      if(action === 'dur-dec'){ if(it.maxDurability !== null && it.durability > 0){ it.durability -= 1; } }
      if(action === 'dur-inc'){ if(it.maxDurability !== null && it.durability < it.maxDurability){ it.durability += 1; } }
      if(action === 'toggle-pin'){ it.pinned = !it.pinned; }
      if(action === 'edit'){ startEdit(id); return; }
      if(action === 'remove'){
        if(!requestDeleteConfirm('item:' + id)) return;
        state.items = state.items.filter(i => i.id !== id);
        removeFromEverywhere('item', id);
        const val = 'item:' + id;
        Object.keys(state.equip).forEach(k => { if(state.equip[k] === val) state.equip[k] = ''; });
        if(editingId === id) resetForm();
        addLog(`Item "${it.name}" removido`);
      }
      renderAll(); saveState();
    }
  }
  document.getElementById('unified-list').addEventListener('click', handleListClick);
  document.getElementById('transport-personal-list').addEventListener('click', handleListClick);
  document.getElementById('transport-public-list').addEventListener('click', handleListClick);
  document.getElementById('compartments-list').addEventListener('click', handleListClick);

  // ---- DRAG AND DROP ----
  function clearDragOver(){ document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); }

  function attachDragHandlers(listEl){
    listEl.addEventListener('dragstart', (e)=>{
      const draggableEl = e.target.closest('[draggable="true"]');
      if(!draggableEl) return;
      const entryEl = draggableEl.closest('[data-entry]');
      if(!entryEl) return;
      dragSource = { type: entryEl.dataset.entryType, id: entryEl.dataset.id, origin: entryEl.dataset.list };
      e.dataTransfer.effectAllowed = 'move';
      try{ e.dataTransfer.setData('text/plain', entryEl.dataset.id); }catch(err){}
      entryEl.classList.add('dragging');
    });
    listEl.addEventListener('dragend', ()=>{
      document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    listEl.addEventListener('dragover', (e)=>{
      if(!dragSource) return;
      const dropzone = e.target.closest('.container-dropzone');
      const entryEl = e.target.closest('[data-entry]');
      if(dropzone){
        const containerId = dropzone.dataset.containerId;
        const invalid = (dragSource.type === 'container' && wouldCreateCycle(dragSource.id, containerId)) || (dragSource.origin === containerId);
        if(!invalid){ e.preventDefault(); clearDragOver(); dropzone.classList.add('drag-over'); return; }
      }
      if(entryEl){
        const isSelf = entryEl.dataset.entryType === dragSource.type && entryEl.dataset.id === dragSource.id;
        if(!isSelf){ e.preventDefault(); clearDragOver(); entryEl.classList.add('drag-over'); }
      }
    });
    listEl.addEventListener('drop', (e)=>{
      if(!dragSource) return;
      const dropzone = e.target.closest('.container-dropzone');
      const entryEl = e.target.closest('[data-entry]');
      if(dropzone){
        const containerId = dropzone.dataset.containerId;
        const invalid = (dragSource.type === 'container' && wouldCreateCycle(dragSource.id, containerId)) || (dragSource.origin === containerId);
        if(!invalid){ e.preventDefault(); dropIntoContainer(containerId); return; }
      }
      if(entryEl){
        const isSelf = entryEl.dataset.entryType === dragSource.type && entryEl.dataset.id === dragSource.id;
        if(!isSelf){ e.preventDefault(); dropOnEntry(entryEl, e); return; }
      }
      dragSource = null;
    });
  }
  attachDragHandlers(document.getElementById('unified-list'));
  attachDragHandlers(document.getElementById('transport-personal-list'));
  attachDragHandlers(document.getElementById('transport-public-list'));
  attachDragHandlers(document.getElementById('compartments-list'));

  function dropIntoContainer(containerId){
    const type = dragSource.type, id = dragSource.id;
    const cost = entrySlotCost(type, id);
    const originList = resolveList(dragSource.origin);
    const comp = state.compartments.find(c => c.id === containerId);
    if(comp){
      removeFromEverywhere(type, id);
      comp.contents.push({type, id});
      sanitizeAmmoLinks();
      dragSource = null; renderAll(); saveState();
      return;
    }
    removeFromEverywhere(type, id);
    const c = state.containers.find(c => c.id === containerId);
    if(c && containerUsedSlots(c) + cost <= c.maxSlots){ c.contents.push({type, id}); }
    else { originList.push({type, id}); flashStatus('RECIPIENTE CHEIO'); }
    dragSource = null; renderAll(); saveState();
  }

  function dropOnEntry(entryEl, e){
    const targetType = entryEl.dataset.entryType, targetId = entryEl.dataset.id, targetList = entryEl.dataset.list;
    const isContainerTarget = targetList !== 'top' && targetList !== 'transport-personal' && targetList !== 'transport-public';
    if(dragSource.type === 'container' && isContainerTarget && wouldCreateCycle(dragSource.id, targetList)){ flashStatus('MOVIMENTO INVÁLIDO'); dragSource = null; return; }
    const rect = entryEl.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const type = dragSource.type, id = dragSource.id;
    const cost = entrySlotCost(type, id);
    const originList = resolveList(dragSource.origin);
    removeFromEverywhere(type, id);

    if(isContainerTarget){
      const destContainer = state.containers.find(c => c.id === targetList);
      if(destContainer && containerUsedSlots(destContainer) + cost > destContainer.maxSlots){
        originList.push({type, id}); flashStatus('RECIPIENTE CHEIO'); dragSource = null; renderAll(); saveState(); return;
      }
    }
    const destList = resolveList(targetList);
    let idx = destList.findIndex(en => en.type === targetType && en.id === targetId);
    if(idx === -1) idx = destList.length;
    if(!before) idx += 1;
    destList.splice(idx, 0, {type, id});
    dragSource = null; renderAll(); saveState();
  }

  // ---- busca e filtros ----
  const searchToggleBtn = document.getElementById('search-toggle');
  const searchPanel = document.getElementById('search-panel');
  const searchToggleCount = document.getElementById('search-toggle-count');
  let searchPanelOpen = false;

  function updateSearchToggleCount(){
    const n = (searchQuery.trim() ? 1 : 0) + (activeTagFilter ? 1 : 0);
    searchToggleCount.style.display = n > 0 ? 'inline-block' : 'none';
    searchToggleCount.textContent = n > 0 ? (n === 1 ? '1 ativo' : n + ' ativos') : '';
  }
  searchToggleBtn.addEventListener('click', ()=>{
    searchPanelOpen = !searchPanelOpen;
    searchPanel.classList.toggle('open', searchPanelOpen);
    searchToggleBtn.classList.toggle('open', searchPanelOpen);
    if(searchPanelOpen) setTimeout(()=> searchInput.focus(), 200);
  });

  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear');
  searchInput.addEventListener('input', ()=>{
    searchQuery = searchInput.value;
    searchClearBtn.style.display = searchQuery ? 'flex' : 'none';
    updateSearchToggleCount();
    renderUnifiedList(); renderTransportList();
  });
  searchClearBtn.addEventListener('click', ()=>{ searchQuery = ''; searchInput.value = ''; searchClearBtn.style.display = 'none'; updateSearchToggleCount(); renderUnifiedList(); renderTransportList(); });
  document.getElementById('tag-chip-row').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-tagfilter]');
    if(!btn) return;
    const tag = btn.dataset.tagfilter;
    activeTagFilter = activeTagFilter === tag ? null : tag;
    updateSearchToggleCount();
    renderTagChips(); renderUnifiedList(); renderTransportList();
  });

  // ---- botão "+" de slot de equipamento ----
  const slotTriggerBtn = document.getElementById('slot-trigger');
  const slotFormWrap = document.getElementById('slot-form-wrap');
  const slotNameInput = document.getElementById('slot-name-input');
  const slotReduceInput = document.getElementById('slot-reduce-input');

  function updateSlotFormUI(){ slotTriggerBtn.style.display = slotFormOpen ? 'none' : 'block'; slotFormWrap.style.display = slotFormOpen ? 'block' : 'none'; }
  function resetSlotForm(){ slotNameInput.value = ''; slotReduceInput.checked = false; selectedIconKey = Object.keys(ICONS)[0]; renderIconPicker(); }
  slotTriggerBtn.addEventListener('click', ()=>{ slotFormOpen = true; updateSlotFormUI(); resetSlotForm(); slotNameInput.focus(); });
  document.getElementById('slot-form-close').addEventListener('click', ()=>{ slotFormOpen = false; updateSlotFormUI(); });
  document.getElementById('icon-picker').addEventListener('click', (e)=>{ const btn = e.target.closest('button[data-icon]'); if(!btn) return; selectedIconKey = btn.dataset.icon; renderIconPicker(); });
  document.getElementById('submit-slot').addEventListener('click', ()=>{
    const name = slotNameInput.value.trim();
    if(!name){ slotNameInput.focus(); return; }
    const key = 'slot' + uid();
    state.equipSlots.push({ key, label: name.toUpperCase(), icon: selectedIconKey, reduceWeight: slotReduceInput.checked });
    state.equip[key] = '';
    resetSlotForm(); slotNameInput.focus(); renderAll(); saveState();
  });

  // ---- botão "+" de novo compartimento (público) ----
  let compartmentFormOpen = false;
  const compartmentTriggerBtn = document.getElementById('compartment-trigger');
  const compartmentFormWrap = document.getElementById('compartment-form-wrap');
  const compartmentNameInput = document.getElementById('compartment-name-input');
  function updateCompartmentFormUI(){
    compartmentTriggerBtn.style.display = compartmentFormOpen ? 'none' : 'block';
    compartmentFormWrap.style.display = compartmentFormOpen ? 'block' : 'none';
  }
  compartmentTriggerBtn.addEventListener('click', ()=>{
    compartmentFormOpen = true; updateCompartmentFormUI();
    compartmentNameInput.value = ''; compartmentNameInput.focus();
  });
  document.getElementById('compartment-form-close').addEventListener('click', ()=>{
    compartmentFormOpen = false; updateCompartmentFormUI();
  });
  document.getElementById('compartment-submit-btn').addEventListener('click', ()=>{
    const name = compartmentNameInput.value.trim();
    if(!name){ compartmentNameInput.focus(); return; }
    state.compartments.push({ id: uid(), name, collapsed:false, currency:{bronze:0,silver:0,gold:0,platinum:0}, contents:[] });
    compartmentNameInput.value = '';
    addLog(`Compartimento "${name}" criado`);
    renderAll(); saveState();
  });
  compartmentNameInput.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') document.getElementById('compartment-submit-btn').click(); });

  document.getElementById('slots-grid').addEventListener('click', (e)=>{
    const removeBtn = e.target.closest('button[data-remove-slot]');
    if(removeBtn){
      const key = removeBtn.dataset.removeSlot;
      state.equipSlots = state.equipSlots.filter(s => s.key !== key);
      delete state.equip[key];
      renderAll(); saveState();
      return;
    }
    const pickBtn = e.target.closest('button[data-equip-pick]');
    if(pickBtn){
      const slotKey = pickBtn.dataset.slot;
      const val = pickBtn.dataset.equipPick || '';
      if(val){ Object.keys(state.equip).forEach(k => { if(state.equip[k] === val) state.equip[k] = ''; }); }
      state.equip[slotKey] = val;
      equipSearchOpenFor = null; equipSearchQuery = '';
      renderAll(); saveState();
    }
  });

  // impede que o clique num item do dropdown feche o campo antes do click ser processado
  document.getElementById('slots-grid').addEventListener('mousedown', (e)=>{
    if(e.target.closest('.equip-search-dropdown')) e.preventDefault();
  });

  document.getElementById('slots-grid').addEventListener('focusin', (e)=>{
    const inp = e.target.closest('.equip-search-input');
    if(!inp) return;
    if(equipSearchOpenFor === inp.dataset.slot) return; // já está aberto pra esse slot, evita re-render em loop
    equipSearchOpenFor = inp.dataset.slot;
    equipSearchQuery = '';
    renderSlots();
    const fresh = document.querySelector(`.equip-search-input[data-slot="${CSS.escape(equipSearchOpenFor)}"]`);
    if(fresh){ fresh.focus(); fresh.select(); }
  });

  document.getElementById('slots-grid').addEventListener('input', (e)=>{
    const inp = e.target.closest('.equip-search-input');
    if(!inp) return;
    equipSearchQuery = inp.value;
    renderSlots();
    const fresh = document.querySelector(`.equip-search-input[data-slot="${CSS.escape(inp.dataset.slot)}"]`);
    if(fresh){ fresh.focus(); const v = fresh.value; fresh.value = ''; fresh.value = v; }
  });

  document.getElementById('slots-grid').addEventListener('focusout', (e)=>{
    const inp = e.target.closest('.equip-search-input');
    if(!inp) return;
    const slotKey = inp.dataset.slot;
    setTimeout(()=>{
      // só fecha se o foco realmente saiu do campo de busca desse slot
      // (a re-renderização recria o input, então um blur "falso" acontece toda vez que abrimos)
      const active = document.activeElement;
      const stillOnThisSlot = active && active.classList && active.classList.contains('equip-search-input') && active.dataset.slot === slotKey;
      const clickedInsideDropdown = active && active.closest && active.closest('.equip-search-dropdown');
      if(!stillOnThisSlot && !clickedInsideDropdown && equipSearchOpenFor === slotKey){
        equipSearchOpenFor = null; equipSearchQuery = '';
        renderSlots();
      }
    }, 150);
  });

  document.getElementById('max-carga-input').addEventListener('input', (e)=>{
    state.maxCarga = Math.max(0, parseFloat(e.target.value) || 0);
    renderGauge(); saveState();
  });
  document.getElementById('max-carga-input-personal').addEventListener('input', (e)=>{
    state.transportPersonalMaxCarga = Math.max(0, parseFloat(e.target.value) || 0);
    renderTransportGauge(); saveState();
  });
  document.getElementById('max-carga-input-public').addEventListener('input', (e)=>{
    state.transportPublicMaxCarga = Math.max(0, parseFloat(e.target.value) || 0);
    renderTransportGauge(); saveState();
  });

  // ---- moedas ----
  function setupCurrencyWidget(getCurrencyObj, suffix, wrapId, statusMsg, logLabel){
    const strip = document.getElementById('currency-strip' + suffix);
    const menu = document.getElementById('currency-edit-menu' + suffix);
    strip.addEventListener('click', ()=>{
      const currencyObj = getCurrencyObj();
      const opening = menu.style.display === 'none';
      menu.style.display = opening ? 'flex' : 'none';
      if(opening){
        document.getElementById('currency-input-bronze' + suffix).value = currencyObj.bronze;
        document.getElementById('currency-input-silver' + suffix).value = currencyObj.silver;
        document.getElementById('currency-input-gold' + suffix).value = currencyObj.gold;
        document.getElementById('currency-input-platinum' + suffix).value = currencyObj.platinum;
        setTimeout(()=> document.getElementById('currency-input-bronze' + suffix).focus(), 10);
      }
    });
    document.addEventListener('click', (e)=>{ if(!e.target.closest('#' + wrapId)) menu.style.display = 'none'; });
    function save(){
      const currencyObj = getCurrencyObj();
      currencyObj.bronze = Math.max(0, parseInt(document.getElementById('currency-input-bronze' + suffix).value) || 0);
      currencyObj.silver = Math.max(0, parseInt(document.getElementById('currency-input-silver' + suffix).value) || 0);
      currencyObj.gold = Math.max(0, parseInt(document.getElementById('currency-input-gold' + suffix).value) || 0);
      currencyObj.platinum = Math.max(0, parseInt(document.getElementById('currency-input-platinum' + suffix).value) || 0);
      normalizeCurrencyObj(currencyObj);
      renderCurrency();
      menu.style.display = 'none';
      if(statusMsg) flashStatus(statusMsg);
      addLog(`Moedas de ${logLabel} editadas`);
      saveState();
    }
    document.getElementById('currency-save-btn' + suffix).addEventListener('click', save);
    menu.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') save(); });
  }
  setupCurrencyWidget(() => state.currency, '', 'currency-wrap', null, 'Pessoal');
  setupCurrencyWidget(() => state.currencyPublic, '-public', 'currency-wrap-public', 'MOEDAS DO PÚBLICO ATUALIZADAS', 'Público (avulso)');

  // ---- transferir moedas entre pessoal, público avulso e compartimentos específicos ----
  function currencyToBronzeValue(c){
    return (c.bronze || 0) + (c.silver || 0) * 100 + (c.gold || 0) * 10000 + (c.platinum || 0) * 1000000;
  }
  function bronzeValueToCurrency(total){
    total = Math.max(0, Math.round(total));
    const platinum = Math.floor(total / 1000000); total %= 1000000;
    const gold = Math.floor(total / 10000); total %= 10000;
    const silver = Math.floor(total / 100); total %= 100;
    return { bronze: total, silver, gold, platinum };
  }
  function transferCurrency(fromObj, toObj, amounts){
    const requestedValue = currencyToBronzeValue(amounts);
    if(requestedValue <= 0) return false;
    const fromValue = currencyToBronzeValue(fromObj);
    if(fromValue < requestedValue) return false; // não dá nem quebrando as moedas maiores

    const newFrom = bronzeValueToCurrency(fromValue - requestedValue);
    const newTo = bronzeValueToCurrency(currencyToBronzeValue(toObj) + requestedValue);
    fromObj.bronze = newFrom.bronze; fromObj.silver = newFrom.silver; fromObj.gold = newFrom.gold; fromObj.platinum = newFrom.platinum;
    toObj.bronze = newTo.bronze; toObj.silver = newTo.silver; toObj.gold = newTo.gold; toObj.platinum = newTo.platinum;
    return true;
  }
  function resolveCurrencyTarget(value){
    if(value === 'personal') return state.currency;
    if(value === 'public') return state.currencyPublic;
    if(value && value.indexOf('comp:') === 0){
      const comp = state.compartments.find(c => c.id === value.slice(5));
      return comp ? comp.currency : null;
    }
    return null;
  }
  function transferTargetLabel(value){
    if(value === 'personal') return 'Pessoal';
    if(value === 'public') return 'Público (avulso)';
    if(value && value.indexOf('comp:') === 0){
      const comp = state.compartments.find(c => c.id === value.slice(5));
      return comp ? comp.name : 'compartimento';
    }
    return value;
  }
  function populateTransferSelects(){
    const opts = [
      { value: 'personal', label: 'Pessoal' },
      { value: 'public', label: 'Público (avulso)' },
      ...state.compartments.map(c => ({ value: 'comp:' + c.id, label: c.name }))
    ];
    const optHtml = opts.map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('');
    const fromSel = document.getElementById('transfer-from-select');
    const toSel = document.getElementById('transfer-to-select');
    fromSel.innerHTML = optHtml;
    toSel.innerHTML = optHtml;
    fromSel.value = 'personal';
    toSel.value = 'public';
  }
  const transferBtn = document.getElementById('currency-transfer-btn');
  const transferMenu = document.getElementById('currency-transfer-menu');
  transferBtn.addEventListener('click', ()=>{
    const opening = transferMenu.style.display === 'none';
    transferMenu.style.display = opening ? 'flex' : 'none';
    if(opening){
      populateTransferSelects();
      ['bronze','silver','gold','platinum'].forEach(k => { document.getElementById('transfer-input-' + k).value = 0; });
      setTimeout(()=> document.getElementById('transfer-input-bronze').focus(), 10);
    }
  });
  document.getElementById('currency-transfer-confirm').addEventListener('click', ()=>{
    const amounts = {
      bronze: Math.max(0, parseInt(document.getElementById('transfer-input-bronze').value) || 0),
      silver: Math.max(0, parseInt(document.getElementById('transfer-input-silver').value) || 0),
      gold: Math.max(0, parseInt(document.getElementById('transfer-input-gold').value) || 0),
      platinum: Math.max(0, parseInt(document.getElementById('transfer-input-platinum').value) || 0),
    };
    if(!amounts.bronze && !amounts.silver && !amounts.gold && !amounts.platinum){ flashStatus('INFORME ALGUM VALOR PRA TRANSFERIR'); return; }
    const fromKey = document.getElementById('transfer-from-select').value;
    const toKey = document.getElementById('transfer-to-select').value;
    if(fromKey === toKey){ flashStatus('ORIGEM E DESTINO SÃO OS MESMOS'); return; }
    const from = resolveCurrencyTarget(fromKey);
    const to = resolveCurrencyTarget(toKey);
    if(!from || !to){ flashStatus('DESTINO INVÁLIDO'); return; }
    const ok = transferCurrency(from, to, amounts);
    if(ok){
      renderCurrency();
      renderTransportList(); // atualiza os cartões de compartimento também, caso a moeda deles tenha mudado
      transferMenu.style.display = 'none';
      const summary = ['bronze','silver','gold','platinum'].filter(k => amounts[k] > 0).map(k => amounts[k] + ' ' + ({bronze:'bronze',silver:'prata',gold:'ouro',platinum:'platina'})[k]).join(', ');
      flashStatus('ENVIADO: ' + transferTargetLabel(fromKey) + ' → ' + transferTargetLabel(toKey));
      addLog(`Transferência: ${transferTargetLabel(fromKey)} → ${transferTargetLabel(toKey)} (${summary})`);
      saveState();
    } else {
      flashStatus('SALDO INSUFICIENTE NA ORIGEM');
    }
  });
  document.addEventListener('click', (e)=>{ if(!e.target.closest('#currency-wrap')) transferMenu.style.display = 'none'; });
  document.addEventListener('click', (e)=>{ if(!e.target.closest('.comp-currency-wrap') && compCurrencyEditFor !== null){ compCurrencyEditFor = null; renderTransportList(); } });

  document.querySelectorAll('#inventory-mode-wrap .tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#inventory-mode-wrap .tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#inventory-mode-wrap .panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  document.querySelectorAll('.transport-subtab-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.transport-subtab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#transport-mode-wrap .panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-transport-' + btn.dataset.transportTab).classList.add('active');
    });
  });

  // ---- alternância de modo (inventário <-> baú do veículo) ----
  function setMode(mode){
    currentMode = mode;
    const invWrap = document.getElementById('inventory-mode-wrap');
    const transWrap = document.getElementById('transport-mode-wrap');
    const vehicleBtn = document.getElementById('vehicle-dropzone');
    const backpackBtn = document.getElementById('backpack-return-btn');
    const titleText = document.getElementById('main-title-text');
    const copyBtn = document.getElementById('copy-fab');
    if(mode === 'transport'){
      invWrap.style.display = 'none';
      transWrap.style.display = 'block';
      transWrap.classList.remove('mode-fade-in'); void transWrap.offsetWidth; transWrap.classList.add('mode-fade-in');
      vehicleBtn.style.display = 'none';
      backpackBtn.style.display = 'flex';
      titleText.textContent = 'BAÚ DO VEÍCULO';
      copyBtn.title = 'copiar baú do veículo para a área de transferência';
    } else {
      transWrap.style.display = 'none';
      invWrap.style.display = 'block';
      invWrap.classList.remove('mode-fade-in'); void invWrap.offsetWidth; invWrap.classList.add('mode-fade-in');
      vehicleBtn.style.display = 'flex';
      backpackBtn.style.display = 'none';
      titleText.textContent = 'INVENTÁRIO';
      copyBtn.title = 'copiar inventário para a área de transferência';
    }
  }

  // ---- ícone do veículo (baú de transporte, sem limite de carga, mundo à parte) ----
  const vehicleZone = document.getElementById('vehicle-dropzone');
  vehicleZone.addEventListener('dragover', (e)=>{
    if(!dragSource) return;
    e.preventDefault();
    vehicleZone.classList.add('drag-over');
  });
  vehicleZone.addEventListener('dragleave', ()=>{ vehicleZone.classList.remove('drag-over'); });
  vehicleZone.addEventListener('drop', (e)=>{
    e.preventDefault();
    vehicleZone.classList.remove('drag-over');
    if(!dragSource) return;
    const type = dragSource.type, id = dragSource.id;
    const name = entryName(type, id);
    clearEquipForSubtree(type, id); // itens guardados no veículo não podem continuar equipados
    removeFromEverywhere(type, id);
    state.transportPersonal.push({type, id});
    sanitizeAmmoLinks(); // desfaz vínculos de munição que cruzariam os mundos
    dragSource = null;
    addLog(`"${name}" guardado no Espaço Pessoal (veículo)`);
    renderAll(); saveState();
    flashStatus('GUARDADO NO ESPAÇO PESSOAL');
  });
  vehicleZone.addEventListener('click', ()=> setMode('transport'));

  const backpackZone = document.getElementById('backpack-return-btn');
  backpackZone.addEventListener('dragover', (e)=>{
    if(!dragSource) return;
    e.preventDefault();
    backpackZone.classList.add('drag-over');
  });
  backpackZone.addEventListener('dragleave', ()=>{ backpackZone.classList.remove('drag-over'); });
  backpackZone.addEventListener('drop', (e)=>{
    e.preventDefault();
    backpackZone.classList.remove('drag-over');
    if(!dragSource) return;
    const type = dragSource.type, id = dragSource.id;
    const name = entryName(type, id);
    removeFromEverywhere(type, id);
    state.order.push({type, id});
    sanitizeAmmoLinks(); // desfaz vínculos de munição que cruzariam os dois mundos
    dragSource = null;
    addLog(`"${name}" devolvido ao inventário (mochila)`);
    renderAll(); saveState();
    flashStatus('DEVOLVIDO AO INVENTÁRIO');
  });
  backpackZone.addEventListener('click', ()=> setMode('inventory'));

  // ---- copiar inventário ou baú do veículo (formato estilo Discord) ----
  function slotEquipLabel(val){
    if(!val) return '—';
    const [t,id] = val.split(':');
    if(t === 'item'){ const it = state.items.find(i => i.id === id); return it ? it.name : '—'; }
    if(t === 'container'){ const c = state.containers.find(c => c.id === id); return c ? c.name : '—'; }
    return '—';
  }
  function itemCopyLine(it){
    const qtyTxt = it.qty > 1 ? ` (x${it.qty})` : '';
    const durTxt = (it.maxDurability !== null && it.maxDurability !== undefined) ? ` (DU: ${it.durability}/${it.maxDurability})` : '';
    return `${it.name}${qtyTxt}${durTxt}`;
  }
  function appendContainerLines(lines, c, depth){
    const indent = '  '.repeat(depth);
    const used = containerUsedSlots(c);
    const tot = round(containerIntrinsicTotal(c));
    lines.push(`${indent}📦 ${c.name} (${used}/${c.maxSlots} slots, ${tot} carga)`);
    c.contents.forEach(entry => {
      if(entry.type === 'item'){
        const it = state.items.find(i => i.id === entry.id);
        if(it) lines.push(`${indent}  • ${itemCopyLine(it)}`);
      } else {
        const nested = state.containers.find(cc => cc.id === entry.id);
        if(nested) appendContainerLines(lines, nested, depth + 1);
      }
    });
  }
  function buildInventoryText(){
    const lines = [];
    const total = round(totalWeight());
    const max = round(state.maxCarga);
    lines.push('╔════════ INVENTÁRIO ════════╗');
    lines.push(` 🎒 Carga: ${total}/${max}`);
    lines.push('─────────────────────────────');

    const topItems = state.order.filter(e => e.type === 'item').map(e => state.items.find(i => i.id === e.id)).filter(Boolean);
    const grouped = {};
    topItems.forEach(it => { const tag = it.tag || 'outro'; if(!grouped[tag]) grouped[tag] = []; grouped[tag].push(it); });
    TAG_ORDER.forEach(tagKey => {
      if(!grouped[tagKey]) return;
      const def = TAGS[tagKey];
      lines.push(`${def.emoji} ${def.label}:`);
      grouped[tagKey].forEach(it => lines.push(`  • ${itemCopyLine(it)}`));
      lines.push('');
    });

    const topContainers = state.order.filter(e => e.type === 'container').map(e => state.containers.find(c => c.id === e.id)).filter(Boolean);
    if(topContainers.length){
      lines.push('🎒 Recipientes:');
      topContainers.forEach(c => appendContainerLines(lines, c, 1));
      lines.push('');
    }

    while(lines.length && lines[lines.length-1] === '') lines.pop();
    lines.push('╚═══════════════════════════╝');
    lines.push('');
    lines.push('╔════════ EQUIPAMENTO ═══════╗');
    state.equipSlots.forEach(slot => lines.push(`${slot.label}: ${slotEquipLabel(state.equip[slot.key])}`));
    lines.push('╚═══════════════════════════╝');
    return lines.join('\n');
  }

  function buildTransportSection(lines, list, title, emoji){
    const total = round(transportListWeight(list));
    const topItems = list.filter(e => e.type === 'item').map(e => state.items.find(i => i.id === e.id)).filter(Boolean);
    const topContainers = list.filter(e => e.type === 'container').map(e => state.containers.find(c => c.id === e.id)).filter(Boolean);

    lines.push(`${emoji} ${title} (${total} carga):`);
    if(topItems.length === 0 && topContainers.length === 0){
      lines.push('  (vazio)');
      lines.push('');
      return;
    }
    const grouped = {};
    topItems.forEach(it => { const tag = it.tag || 'outro'; if(!grouped[tag]) grouped[tag] = []; grouped[tag].push(it); });
    TAG_ORDER.forEach(tagKey => {
      if(!grouped[tagKey]) return;
      const def = TAGS[tagKey];
      lines.push(`  ${def.emoji} ${def.label}:`);
      grouped[tagKey].forEach(it => lines.push(`    • ${itemCopyLine(it)}`));
    });
    if(topContainers.length){
      lines.push('  📦 Recipientes:');
      topContainers.forEach(c => appendContainerLines(lines, c, 2));
    }
    lines.push('');
  }
  function buildTransportText(){
    const lines = [];
    lines.push('╔══════ BAÚ DO VEÍCULO ══════╗');
    buildTransportSection(lines, state.transportPersonal, 'Espaço Pessoal', '🎒');
    buildTransportSection(lines, state.transportPublic, 'Público', '🌐');
    while(lines.length && lines[lines.length-1] === '') lines.pop();
    lines.push('╚═══════════════════════════╝');
    return lines.join('\n');
  }

  function showCopyFeedback(ok, msg){
    const el = document.getElementById('copy-feedback');
    el.textContent = ok ? (msg || 'COPIADO!') : 'FALHOU — copie manualmente';
    el.classList.add('show');
    clearTimeout(showCopyFeedback._t);
    showCopyFeedback._t = setTimeout(()=> el.classList.remove('show'), 1800);
  }
  async function copyTextToClipboard(text, feedbackMsg){
    try{
      await navigator.clipboard.writeText(text);
      showCopyFeedback(true, feedbackMsg);
    }catch(e){
      try{
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        showCopyFeedback(true, feedbackMsg);
      }catch(err){ showCopyFeedback(false); }
    }
  }
  async function copyInventoryToClipboard(){
    const text = currentMode === 'transport' ? buildTransportText() : buildInventoryText();
    copyTextToClipboard(text);
  }
  document.getElementById('copy-fab').addEventListener('click', copyInventoryToClipboard);

  // ---- desfazer: captura o estado antes de qualquer clique/drop e compara depois ----
  document.addEventListener('click', (e)=>{
    if(e.target.closest('#undo-trigger')) return; // não grava o próprio clique de "desfazer" como uma ação anulável
    const before = snapshotState();
    setTimeout(()=> pushUndoIfChanged(before), 0);
  }, true);
  document.addEventListener('drop', (e)=>{
    const before = snapshotState();
    setTimeout(()=> pushUndoIfChanged(before), 0);
  }, true);

  document.getElementById('undo-trigger').addEventListener('click', performUndo);
  document.addEventListener('keydown', (e)=>{
    if((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')){
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if(activeTag === 'INPUT' || activeTag === 'TEXTAREA') return; // deixa o undo nativo do campo de texto funcionar
      e.preventDefault();
      performUndo();
    }
  });

  // ---- painel de log de atividade ----
  const logTriggerBtn = document.getElementById('log-trigger');
  const logPanel = document.getElementById('log-panel');
  logTriggerBtn.addEventListener('click', ()=>{
    logPanel.style.display = logPanel.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', (e)=>{ if(!e.target.closest('#log-picker-wrap')) logPanel.style.display = 'none'; });

  // ---- painel de resumo rápido ----
  const summaryTriggerBtn = document.getElementById('summary-trigger');
  const summaryPanel = document.getElementById('summary-panel');
  summaryTriggerBtn.addEventListener('click', ()=>{
    const opening = summaryPanel.style.display === 'none';
    summaryPanel.style.display = opening ? 'block' : 'none';
    if(opening) renderSummary();
  });
  document.addEventListener('click', (e)=>{ if(!e.target.closest('#summary-picker-wrap')) summaryPanel.style.display = 'none'; });

  // ---- barra de seleção em lote ----
  document.querySelectorAll('button[data-batch-move]').forEach(btn => {
    btn.addEventListener('click', ()=> moveSelectedTo(btn.dataset.batchMove));
  });
  let batchDeleteConfirming = false;
  let batchDeleteTimeout = null;
  const batchDeleteBtn = document.getElementById('batch-delete-btn');
  batchDeleteBtn.addEventListener('click', ()=>{
    if(!batchDeleteConfirming){
      batchDeleteConfirming = true;
      batchDeleteBtn.classList.add('confirm-pending');
      batchDeleteBtn.textContent = 'confirmar?';
      clearTimeout(batchDeleteTimeout);
      batchDeleteTimeout = setTimeout(()=>{
        batchDeleteConfirming = false;
        batchDeleteBtn.classList.remove('confirm-pending');
        batchDeleteBtn.textContent = 'Excluir';
      }, 3000);
      return;
    }
    clearTimeout(batchDeleteTimeout);
    batchDeleteConfirming = false;
    batchDeleteBtn.classList.remove('confirm-pending');
    batchDeleteBtn.textContent = 'Excluir';
    performBatchDelete();
  });
  document.getElementById('batch-cancel-btn').addEventListener('click', clearSelection);
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && selectedEntries.size > 0){
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if(activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      clearSelection();
    }
  });

  renderActivityLog();
  updateUndoButton();

  loadState();

}
