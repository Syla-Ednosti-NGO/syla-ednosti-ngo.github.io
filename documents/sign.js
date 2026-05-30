/* ===== Signer page ===== */
const $ = (s, p = document) => p.querySelector(s);
const WORKER = (window.DOCS_CONFIG && window.DOCS_CONFIG.WORKER_URL || '').replace(/\/+$/, '');

/* token lives in the URL fragment: sign.html#t=<token> */
function getToken() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  return h.get('t') || '';
}

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
  const input = $('#' + id);
  if (input) input.classList.toggle('invalid', !!msg);
}
function show(id) { $('#' + id).classList.remove('hidden'); }
function hide(id) { $('#' + id).classList.add('hidden'); }

let sigWidget = null;

async function init() {
  const token = getToken();
  if (!token) return fail('Невірне посилання', 'У посиланні відсутній код документа. Попросіть надіслати коректне посилання.');
  if (!WORKER) return fail('Помилка конфігурації', 'Не задано адресу сервера (WORKER_URL).');

  try {
    const res = await fetch(`${WORKER}/api/sign/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail('Документ недоступний', data.error || `Помилка ${res.status}`);

    const doc = data.document;
    hide('loading');

    if (doc.closed) {
      $('#closed-title').textContent = doc.title;
      show('closed-view');
      return;
    }

    renderForm(token, doc);
  } catch (e) {
    fail('Немає зв\'язку', 'Не вдалося завантажити документ. Перевірте інтернет і спробуйте ще раз.');
  }
}

function fail(title, message) {
  hide('loading');
  $('#closed-title').textContent = title;
  const banner = $('#closed-banner');
  banner.className = 'banner banner-error';
  banner.innerHTML = `<span class="banner-icon">!</span><div>${message}</div>`;
  show('closed-view');
}

function renderForm(token, doc) {
  $('#doc-title').textContent = doc.title;

  if (doc.mode === 'fixed' && doc.requiredCount) {
    $('#progress-hint').textContent = `Зібрано підписів: ${doc.signedCount} з ${doc.requiredCount}`;
  } else {
    $('#progress-hint').textContent = doc.signedCount
      ? `Зібрано підписів: ${doc.signedCount}`
      : 'Будьте першим, хто підпише цей документ.';
  }

  const fileUrl = `${WORKER}/api/sign/${encodeURIComponent(token)}/file`;
  $('#pdf-viewer').src = fileUrl;
  $('#pdf-open').href = fileUrl;

  // default date = today (yyyy-mm-dd for <input type=date>)
  $('#signDate').value = new Date().toISOString().slice(0, 10);

  show('form-view');

  sigWidget = createSignatureWidget($('#sigWidget'));
  sigWidget.prepare();
  sigWidget.onChange(() => setError('signature', ''));

  ['lastName', 'firstName'].forEach(id => {
    $('#' + id).addEventListener('input', () => setError(id, ''));
  });

  $('#btn-submit').addEventListener('click', () => submit(token));
}

async function submit(token) {
  const lastName = $('#lastName').value.trim();
  const firstName = $('#firstName').value.trim();
  const middleName = $('#middleName').value.trim();
  const signDate = $('#signDate').value;
  const image = sigWidget.getDataURL();

  let ok = true;
  if (!lastName) { setError('lastName', 'Вкажіть прізвище'); ok = false; }
  if (!firstName) { setError('firstName', 'Вкажіть ім\'я'); ok = false; }
  if (!image) { setError('signature', 'Поставте підпис або додайте фото'); ok = false; }
  if (!ok) { toast('Заповніть обов\'язкові поля', { error: true }); return; }

  const btn = $('#btn-submit');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Надсилаємо…';

  try {
    const res = await fetch(`${WORKER}/api/sign/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastName, firstName, middleName, signDate, image }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      hide('form-view');
      $('#closed-title').textContent = $('#doc-title').textContent;
      show('closed-view');
      return;
    }
    if (!res.ok || !data.ok) throw new Error(data.error || `Помилка ${res.status}`);

    hide('form-view');
    show('done-view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toast('Не вдалося надіслати: ' + e.message, { error: true, ms: 4000 });
    btn.disabled = false;
    btn.textContent = original;
  }
}

init();
