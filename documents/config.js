/* Shared config for the documents portal (admin + signer pages).
   WORKER_URL must point at the deployed documents-api Worker.
   After `wrangler deploy`, set this to the printed URL (no trailing slash). */
window.DOCS_CONFIG = {
  WORKER_URL: 'https://documents-api.culaednocti.workers.dev',
};
