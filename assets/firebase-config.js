// Firebase web config for the «Об'єднані. Сильні. Разом!» site.
// This is PUBLIC client config (not a secret) — it identifies the Firebase project.
// Real security is enforced by Firebase Auth + the documents-api Worker (which verifies
// ID tokens against Google's public certs and gates access by the D1 `users` table).
// Project: syla-ednosti-ngo · provider: Email/Password.
export const firebaseConfig = {
  apiKey: "AIzaSyBdaRr6ovqfxkruE4VOtS7MIKF1peG_Kis",
  authDomain: "syla-ednosti-ngo.firebaseapp.com",
  projectId: "syla-ednosti-ngo",
  storageBucket: "syla-ednosti-ngo.firebasestorage.app",
  messagingSenderId: "195388405888",
  appId: "1:195388405888:web:4e026b520586fc79c58e65",
};
