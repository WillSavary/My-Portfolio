"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dataDirectory = path.resolve(process.env.HAULWISE_DATA_DIR || path.join(__dirname, ".haulwise-data"));
const publicRoot = path.resolve(__dirname, "..");
const relativeDataPath = path.relative(publicRoot, dataDirectory);
const dataPathIsPublic = relativeDataPath === ""
    || (!path.isAbsolute(relativeDataPath) && relativeDataPath !== ".." && !relativeDataPath.startsWith(`..${path.sep}`));
if (dataPathIsPublic && dataDirectory !== path.resolve(__dirname, ".haulwise-data")) {
    throw new Error("HAULWISE_DATA_DIR must be outside the public site root or use the private default directory.");
}
fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

const db = new Database(path.join(dataDirectory, "haulwise.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL UNIQUE,
        plan TEXT NOT NULL DEFAULT 'fleet',
        status TEXT NOT NULL DEFAULT 'incomplete',
        current_period_end INTEGER,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_invitations (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('company_admin', 'driver')),
        code_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS truck_assignments (
        truck_id TEXT NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_at TEXT NOT NULL,
        released_at TEXT,
        PRIMARY KEY (truck_id, user_id, assigned_at)
    );

    CREATE TABLE IF NOT EXISTS payroll_periods (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payroll_entries (
        id TEXT PRIMARY KEY,
        period_id TEXT NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        miles REAL NOT NULL DEFAULT 0,
        rate REAL NOT NULL DEFAULT 0,
        amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eld_connections (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider TEXT NOT NULL DEFAULT 'provider-neutral',
        external_account_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'syncing', 'error')),
        last_sync_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('carrier', 'independent')),
        business_email TEXT NOT NULL DEFAULT '',
        business_kind TEXT NOT NULL DEFAULT '',
        dot_number TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
        invite_code_hash TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'company_admin', 'driver')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
        company_id TEXT REFERENCES companies(id),
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trucks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT '',
        plate TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        customer TEXT NOT NULL DEFAULT '',
        reference TEXT NOT NULL DEFAULT '',
        origin TEXT NOT NULL DEFAULT '',
        origin_address TEXT NOT NULL DEFAULT '',
        destination TEXT NOT NULL DEFAULT '',
        destination_address TEXT NOT NULL DEFAULT '',
        entry_notes TEXT NOT NULL DEFAULT '',
        odometer_start REAL NOT NULL DEFAULT 0,
        odometer_end REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facilities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        country TEXT NOT NULL CHECK (country IN ('US', 'CA')),
        address TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        verified_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS users_company_idx ON users(company_id);
    CREATE INDEX IF NOT EXISTS trucks_company_idx ON trucks(company_id);
    CREATE INDEX IF NOT EXISTS trips_company_idx ON trips(company_id);
    CREATE INDEX IF NOT EXISTS facilities_company_idx ON facilities(company_id);
    CREATE INDEX IF NOT EXISTS audit_company_idx ON audit_events(company_id, created_at);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

module.exports = { db, dataDirectory };
