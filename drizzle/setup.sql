-- ============================================================
-- Shayona Inventory — full schema setup
-- Run this once on a fresh database to create all tables.
-- Safe to re-run: all statements use IF NOT EXISTS.
-- ============================================================

-- ── Better Auth tables ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user" (
  "id"            text        PRIMARY KEY,
  "name"          text,
  "email"         text        NOT NULL UNIQUE,
  "emailVerified" boolean     NOT NULL DEFAULT false,
  "image"         text,
  "createdAt"     timestamp   NOT NULL DEFAULT now(),
  "updatedAt"     timestamp   NOT NULL DEFAULT now(),
  "role"          text        DEFAULT 'user',
  "banned"        boolean     DEFAULT false,
  "banReason"     text,
  "banExpires"    timestamp
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"          text        PRIMARY KEY,
  "expiresAt"   timestamp   NOT NULL,
  "token"       text        NOT NULL UNIQUE,
  "createdAt"   timestamp   NOT NULL DEFAULT now(),
  "updatedAt"   timestamp   NOT NULL DEFAULT now(),
  "ipAddress"   text,
  "userAgent"   text,
  "userId"      text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                      text        PRIMARY KEY,
  "accountId"               text        NOT NULL,
  "providerId"              text        NOT NULL,
  "userId"                  text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"             text,
  "refreshToken"            text,
  "idToken"                 text,
  "accessTokenExpiresAt"    timestamp,
  "refreshTokenExpiresAt"   timestamp,
  "scope"                   text,
  "password"                text,
  "createdAt"               timestamp   NOT NULL DEFAULT now(),
  "updatedAt"               timestamp   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"          text        PRIMARY KEY,
  "identifier"  text        NOT NULL,
  "value"       text        NOT NULL,
  "expiresAt"   timestamp   NOT NULL,
  "createdAt"   timestamp   DEFAULT now(),
  "updatedAt"   timestamp   DEFAULT now()
);

-- ── App table ───────────────────────────────────────────────
--
-- Single unified table for all inventory entries.
-- entryType: 'scan'   = camera / image QR scan
--            'manual' = manually keyed in via the form
--
-- rawQrCode is NULL for manual entries.
-- All QR-derived fields (division, mrp, mfgMonth, mfgYear)
-- are NULL for manual entries.

CREATE TABLE IF NOT EXISTS "scans" (
  "id"            serial      PRIMARY KEY,
  "entryType"     text        NOT NULL DEFAULT 'scan',
  "rawQrCode"     text,                            -- NULL for manual entries
  "artNumber"     text,                            -- article code, e.g. FL0548L
  "colorNumber"   text,                            -- color code, e.g. SASA
  "sizeNumber"    text,                            -- size, e.g. 6
  "division"      text,                            -- Flite EVA / Flite PU / Sparx / Bahamas
  "mrp"           numeric,                         -- e.g. 289.50
  "mfgMonth"      integer,                         -- 1-12
  "mfgYear"       integer,                         -- e.g. 2026
  "scannedByName" text,                            -- display name from login session
  "notes"         text,                            -- free-text, manual entries only
  "quantity"      integer     NOT NULL DEFAULT 1,
  "scannedAt"     timestamp   NOT NULL DEFAULT now(),
  "createdAt"     timestamp   NOT NULL DEFAULT now(),
  "updatedAt"     timestamp   NOT NULL DEFAULT now()
);
