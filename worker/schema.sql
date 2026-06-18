-- documents-api — D1 schema
-- Apply with:
--   wrangler d1 execute documents-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  pdf_key        TEXT NOT NULL,
  pdf_name       TEXT,
  mode           TEXT NOT NULL DEFAULT 'fixed',   -- 'fixed' | 'open'
  required_count INTEGER,                          -- NULL when mode='open'
  status         TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'signing' | 'signed'
  sign_token     TEXT NOT NULL UNIQUE,
  published      INTEGER NOT NULL DEFAULT 0,       -- 1 = visible on public portal
  created_at     TEXT NOT NULL,
  closed_at      TEXT,
  signed_pdf_key TEXT                               -- R2 key of the composed «signed» PDF (original + signature sheet); set when finalized
);
CREATE INDEX IF NOT EXISTS idx_documents_sign_token ON documents(sign_token);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);

CREATE TABLE IF NOT EXISTS signatures (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  last_name   TEXT,
  first_name  TEXT,
  middle_name TEXT,
  sign_date   TEXT,                                -- dd.mm.yyyy
  image_key   TEXT NOT NULL,
  image_type  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signatures_doc ON signatures(document_id);

-- users — Firebase-authenticated team members with admin-approval gate.
-- Auth itself is Firebase (email/password); this table holds approval status + role.
CREATE TABLE IF NOT EXISTS users (
  uid          TEXT PRIMARY KEY,                 -- Firebase UID
  email        TEXT NOT NULL,
  display_name TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'declined'
  role         TEXT NOT NULL DEFAULT 'member',   -- 'member' | 'admin'
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  decided_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
