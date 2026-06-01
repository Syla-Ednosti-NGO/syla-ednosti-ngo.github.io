/**
 * documents-api — Cloudflare Worker for the «Сила Єдності» document-signing system.
 *
 * Storage:
 *   - D1   (binding DB)     — documents + signatures metadata
 *   - R2   (binding BUCKET) — original PDFs + signature images
 *
 * Auth:
 *   - Admin endpoints require  Authorization: Bearer <ADMIN_TOKEN>
 *   - ADMIN_TOKEN is a Worker secret (the same value lives in the admin link #k=...)
 *
 * Routes:
 *   PUBLIC
 *     GET    /api/sign/:token             — document info for a signer
 *     GET    /api/sign/:token/file        — original PDF bytes
 *     POST   /api/sign/:token             — submit a signature
 *     GET    /api/public/documents        — published+signed documents (portal)
 *     GET    /api/public/documents/:id/file
 *   ADMIN (Bearer)
 *     GET    /api/admin/ping              — auth check
 *     GET    /api/admin/documents         — list with progress
 *     POST   /api/admin/documents         — create (multipart: pdf,title,mode,requiredCount)
 *     GET    /api/admin/documents/:id      — detail + signatures (images as data URLs)
 *     DELETE /api/admin/documents/:id      — delete document, signatures, R2 objects
 *     GET    /api/admin/documents/:id/file — original PDF bytes
 *     POST   /api/admin/documents/:id/close   — force status 'signed'
 *     POST   /api/admin/documents/:id/publish — body {published:bool}
 *     POST   /api/admin/documents/:id/signed-pdf — store composed signed PDF (body: application/pdf)
 *
 * Note: /api/public/documents/:id/file serves the composed signed PDF once the
 *       document is 'signed' and a signed_pdf_key exists; otherwise the original.
 */

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const seg = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const m = request.method;

    try {
      if (seg[0] !== 'api') return json({ error: 'Not found' }, 404, cors);

      /* ---------- PUBLIC: signing ---------- */
      if (seg[1] === 'sign' && seg[2]) {
        const token = seg[2];
        if (!seg[3] && m === 'GET') return getSignInfo(token, env, cors);
        if (!seg[3] && m === 'POST') return submitSignature(token, request, env, cors);
        if (seg[3] === 'file' && m === 'GET') return servePdfByToken(token, env, cors);
      }

      /* ---------- PUBLIC: portal ---------- */
      if (seg[1] === 'public' && seg[2] === 'documents') {
        if (!seg[3] && m === 'GET') return listPublic(env, cors);
        if (seg[3] && seg[4] === 'file' && m === 'GET') return servePublicPdf(seg[3], env, cors);
      }

      /* ---------- ADMIN ---------- */
      if (seg[1] === 'admin') {
        if (!checkAuth(request, env)) return json({ error: 'Unauthorized' }, 401, cors);

        if (seg[2] === 'ping' && m === 'GET') return json({ ok: true }, 200, cors);

        if (seg[2] === 'documents') {
          if (!seg[3]) {
            if (m === 'GET') return listDocs(env, cors);
            if (m === 'POST') return createDoc(request, env, cors);
          } else {
            const id = seg[3];
            if (!seg[4]) {
              if (m === 'GET') return getDoc(id, env, cors);
              if (m === 'DELETE') return deleteDoc(id, env, cors);
            }
            if (seg[4] === 'file' && m === 'GET') return servePdfById(id, env, cors);
            if (seg[4] === 'close' && m === 'POST') return closeDoc(id, env, cors);
            if (seg[4] === 'publish' && m === 'POST') return publishDoc(id, request, env, cors);
            if (seg[4] === 'signed-pdf' && m === 'POST') return putSignedPdf(id, request, env, cors);
          }
        }
      }

      return json({ error: 'Not found', path: url.pathname }, 404, cors);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500, cors);
    }
  },
};

/* =====================================================================
   ADMIN handlers
   ===================================================================== */

async function createDoc(request, env, cors) {
  const form = await request.formData();
  const pdf = form.get('pdf');
  const title = str(form.get('title'));
  const mode = str(form.get('mode')) === 'open' ? 'open' : 'fixed';
  let requiredCount = parseInt(str(form.get('requiredCount')), 10);

  if (!title) return json({ error: 'Вкажіть назву документа' }, 400, cors);
  if (!(pdf instanceof File) || pdf.size === 0) return json({ error: 'Додайте PDF-файл' }, 400, cors);
  if (pdf.type && pdf.type !== 'application/pdf' && !/\.pdf$/i.test(pdf.name || '')) {
    return json({ error: 'Файл має бути у форматі PDF' }, 400, cors);
  }
  if (mode === 'fixed') {
    if (!Number.isInteger(requiredCount) || requiredCount < 1) {
      return json({ error: 'Вкажіть кількість підписів (≥ 1)' }, 400, cors);
    }
  } else {
    requiredCount = null;
  }

  const id = crypto.randomUUID();
  const token = randToken(20);
  const pdfKey = `docs/${id}/original.pdf`;
  const createdAt = nowIso();

  await env.BUCKET.put(pdfKey, await pdf.arrayBuffer(), {
    httpMetadata: { contentType: 'application/pdf' },
  });

  await env.DB.prepare(
    `INSERT INTO documents (id, title, pdf_key, pdf_name, mode, required_count, status, sign_token, published, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`
  ).bind(id, title, pdfKey, pdf.name || 'document.pdf', mode, requiredCount, token, createdAt).run();

  return json({
    ok: true,
    document: { id, title, mode, requiredCount, status: 'pending', signToken: token, signedCount: 0, createdAt },
  }, 200, cors);
}

async function listDocs(env, cors) {
  const { results } = await env.DB.prepare(
    `SELECT d.*, (SELECT COUNT(*) FROM signatures s WHERE s.document_id = d.id) AS signed_count
     FROM documents d ORDER BY d.created_at DESC`
  ).all();
  return json({ documents: (results || []).map(rowToDoc) }, 200, cors);
}

async function getDoc(id, env, cors) {
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);

  const { results } = await env.DB.prepare(
    `SELECT * FROM signatures WHERE document_id = ? ORDER BY created_at ASC`
  ).bind(id).all();

  const signatures = [];
  for (const s of (results || [])) {
    let image = null;
    const obj = await env.BUCKET.get(s.image_key);
    if (obj) image = `data:${s.image_type || 'image/png'};base64,${await bufToBase64(await obj.arrayBuffer())}`;
    signatures.push({
      id: s.id,
      lastName: s.last_name, firstName: s.first_name, middleName: s.middle_name,
      signDate: s.sign_date, createdAt: s.created_at, image,
    });
  }

  return json({ document: { ...rowToDoc({ ...doc, signed_count: signatures.length }), signatures } }, 200, cors);
}

async function closeDoc(id, env, cors) {
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);
  await env.DB.prepare(`UPDATE documents SET status = 'signed', closed_at = ? WHERE id = ?`)
    .bind(nowIso(), id).run();
  return json({ ok: true, status: 'signed' }, 200, cors);
}

async function publishDoc(id, request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const published = body.published ? 1 : 0;
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);
  await env.DB.prepare(`UPDATE documents SET published = ? WHERE id = ?`).bind(published, id).run();
  return json({ ok: true, published: !!published }, 200, cors);
}

/* Store the composed signed PDF (original + «Аркуш підписів»), built client-side
   in the admin browser. The public portal serves it once the document is signed. */
async function putSignedPdf(id, request, env, cors) {
  const doc = await env.DB.prepare(`SELECT id FROM documents WHERE id = ?`).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);

  const buf = await request.arrayBuffer();
  if (!buf || buf.byteLength === 0) return json({ error: 'Порожній файл' }, 400, cors);
  const head = String.fromCharCode(...new Uint8Array(buf.slice(0, 5)));
  if (!head.startsWith('%PDF')) return json({ error: 'Очікується PDF' }, 400, cors);

  const key = `docs/${id}/signed.pdf`;
  await env.BUCKET.put(key, buf, { httpMetadata: { contentType: 'application/pdf' } });
  await env.DB.prepare(`UPDATE documents SET signed_pdf_key = ? WHERE id = ?`).bind(key, id).run();
  return json({ ok: true }, 200, cors);
}

async function deleteDoc(id, env, cors) {
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);

  const { results } = await env.DB.prepare(`SELECT image_key FROM signatures WHERE document_id = ?`).bind(id).all();
  const keys = [doc.pdf_key, doc.signed_pdf_key, ...(results || []).map(r => r.image_key)].filter(Boolean);
  await Promise.all(keys.map(k => env.BUCKET.delete(k).catch(() => {})));

  await env.DB.prepare(`DELETE FROM signatures WHERE document_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM documents WHERE id = ?`).bind(id).run();
  return json({ ok: true }, 200, cors);
}

async function servePdfById(id, env, cors) {
  const doc = await env.DB.prepare(`SELECT pdf_key, pdf_name FROM documents WHERE id = ?`).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);
  return servePdf(doc.pdf_key, doc.pdf_name, env, cors);
}

/* =====================================================================
   PUBLIC: signing
   ===================================================================== */

async function getSignInfo(token, env, cors) {
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE sign_token = ?`).bind(token).first();
  if (!doc) return json({ error: 'Посилання недійсне' }, 404, cors);
  const cnt = await countSigs(doc.id, env);
  return json({
    document: {
      title: doc.title,
      status: doc.status,
      mode: doc.mode,
      requiredCount: doc.required_count,
      signedCount: cnt,
      closed: doc.status === 'signed',
    },
  }, 200, cors);
}

async function submitSignature(token, request, env, cors) {
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE sign_token = ?`).bind(token).first();
  if (!doc) return json({ error: 'Посилання недійсне' }, 404, cors);
  if (doc.status === 'signed') return json({ error: 'Збір підписів за цим документом завершено' }, 409, cors);

  const body = await request.json().catch(() => ({}));
  const lastName = str(body.lastName);
  const firstName = str(body.firstName);
  const middleName = str(body.middleName);
  const signDate = normDate(str(body.signDate)) || todayStr();
  const parsed = parseDataUrl(body.image);

  if (!lastName || !firstName) return json({ error: 'Вкажіть прізвище та ім\'я' }, 400, cors);
  if (!parsed) return json({ error: 'Додайте підпис' }, 400, cors);

  const sid = crypto.randomUUID();
  const ext = extFromMime(parsed.mime);
  const imageKey = `docs/${doc.id}/sig/${sid}.${ext}`;
  await env.BUCKET.put(imageKey, parsed.bytes, { httpMetadata: { contentType: parsed.mime } });

  await env.DB.prepare(
    `INSERT INTO signatures (id, document_id, last_name, first_name, middle_name, sign_date, image_key, image_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(sid, doc.id, lastName, firstName, middleName, signDate, imageKey, parsed.mime, nowIso()).run();

  const cnt = await countSigs(doc.id, env);
  let status = doc.status;
  if (doc.mode === 'fixed' && doc.required_count && cnt >= doc.required_count) {
    status = 'signed';
    await env.DB.prepare(`UPDATE documents SET status = 'signed', closed_at = ? WHERE id = ?`)
      .bind(nowIso(), doc.id).run();
  } else if (doc.status === 'pending') {
    status = 'signing';
    await env.DB.prepare(`UPDATE documents SET status = 'signing' WHERE id = ?`).bind(doc.id).run();
  }

  return json({ ok: true, signedCount: cnt, status, closed: status === 'signed' }, 200, cors);
}

async function servePdfByToken(token, env, cors) {
  const doc = await env.DB.prepare(`SELECT pdf_key, pdf_name FROM documents WHERE sign_token = ?`).bind(token).first();
  if (!doc) return json({ error: 'Посилання недійсне' }, 404, cors);
  return servePdf(doc.pdf_key, doc.pdf_name, env, cors);
}

/* =====================================================================
   PUBLIC: portal
   ===================================================================== */

async function listPublic(env, cors) {
  const { results } = await env.DB.prepare(
    `SELECT d.id, d.title, d.status, d.mode, d.required_count, d.closed_at, d.created_at,
            (SELECT COUNT(*) FROM signatures s WHERE s.document_id = d.id) AS signed_count
     FROM documents d
     WHERE d.published = 1
     ORDER BY d.created_at DESC`
  ).all();
  return json({
    documents: (results || []).map(d => ({
      id: d.id, title: d.title, status: d.status, mode: d.mode,
      requiredCount: d.required_count, closedAt: d.closed_at,
      createdAt: d.created_at, signedCount: d.signed_count,
    })),
  }, 200, cors);
}

async function servePublicPdf(id, env, cors) {
  const doc = await env.DB.prepare(
    `SELECT pdf_key, pdf_name, title, status, signed_pdf_key FROM documents WHERE id = ? AND published = 1`
  ).bind(id).first();
  if (!doc) return json({ error: 'Документ не знайдено' }, 404, cors);
  // Once collection is finished, serve the composed signed PDF (with the signature sheet).
  if (doc.status === 'signed' && doc.signed_pdf_key) {
    return servePdf(doc.signed_pdf_key, `${doc.title} (підписаний).pdf`, env, cors);
  }
  return servePdf(doc.pdf_key, doc.pdf_name, env, cors);
}

/* =====================================================================
   Shared helpers
   ===================================================================== */

async function servePdf(key, name, env, cors) {
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ error: 'Файл не знайдено' }, 404, cors);
  const safe = encodeURIComponent(name || 'document.pdf');
  return new Response(obj.body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${safe}`,
      'Cache-Control': 'no-store',
    },
  });
}

async function countSigs(docId, env) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS c FROM signatures WHERE document_id = ?`).bind(docId).first();
  return r ? r.c : 0;
}

function rowToDoc(d) {
  return {
    id: d.id,
    title: d.title,
    pdfName: d.pdf_name,
    mode: d.mode,
    requiredCount: d.required_count,
    status: d.status,
    signToken: d.sign_token,
    published: !!d.published,
    signedPdf: !!d.signed_pdf_key,
    signedCount: d.signed_count != null ? d.signed_count : 0,
    createdAt: d.created_at,
    closedAt: d.closed_at,
  };
}

function checkAuth(request, env) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  const tok = m ? m[1] : '';
  return !!tok && !!env.ADMIN_TOKEN && timingSafeEqual(tok, env.ADMIN_TOKEN);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const corsOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

function str(v) { return (v == null ? '' : String(v)).trim(); }

function randToken(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseDataUrl(s) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(s || ''));
  if (!m) return null;
  const mime = m[1];
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

async function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function extFromMime(mime) {
  if (/png/i.test(mime)) return 'png';
  if (/jpe?g/i.test(mime)) return 'jpg';
  if (/webp/i.test(mime)) return 'webp';
  return 'png';
}

function normDate(s) {
  if (!s) return '';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return s;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : s;
}

function todayStr() {
  const t = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(t.getDate())}.${p(t.getMonth() + 1)}.${t.getFullYear()}`;
}

function nowIso() { return new Date().toISOString(); }
