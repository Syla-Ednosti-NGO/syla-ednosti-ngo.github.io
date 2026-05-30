/* ======================================================
   Reusable signature widget — draw (signature_pad) OR photo.
   Scoped to a root element via classes (no global ids), so
   multiple widgets can coexist. Mirrors the membership form.

   Markup expected inside `root`:
     .sig-tabs > .sig-tab[data-sig-tab="draw|photo"]
     .sig-panel[data-sig-panel="draw"]  > .sig-canvas-wrap > canvas.signature-canvas
                                         + .btn-clear-sig
     .sig-panel[data-sig-panel="photo"] > .sig-upload-btn > input.sig-photo-input
                                         + .sig-preview-wrap > img.sig-preview + .btn-clear-photo

   Usage:
     const sig = createSignatureWidget(root);
     sig.prepare();            // call once the widget is visible
     sig.getDataURL();         // '' if empty, else PNG/JPEG data URL
   ====================================================== */
function createSignatureWidget(root) {
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => Array.from(root.querySelectorAll(s));

  const canvas = $('.signature-canvas');
  const canvasWrap = canvas.parentElement;
  let pad = null;
  let photoData = '';
  let source = '';
  const listeners = [];

  function fireChange() { listeners.forEach(fn => fn()); }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const data = pad && !pad.isEmpty() ? pad.toData() : null;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    if (pad) {
      pad.clear();
      if (data) pad.fromData(data);
    }
  }

  function initPad() {
    if (pad) return;
    resizeCanvas();
    pad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255,255,255,0)',
      penColor: '#0F1A2E',
      minWidth: 0.8,
      maxWidth: 2.2,
    });
    pad.addEventListener('beginStroke', () => canvasWrap.classList.add('has-content'));
    pad.addEventListener('endStroke', () => {
      if (pad.isEmpty()) canvasWrap.classList.remove('has-content');
      source = 'draw';
      fireChange();
    });
  }

  function prepare() {
    initPad();
    requestAnimationFrame(() => {
      resizeCanvas();
      requestAnimationFrame(resizeCanvas);
    });
  }

  /* tabs */
  $$('.sig-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.sigTab;
      $$('.sig-tab').forEach(t => t.classList.toggle('active', t === tab));
      $$('.sig-panel').forEach(p => p.classList.toggle('active', p.dataset.sigPanel === target));
      if (target === 'draw') prepare();
    });
  });

  /* clear drawing */
  const clearDrawBtn = $('.btn-clear-sig');
  if (clearDrawBtn) clearDrawBtn.addEventListener('click', () => {
    if (pad) { pad.clear(); canvasWrap.classList.remove('has-content'); fireChange(); }
  });

  /* photo upload */
  const photoInput = $('.sig-photo-input');
  const preview = $('.sig-preview');
  const previewWrap = $('.sig-preview-wrap');
  const uploadBtn = $('.sig-upload-btn');

  if (photoInput) photoInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      preview.src = ev.target.result;
      previewWrap.classList.remove('hidden');
      uploadBtn.classList.add('hidden');
      source = 'photo';
      photoData = ev.target.result;
      fireChange();
    };
    reader.readAsDataURL(file);
  });

  const clearPhotoBtn = $('.btn-clear-photo');
  if (clearPhotoBtn) clearPhotoBtn.addEventListener('click', () => {
    photoInput.value = '';
    preview.src = '';
    previewWrap.classList.add('hidden');
    uploadBtn.classList.remove('hidden');
    if (source === 'photo') { photoData = ''; source = ''; }
    fireChange();
  });

  window.addEventListener('resize', () => {
    const drawPanel = $('.sig-panel[data-sig-panel="draw"]');
    if (drawPanel && drawPanel.classList.contains('active')) resizeCanvas();
  });

  return {
    prepare,
    onChange(fn) { listeners.push(fn); },
    isEmpty() { return !this.getDataURL(); },
    getDataURL() {
      const active = $('.sig-panel.active').dataset.sigPanel;
      if (active === 'draw') {
        if (!pad || pad.isEmpty()) return '';
        source = 'draw';
        return pad.toDataURL('image/png');
      }
      return source === 'photo' ? photoData : '';
    },
    clear() {
      if (pad) { pad.clear(); canvasWrap.classList.remove('has-content'); }
      if (photoInput) photoInput.value = '';
      if (preview) preview.src = '';
      if (previewWrap) previewWrap.classList.add('hidden');
      if (uploadBtn) uploadBtn.classList.remove('hidden');
      photoData = ''; source = '';
    },
  };
}
window.createSignatureWidget = createSignatureWidget;
