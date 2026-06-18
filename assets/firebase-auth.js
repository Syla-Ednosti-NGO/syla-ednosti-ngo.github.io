// Shared Firebase Auth helper for the «Об'єднані. Сильні. Разом!» site.
// Email/password sign-in via Firebase; the Cloudflare Worker verifies the ID token
// and gates access by the D1 `users` table (status pending/approved/declined, role).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const WORKER_URL = "https://documents-api.culaednocti.workers.dev";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Fetch the Worker with the current user's Firebase ID token attached.
export async function workerFetch(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (auth.currentUser) headers["Authorization"] = "Bearer " + (await auth.currentUser.getIdToken());
  return fetch(WORKER_URL + path, Object.assign({}, opts, { headers }));
}

// Register: create the Firebase user, then create the pending profile in the Worker (D1).
export async function register(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name) { try { await updateProfile(cred.user, { displayName: name }); } catch (_) {} }
  try {
    const r = await workerFetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "" }),
    });
    if (r.ok) return await r.json();              // { status, role }
  } catch (_) {}
  return { status: "pending", role: "member" };   // Worker not reachable yet → optimistic pending
}

export async function login(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  return await me();
}

// Current account status/role from the Worker (creates the row on first sight).
export async function me() {
  if (!auth.currentUser) return { status: "none" };
  try {
    let r = await workerFetch("/api/auth/me");
    if (r.status === 401) {
      await workerFetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      r = await workerFetch("/api/auth/me");
    }
    if (r.ok) return await r.json();
  } catch (_) {}
  return { status: "unknown" };
}

export async function logout() { await signOut(auth); }
export async function resetPassword(email) { await sendPasswordResetEmail(auth, email); }
export async function getIdToken() { return auth.currentUser ? await auth.currentUser.getIdToken() : null; }
export { onAuthStateChanged };

// Translate common Firebase auth error codes to Ukrainian.
export function errText(e) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "Невірний формат пошти.",
    "auth/missing-password": "Введіть пароль.",
    "auth/user-not-found": "Невірна пошта або пароль.",
    "auth/wrong-password": "Невірна пошта або пароль.",
    "auth/invalid-credential": "Невірна пошта або пароль.",
    "auth/email-already-in-use": "Ця пошта вже зареєстрована — увійдіть.",
    "auth/weak-password": "Пароль закороткий (мінімум 6 символів).",
    "auth/too-many-requests": "Забагато спроб. Спробуйте трохи пізніше.",
    "auth/network-request-failed": "Немає зв'язку з мережею.",
  };
  return map[c] || (e && e.message) || "Сталася помилка. Спробуйте ще раз.";
}
