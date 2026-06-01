/* ===== Admin panel ===== */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
const WORKER = (window.DOCS_CONFIG && window.DOCS_CONFIG.WORKER_URL || '').replace(/\/+$/, '');

/* admin token lives in the URL fragment: admin.html#k=<token> */
function getToken() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  return h.get('k') || '';
}
const TOKEN = getToken();

/* ===== helpers ===== */
const toastEl = $('#toast');
function toast(msg, opts = {}) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', !!opts.error);
  toastEl.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('visible'), opts.ms || 2600);
}
function setError(id, msg) {
  const el = $(`[data-error-for="${id}"]`);
  if (el) el.textContent = msg || '';
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fioOf(s) { return [s.lastName, s.firstName, s.middleName].filter(Boolean).join(' '); }

function api(path, opts = {}) {
  const headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, opts.headers || {});
  return fetch(WORKER + path, Object.assign({}, opts, { headers }));
}

function signLink(token) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, 'sign.html');
  return base + '#t=' + token;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

const STATUS = {
  pending: { label: 'Очікує підписів', cls: 'pill-pending' },
  signing: { label: 'На підписанні', cls: 'pill-signing' },
  signed: { label: 'Підписаний', cls: 'pill-signed' },
};

/* label for the portal-visibility toggle (works for both in-progress and signed docs) */
function portalLabel(doc) {
  if (doc.status === 'signed') return doc.published ? 'Зняти з порталу' : 'Опублікувати';
  return doc.published ? 'Сховати з порталу' : 'Показати на порталі';
}

/* ===== bootstrap ===== */
async function boot() {
  if (!TOKEN || !WORKER) return authFail();
  try {
    const res = await api('/api/admin/ping');
    if (!res.ok) return authFail();
    $('#auth-loading').classList.add('hidden');
    $('#admin-view').classList.remove('hidden');
    wireNewModal();
    $('#btn-new').addEventListener('click', openModal);
    loadDocs();
  } catch {
    authFail();
  }
}
function authFail() {
  $('#auth-loading').classList.add('hidden');
  $('#auth-error').classList.remove('hidden');
}

/* ===== list ===== */
async function loadDocs() {
  const list = $('#doc-list');
  try {
    const res = await api('/api/admin/documents');
    const data = await res.json();
    const docs = data.documents || [];
    list.innerHTML = '';
    $('#empty').classList.toggle('hidden', docs.length > 0);
    if (!docs.length) return;

    const active = docs.filter(d => d.status !== 'signed');
    const done = docs.filter(d => d.status === 'signed');

    list.appendChild(renderGroup({
      key: 'active', title: 'Збір триває', docs: active,
      emptyNote: 'Зараз немає документів у зборі.',
    }));
    if (done.length) {
      list.appendChild(renderGroup({
        key: 'done', title: 'Завершені', docs: done,
        collapsible: true, collapsed: true,
      }));
    }

    // make sure every finished+published doc has its signed PDF stored for the portal
    syncSignedPdfs(docs);
  } catch (e) {
    list.innerHTML = `<div class="banner banner-error"><span class="banner-icon">!</span><div>Не вдалося завантажити список: ${esc(e.message)}</div></div>`;
  }
}

/* Self-heal: a finished document that is public but whose signed PDF was never
   stored (e.g. fixed-mode auto-closed while already published). Compose + upload. */
async function syncSignedPdfs(docs) {
  const gaps = (docs || []).filter(d => d.status === 'signed' && d.published && !d.signedPdf);
  if (!gaps.length) return;
  toast('Оновлюю підписані версії на порталі…', { ms: 4000 });
  let ok = 0;
  for (const doc of gaps) {
    try {
      const bytes = await composeSignedPdfBytes(doc);
      await uploadSignedPdf(doc, bytes);
      ok++;
    } catch (e) {
      console.error('signed-pdf sync failed', doc.id, e);
    }
  }
  if (ok) toast('✓ Портал оновлено');
}

function renderGroup({ key, title, docs, collapsible = false, collapsed = false, emptyNote = '' }) {
  const section = document.createElement('section');
  section.className = 'doc-group';
  section.dataset.group = key;

  const head = document.createElement(collapsible ? 'button' : 'div');
  head.className = 'doc-group-head';
  if (collapsible) {
    head.type = 'button';
    head.classList.add('doc-group-toggle');
    head.setAttribute('aria-expanded', String(!collapsed));
  }
  head.innerHTML =
    (collapsible ? '<span class="doc-group-chevron" aria-hidden="true">▸</span>' : '') +
    `<span class="doc-group-title">${esc(title)}</span>` +
    `<span class="doc-group-count">${docs.length}</span>`;
  section.appendChild(head);

  const body = document.createElement('div');
  body.className = 'doc-group-body';
  if (collapsible && collapsed) body.classList.add('hidden');
  if (docs.length) docs.forEach(doc => body.appendChild(renderCard(doc)));
  else if (emptyNote) body.innerHTML = `<div class="doc-group-empty muted">${esc(emptyNote)}</div>`;
  section.appendChild(body);

  if (collapsible) {
    head.addEventListener('click', () => {
      const hidden = body.classList.toggle('hidden');
      head.setAttribute('aria-expanded', String(!hidden));
    });
  }
  return section;
}

function renderCard(doc) {
  const st = STATUS[doc.status] || STATUS.pending;
  const card = document.createElement('div');
  card.className = 'doc-card';
  card.dataset.id = doc.id;

  const required = doc.mode === 'fixed' && doc.requiredCount;
  const progressPct = required ? Math.min(100, Math.round(doc.signedCount / doc.requiredCount * 100)) : 0;
  const countText = required
    ? `${doc.signedCount} / ${doc.requiredCount} підписів`
    : `${doc.signedCount} підписів · збір відкритий`;

  card.innerHTML = `
    <div class="doc-card-head">
      <div>
        <h3 class="doc-card-title">${esc(doc.title)}</h3>
        <div class="doc-card-meta">${esc(doc.pdfName || 'document.pdf')} · створено ${fmtDate(doc.createdAt)}</div>
      </div>
      <span class="pill ${st.cls}">${st.label}</span>
    </div>

    <div class="doc-card-meta" style="margin-top:10px;font-weight:600;color:var(--navy);">${countText}</div>
    ${required ? `<div class="progress-bar"><span style="width:${progressPct}%"></span></div>` : ''}

    <div class="copy-row">
      <input type="text" readonly value="${esc(signLink(doc.signToken))}">
      <button type="button" class="btn btn-ghost" data-act="copy">Копіювати</button>
    </div>

    <div class="doc-card-actions">
      <button type="button" class="btn btn-ghost" data-act="toggle-sigs">Підписи (${doc.signedCount})</button>
      <button type="button" class="btn btn-accent" data-act="download">⬇ Підписаний PDF</button>
      ${doc.status !== 'signed' ? `<button type="button" class="btn btn-ghost" data-act="close">Завершити збір</button>` : ''}
      <button type="button" class="btn btn-ghost" data-act="publish">${portalLabel(doc)}</button>
      <button type="button" class="btn btn-danger" data-act="delete">Видалити</button>
    </div>

    <div class="sig-list-wrap hidden" data-sigs></div>
  `;

  card.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    const ok = await copyText(signLink(doc.signToken));
    toast(ok ? '✓ Посилання скопійовано' : 'Скопіюйте вручну', { error: !ok });
  });
  card.querySelector('[data-act="toggle-sigs"]').addEventListener('click', () => toggleSigs(card, doc));
  card.querySelector('[data-act="download"]').addEventListener('click', (e) => downloadSigned(e.currentTarget, doc));
  const closeBtn = card.querySelector('[data-act="close"]');
  if (closeBtn) closeBtn.addEventListener('click', () => closeDoc(doc));
  const pubBtn = card.querySelector('[data-act="publish"]');
  if (pubBtn) pubBtn.addEventListener('click', () => togglePublish(doc));
  card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteDoc(doc));

  return card;
}

async function toggleSigs(card, doc) {
  const wrap = card.querySelector('[data-sigs]');
  if (!wrap.classList.contains('hidden')) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  wrap.innerHTML = `<div class="muted" style="padding:10px 0;">Завантаження…</div>`;
  try {
    const detail = await fetchDetail(doc.id);
    const sigs = detail.signatures || [];
    if (!sigs.length) { wrap.innerHTML = `<div class="muted" style="padding:10px 0;">Підписів ще немає.</div>`; return; }
    wrap.innerHTML = `<div class="sig-list">` + sigs.map((s, i) => `
      <div class="sig-cell">
        <div class="sig-cell-name">${i + 1}. ${esc(fioOf(s))}</div>
        <div class="sig-cell-date">${esc(s.signDate || '')}</div>
        <div class="sig-cell-img">${s.image ? `<img src="${s.image}" alt="підпис">` : '—'}</div>
      </div>`).join('') + `</div>`;
  } catch (e) {
    wrap.innerHTML = `<div class="banner banner-error"><span class="banner-icon">!</span><div>${esc(e.message)}</div></div>`;
  }
}

async function fetchDetail(id) {
  const res = await api(`/api/admin/documents/${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`);
  return data.document;
}

async function closeDoc(doc) {
  if (!confirm(`Завершити збір підписів за «${doc.title}»? Документ стане «Підписаним» і більше не прийматиме підписи.`)) return;
  const res = await api(`/api/admin/documents/${doc.id}/close`, { method: 'POST' });
  if (!res.ok) { toast('Не вдалося завершити', { error: true }); return; }
  toast('✓ Збір завершено');
  // if it is already shown on the portal, refresh the public copy to the signed version
  if (doc.published) {
    try {
      const bytes = await composeSignedPdfBytes({ ...doc, status: 'signed' });
      await uploadSignedPdf(doc, bytes);
    } catch (e) { console.error('signed-pdf refresh after close failed', e); }
  }
  loadDocs();
}

async function togglePublish(doc) {
  const turningOn = !doc.published;
  // Publishing a finished document → make sure the portal serves the signed version (with signatures).
  if (turningOn && doc.status === 'signed') {
    toast('Готуємо підписану версію…', { ms: 6000 });
    try {
      const bytes = await composeSignedPdfBytes(doc);
      await uploadSignedPdf(doc, bytes);
    } catch (e) {
      toast('Не вдалося підготувати підписану версію: ' + e.message, { error: true, ms: 4000 });
      return;
    }
  }
  const res = await api(`/api/admin/documents/${doc.id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ published: turningOn }),
  });
  if (res.ok) { toast(turningOn ? '✓ Показано на порталі' : 'Прибрано з порталу'); loadDocs(); }
  else toast('Не вдалося змінити', { error: true });
}

async function deleteDoc(doc) {
  if (!confirm(`Видалити «${doc.title}» разом з усіма підписами? Дію не можна скасувати.`)) return;
  const res = await api(`/api/admin/documents/${doc.id}`, { method: 'DELETE' });
  if (res.ok) { toast('Документ видалено'); loadDocs(); }
  else toast('Не вдалося видалити', { error: true });
}

/* ===== signed PDF compose (original + appended signature sheet) ===== */
async function downloadSigned(btn, doc) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Готуємо…';
  try {
    const out = await composeSignedPdfBytes(doc);
    downloadBlob(new Blob([out], { type: 'application/pdf' }), `${doc.title} (підписаний).pdf`);
    toast('✓ PDF завантажено');
    // keep the public portal copy in sync when a finished doc is shown publicly
    if (doc.status === 'signed' && doc.published) {
      uploadSignedPdf(doc, out).catch((e) => console.error('signed-pdf sync failed', e));
    }
  } catch (e) {
    console.error(e);
    toast('Помилка: ' + e.message, { error: true, ms: 4000 });
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* Compose the signed PDF (original + appended «Аркуш підписів») entirely in the
   browser — html2canvas renders the Cyrillic sheet, pdf-lib appends it. Returns bytes. */
async function composeSignedPdfBytes(doc) {
  const [fileRes, detail] = await Promise.all([
    api(`/api/admin/documents/${doc.id}/file`),
    fetchDetail(doc.id),
  ]);
  if (!fileRes.ok) throw new Error('Не вдалося отримати PDF');
  const origBytes = await fileRes.arrayBuffer();
  const sigs = detail.signatures || [];

  const images = await buildSheetImages(doc.title || detail.title, sigs);

  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.load(origBytes);
  const A4 = [595.28, 841.89];
  for (const dataUrl of images) {
    const img = await pdfDoc.embedJpg(dataUrl);
    const page = pdfDoc.addPage(A4);
    page.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  return await pdfDoc.save();
}

/* Upload the composed signed PDF so the public portal can serve it (with signatures). */
async function uploadSignedPdf(doc, bytes) {
  const res = await api(`/api/admin/documents/${doc.id}/signed-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: bytes,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Помилка ${res.status}`);
  }
}

async function buildSheetImages(title, sigs) {
  const host = $('#sheetHost');
  const PER_PAGE = 6;
  const chunks = [];
  for (let i = 0; i < sigs.length; i += PER_PAGE) chunks.push(sigs.slice(i, i + PER_PAGE));
  if (!chunks.length) chunks.push([]);

  const images = [];
  for (let c = 0; c < chunks.length; c++) {
    host.innerHTML = sheetHtml(title, chunks[c], c * PER_PAGE, chunks.length > 1 ? `${c + 1}/${chunks.length}` : '');
    const sheet = host.querySelector('.sheet');
    const canvas = await html2canvas(sheet, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff',
      width: 794, height: 1123, windowWidth: 794, windowHeight: 1123,
    });
    images.push(canvas.toDataURL('image/jpeg', 0.92));
  }
  host.innerHTML = '';
  return images;
}

function sheetHtml(title, sigs, startIndex, pageLabel) {
  const rows = sigs.map((s, i) => `
    <tr>
      <td class="sheet-num">${startIndex + i + 1}</td>
      <td class="sheet-fio">${esc(fioOf(s))}</td>
      <td class="sheet-date">${esc(s.signDate || '')}</td>
      <td class="sheet-sig">${s.image ? `<img src="${s.image}" alt="">` : ''}</td>
    </tr>`).join('');

  const emptyNote = sigs.length ? '' : `<tr><td colspan="4" class="sheet-empty">Підписи відсутні</td></tr>`;

  return `
    <div class="sheet">
      <div class="sheet-head">
        <div class="sheet-org">Громадська організація «Сила Єдності»</div>
        ${pageLabel ? `<div class="sheet-page">арк. ${pageLabel}</div>` : ''}
      </div>
      <div class="sheet-title">АРКУШ ПІДПИСІВ</div>
      <div class="sheet-subtitle">до документа: «${esc(title)}»</div>
      <table class="sheet-table">
        <thead>
          <tr><th>№</th><th>Прізвище, ім'я, по батькові</th><th>Дата</th><th>Підпис</th></tr>
        </thead>
        <tbody>${rows}${emptyNote}</tbody>
      </table>
    </div>`;
}

/* ===== new document modal ===== */
let selectedFile = null;
function openModal() {
  selectedFile = null;
  $('#m-title').value = '';
  $('#m-file').value = '';
  $('#m-drop-text').textContent = '📎 Обрати PDF-файл';
  $('#m-drop').classList.remove('has-file');
  $('#m-count').value = '2';
  setMode('fixed');
  ['m-title', 'm-file', 'm-count'].forEach(id => setError(id, ''));
  $('#newModal').classList.remove('hidden');
}
function closeModal() { $('#newModal').classList.add('hidden'); }

function setMode(mode) {
  $$('.radio-card').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  const r = $(`input[name="m-mode"][value="${mode}"]`);
  if (r) r.checked = true;
  $('#m-count-wrap').classList.toggle('hidden', mode !== 'fixed');
}

function wireNewModal() {
  $('#m-cancel').addEventListener('click', closeModal);
  $('#newModal').addEventListener('click', e => { if (e.target.id === 'newModal') closeModal(); });
  $$('.radio-card').forEach(c => c.addEventListener('click', () => setMode(c.dataset.mode)));
  $('#m-file').addEventListener('change', e => {
    const f = e.target.files[0];
    selectedFile = f || null;
    if (f) {
      $('#m-drop-text').textContent = '📄 ' + f.name;
      $('#m-drop').classList.add('has-file');
      setError('m-file', '');
    }
  });
  $('#m-create').addEventListener('click', createDoc);
}

async function createDoc() {
  const title = $('#m-title').value.trim();
  const mode = $('input[name="m-mode"]:checked').value;
  const count = parseInt($('#m-count').value, 10);

  let ok = true;
  if (!title) { setError('m-title', 'Вкажіть назву'); ok = false; }
  if (!selectedFile) { setError('m-file', 'Додайте PDF-файл'); ok = false; }
  if (mode === 'fixed' && (!Number.isInteger(count) || count < 1)) { setError('m-count', 'Вкажіть число ≥ 1'); ok = false; }
  if (!ok) return;

  const btn = $('#m-create');
  btn.disabled = true; btn.textContent = 'Створюємо…';
  try {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('mode', mode);
    if (mode === 'fixed') fd.append('requiredCount', String(count));
    fd.append('pdf', selectedFile, selectedFile.name);

    const res = await api('/api/admin/documents', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Помилка ${res.status}`);

    closeModal();
    toast('✓ Документ створено');
    loadDocs();
  } catch (e) {
    toast('Не вдалося створити: ' + e.message, { error: true, ms: 4000 });
  } finally {
    btn.disabled = false; btn.textContent = 'Створити';
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

boot();
