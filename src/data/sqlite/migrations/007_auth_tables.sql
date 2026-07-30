-- ============================================================================
-- Migration 007: Auth tables for Lucia session management + Google OAuth
-- ============================================================================

-- Lucia session store (HTTP-only cookie sessions)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL   -- Unix timestamp (seconds)
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions(user_id);

-- OAuth account links (Google → person_id)
-- Supports multiple providers in future (LinkedIn, GitHub) via provider column
CREATE TABLE IF NOT EXISTS oauth_accounts (
  provider         TEXT NOT NULL,  -- 'google'
  provider_user_id TEXT NOT NULL,  -- Google 'sub' claim
  user_id          TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_user_id)
);

-- Extend people table with auth metadata
ALTER TABLE people ADD COLUMN name          TEXT;
ALTER TABLE people ADD COLUMN avatar_url    TEXT;
ALTER TABLE people ADD COLUMN onboarded     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE people ADD COLUMN role          TEXT    NOT NULL DEFAULT 'user';
ALTER TABLE people ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
