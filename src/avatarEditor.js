// Editor de posição de avatar -- estilo Discord: escolhe uma imagem,
// arrasta pra escolher onde ela fica centralizada, ajusta o zoom, e
// confirma. Diferente de guardar só um "focal point" (que exigiria
// ensinar TODO lugar que mostra avatar -- ficha, dashboard do mestre,
// combate, banco de NPCs -- a respeitar isso), esse editor já EXPORTA
// a imagem final recortada em quadrado (canvas -> blob): todo mundo
// que já mostra avatar_url continua funcionando exatamente igual, sem
// mudar mais nada em lugar nenhum.
//
// Overlay próprio, igual easterEggGames.js (anexado no document.body,
// sobrevive a qualquer re-render da tela por baixo) -- reaproveita as
// classes .easter-egg-overlay/.easter-egg-panel/.easter-egg-close já
// existentes (ver games.css) pro visual bater com o resto do site.
const VIEWPORT = 260; // tamanho do quadrado de prévia (CSS px)
const OUTPUT = 480; // resolução do recorte final exportado
const MIN_ZOOM = 1; // 1x = a imagem já cobre o viewport inteiro (equivalente a object-fit:cover)
const MAX_ZOOM = 4;

// devolve uma Promise<Blob|null> -- null se o usuário cancelar/fechar
// sem confirmar. `file` é o File escolhido no <input type="file">.
export function openAvatarEditor(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    let root = document.getElementById('avatar-editor-root');
    if (root) root.remove(); // se por algum motivo já tinha um aberto, não empilha dois
    root = document.createElement('div');
    root.id = 'avatar-editor-root';
    document.body.appendChild(root);

    root.innerHTML = `
      <div class="easter-egg-overlay">
        <div class="easter-egg-panel avatar-editor-panel">
          <button type="button" class="easter-egg-close" id="avatar-editor-close" title="cancelar">✕</button>
          <div class="ee-title">📷 posicione a foto</div>
          <div class="avatar-editor-canvas-wrap">
            <canvas id="avatar-editor-canvas" width="${VIEWPORT}" height="${VIEWPORT}"></canvas>
            <div class="avatar-editor-circle-guide"></div>
          </div>
          <div class="avatar-editor-zoom-row">
            <span>🔍</span>
            <input type="range" id="avatar-editor-zoom" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.01" value="${MIN_ZOOM}">
          </div>
          <p class="avatar-editor-hint">arraste a imagem pra reposicionar · role o mouse ou use o controle pra dar zoom</p>
          <div class="avatar-editor-actions">
            <button type="button" class="btn" id="avatar-editor-confirm" disabled>usar essa foto</button>
            <button type="button" class="btn btn-ghost" id="avatar-editor-cancel">cancelar</button>
          </div>
        </div>
      </div>`;

    const canvas = root.querySelector('#avatar-editor-canvas');
    const ctx = canvas.getContext('2d');
    const zoomInput = root.querySelector('#avatar-editor-zoom');
    const confirmBtn = root.querySelector('#avatar-editor-confirm');
    // canvas em resolução real de tela (nitidez em telas de alta densidade,
    // ex: retina) -- o CSS mantém o tamanho visual em VIEWPORTxVIEWPORT.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = VIEWPORT * dpr;
    canvas.height = VIEWPORT * dpr;
    canvas.style.width = VIEWPORT + 'px';
    canvas.style.height = VIEWPORT + 'px';

    let coverScale = 1; // escala que faz a imagem cobrir o viewport inteiro (zoom=1)
    let zoom = MIN_ZOOM;
    let offsetX = 0; // deslocamento do CENTRO da imagem em relação ao centro do viewport, em px de VIEWPORT
    let offsetY = 0;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragOffX0 = 0;
    let dragOffY0 = 0;

    function effectiveScale() {
      return coverScale * zoom;
    }
    // trava o deslocamento pra imagem nunca deixar uma borda vazia
    // aparecer dentro do viewport (mesma ideia de object-fit:cover,
    // só que o usuário ainda pode escolher ONDE dentro da imagem).
    function clampOffsets() {
      const scale = effectiveScale();
      const halfW = (img.naturalWidth * scale) / 2;
      const halfH = (img.naturalHeight * scale) / 2;
      const maxX = Math.max(0, halfW - VIEWPORT / 2);
      const maxY = Math.max(0, halfH - VIEWPORT / 2);
      offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
      offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    }
    function draw() {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, VIEWPORT, VIEWPORT);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, VIEWPORT, VIEWPORT);
      const scale = effectiveScale();
      ctx.save();
      ctx.translate(VIEWPORT / 2 + offsetX, VIEWPORT / 2 + offsetY);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
      ctx.restore();
    }

    function pointerPos(e) {
      const rect = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: p.clientX - rect.left, y: p.clientY - rect.top };
    }
    function startDrag(e) {
      dragging = true;
      const p = pointerPos(e);
      dragStartX = p.x;
      dragStartY = p.y;
      dragOffX0 = offsetX;
      dragOffY0 = offsetY;
    }
    function moveDrag(e) {
      if (!dragging) return;
      e.preventDefault();
      const p = pointerPos(e);
      offsetX = dragOffX0 + (p.x - dragStartX);
      offsetY = dragOffY0 + (p.y - dragStartY);
      clampOffsets();
      draw();
    }
    function endDrag() {
      dragging = false;
    }

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      startDrag(e);
    });
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom - e.deltaY * 0.0015));
        zoomInput.value = zoom;
        clampOffsets();
        draw();
      },
      { passive: false }
    );
    zoomInput.addEventListener('input', () => {
      zoom = parseFloat(zoomInput.value);
      clampOffsets();
      draw();
    });

    function finish(blob) {
      URL.revokeObjectURL(objectUrl);
      root.remove();
      resolve(blob);
    }
    root.querySelector('#avatar-editor-close').addEventListener('click', () => finish(null));
    root.querySelector('#avatar-editor-cancel').addEventListener('click', () => finish(null));
    root.querySelector('#avatar-editor-confirm').addEventListener('click', () => {
      // mesmo desenho da prévia, só que numa resolução maior (OUTPUT em
      // vez de VIEWPORT) -- escala tudo (posição e zoom) pela mesma
      // razão OUTPUT/VIEWPORT, resultado é o recorte EXATO que a
      // prévia mostrava, só em alta resolução.
      const ratio = OUTPUT / VIEWPORT;
      const out = document.createElement('canvas');
      out.width = OUTPUT;
      out.height = OUTPUT;
      const octx = out.getContext('2d');
      octx.fillStyle = '#000';
      octx.fillRect(0, 0, OUTPUT, OUTPUT);
      octx.translate(OUTPUT / 2 + offsetX * ratio, OUTPUT / 2 + offsetY * ratio);
      octx.scale(effectiveScale() * ratio, effectiveScale() * ratio);
      octx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      out.toBlob((blob) => finish(blob), 'image/jpeg', 0.92);
    });

    img.onload = () => {
      coverScale = Math.max(VIEWPORT / img.naturalWidth, VIEWPORT / img.naturalHeight);
      zoom = MIN_ZOOM;
      offsetX = 0;
      offsetY = 0;
      zoomInput.value = MIN_ZOOM;
      confirmBtn.disabled = false;
      draw();
    };
    img.onerror = () => {
      window.alert('Não consegui abrir essa imagem.');
      finish(null);
    };
    img.src = objectUrl;
  });
}
