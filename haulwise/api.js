"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { db } = require("./database");

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "haulwise_session";
const SESSION_DURATION = 8 * 60 * 60 * 1000;
const allowedRecordKinds = new Set(["users", "companies", "trucks", "trips", "facilities", "activity"]);
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const setupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const accountWriteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

router.use(express.json({ limit: "2mb" }));
router.use((request, response, next) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) request.body = {};
    next();
});
router.use((request, response, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        requireSameOrigin(request, response, next);
        return;
    }
    next();
});

router.get("/auth/status", (request, response) => {
    const user = findSessionUser(request);
    if (!user || user.status !== "active" || user.role === "owner") {
        response.json({ authenticated: false });
        return;
    }
    response.json({
        authenticated: true,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            companyId: user.company_id,
            companyName: user.company_name
        }
    });
});

router.post("/auth/register", loginLimiter, async (request, response) => {
    if (!db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get()) {
        response.status(503).json({ error: "Account requests open after the Haulwise owner completes private setup." });
        return;
    }
    const name = cleanText(request.body.name, 80);
    const email = cleanEmail(request.body.email);
    const password = typeof request.body.password === "string" ? request.body.password : "";
    const accountType = request.body.accountType;
    if (!name || !email || password.length < 12 || password.length > 256) {
        response.status(400).json({ error: "Enter your name, a valid email, and a password between 12 and 256 characters." });
        return;
    }
    if (!["driver", "owner", "company"].includes(accountType)) {
        response.status(400).json({ error: "Choose a valid account type." });
        return;
    }

    let company;
    let role = "driver";
    let status = "pending";
    if (accountType === "driver") {
        const inviteCode = cleanText(request.body.inviteCode, 100);
        company = inviteCode
            ? db.prepare("SELECT id, name, status FROM companies WHERE invite_code_hash = ? AND type = 'carrier'").get(hashToken(inviteCode))
            : null;
        if (!company || company.status !== "active") {
            response.status(400).json({ error: "That company invitation is invalid or inactive. Ask your carrier for a current code." });
            return;
        }
    } else {
        const companyName = cleanText(request.body.companyName, 100)
            || (accountType === "owner" ? `${name} - Independent` : "");
        if (!companyName) {
            response.status(400).json({ error: "Enter your legal business name." });
            return;
        }
        company = {
            id: crypto.randomUUID(),
            name: companyName,
            businessEmail: cleanEmail(request.body.businessEmail),
            businessKind: cleanText(request.body.businessKind, 80),
            dotNumber: cleanText(request.body.dotNumber, 12),
            status: "pending"
        };
        if (accountType === "company") role = "company_admin";
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, salt);
    const user = {
        id: crypto.randomUUID(),
        username: email,
        email,
        name,
        password_salt: salt,
        password_hash: passwordHash,
        role,
        status,
        company_id: company.id
    };

    try {
        const createPendingAccount = db.transaction(() => {
            if (accountType !== "driver") {
                db.prepare(`
                    INSERT INTO companies (id, name, type, business_email, business_kind, dot_number, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                `).run(
                    company.id,
                    company.name,
                    accountType === "owner" ? "independent" : "carrier",
                    company.businessEmail,
                    company.businessKind,
                    company.dotNumber,
                    new Date().toISOString()
                );
            }
            db.prepare(`
                INSERT INTO users (id, username, email, name, password_salt, password_hash, role, status, company_id, created_at)
                VALUES (@id, @username, @email, @name, @password_salt, @password_hash, @role, @status, @company_id, @created_at)
            `).run({ ...user, created_at: new Date().toISOString() });
            recordAudit({ actorUserId: user.id, companyId: company.id, action: "account.registered", entityType: "user", entityId: user.id });
        });
        createPendingAccount();
    } catch (error) {
        if (String(error.message).includes("UNIQUE")) {
            response.status(409).json({ error: "An account with that email already exists." });
            return;
        }
        console.error("Account registration failed:", error.message);
        response.status(500).json({ error: "Could not create the account. Try again later." });
        return;
    }

    response.status(202).json({
        message: "Your account request was received and is pending owner approval. Sign-in is enabled after approval."
    });
});

router.post("/auth/login", loginLimiter, async (request, response) => {
    const identifier = cleanText(request.body.identifier, 254).toLocaleLowerCase("en-US");
    const password = typeof request.body.password === "string" ? request.body.password : "";
    const user = db.prepare(`
        SELECT users.*, companies.name AS company_name, companies.status AS company_status
        FROM users LEFT JOIN companies ON companies.id = users.company_id
        WHERE users.email = ? OR users.username = ?
    `).get(identifier, identifier);
    if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
        response.status(401).json({ error: "Email/username or password is incorrect." });
        return;
    }
    if (user.role === "owner") {
        response.status(403).json({ error: "Use the private owner console to sign in as the Haulwise owner." });
        return;
    }
    if (user.status !== "active" || (user.company_id && user.company_status !== "active")) {
        response.status(403).json({ error: "This account is pending approval or has been suspended. Contact the Haulwise owner." });
        return;
    }
    issueSession(response, user.id);
    recordAudit({ actorUserId: user.id, companyId: user.company_id, action: "account.signed_in", entityType: "session", entityId: "" });
    response.json({ user: publicUser(user) });
});

router.post("/auth/logout", (request, response) => {
    const token = readCookie(request, SESSION_COOKIE);
    const user = findSessionUser(request);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    clearSessionCookie(response);
    if (user) recordAudit({ actorUserId: user.id, companyId: user.company_id, action: "account.signed_out", entityType: "session", entityId: "" });
    response.sendStatus(204);
});

router.get("/account/data", requireActiveUser, (request, response) => {
    response.json({ data: getAccountData(request.user) });
});

router.post("/account/import", accountWriteLimiter, requireActiveUser, (request, response) => {
    const result = saveAccountData(request.user, request.body.data, true);
    if (result.error) {
        response.status(400).json({ error: result.error });
        return;
    }
    response.json({ data: getAccountData(request.user), imported: result.imported });
});

router.put("/account/data", accountWriteLimiter, requireActiveUser, (request, response) => {
    const result = saveAccountData(request.user, request.body.data, false);
    if (result.error) {
        response.status(400).json({ error: result.error });
        return;
    }
    response.json({ saved: true });
});

router.delete("/account/facilities/:id", accountWriteLimiter, requireActiveUser, (request, response) => {
    const result = db.prepare("DELETE FROM facilities WHERE id = ? AND user_id = ?").run(request.params.id, request.user.id);
    if (result.changes) {
        recordAudit({ actorUserId: request.user.id, companyId: request.user.company_id, action: "facility.deleted", entityType: "facility", entityId: request.params.id });
    }
    response.sendStatus(204);
});

router.get("/admin/setup-status", (request, response) => {
    response.json({
        configured: db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get() !== undefined,
        setupEnabled: isBootstrapConfigured()
    });
});

router.post("/admin/bootstrap", setupLimiter, async (request, response) => {
    if (!isBootstrapConfigured()) {
        response.status(503).json({ error: "Owner setup is disabled. Configure a private ADMIN_BOOTSTRAP_TOKEN with at least 32 characters first." });
        return;
    }
    const setupToken = typeof request.body.setupToken === "string" ? request.body.setupToken : "";
    if (!secureStringEqual(setupToken, process.env.ADMIN_BOOTSTRAP_TOKEN)) {
        response.status(403).json({ error: "The owner setup token is incorrect." });
        return;
    }
    if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get()) {
        response.status(409).json({ error: "Owner setup has already been completed." });
        return;
    }

    const username = cleanUsername(request.body.username);
    const email = cleanEmail(request.body.email);
    const password = typeof request.body.password === "string" ? request.body.password : "";
    if (!username || !email || password.length < 14 || password.length > 256) {
        response.status(400).json({ error: "Choose a username, valid email, and unique password of at least 14 characters." });
        return;
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, salt);
    const user = {
        id: crypto.randomUUID(),
        username,
        email,
        name: username,
        password_salt: salt,
        password_hash: passwordHash,
        role: "owner",
        status: "active",
        company_id: null,
        created_at: new Date().toISOString()
    };

    try {
        const createOwner = db.transaction(() => {
            if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get()) {
                throw new Error("Owner setup has already been completed.");
            }
            db.prepare(`
                INSERT INTO users (id, username, email, name, password_salt, password_hash, role, status, company_id, created_at)
                VALUES (@id, @username, @email, @name, @password_salt, @password_hash, @role, @status, @company_id, @created_at)
            `).run(user);
            recordAudit({ actorUserId: user.id, companyId: null, action: "owner.bootstrap_completed", entityType: "user", entityId: user.id });
        });
        createOwner();
    } catch (error) {
        if (String(error.message).includes("UNIQUE")) {
            response.status(409).json({ error: "That username or email is already in use." });
            return;
        }
        response.status(409).json({ error: "Owner setup was already completed." });
        return;
    }

    issueSession(response, user.id);
    response.status(201).json({ user: publicUser(user) });
});

router.post("/admin/login", loginLimiter, async (request, response) => {
    const identifier = cleanText(request.body.identifier, 254).toLocaleLowerCase("en-US");
    const password = typeof request.body.password === "string" ? request.body.password : "";
    const user = db.prepare("SELECT * FROM users WHERE email = ? OR username = ?").get(identifier, identifier);
    if (!user || user.role !== "owner" || user.status !== "active" || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
        response.status(401).json({ error: "Owner username/email or password is incorrect." });
        return;
    }
    issueSession(response, user.id);
    recordAudit({ actorUserId: user.id, companyId: null, action: "owner.signed_in", entityType: "session", entityId: "" });
    response.json({ user: publicUser(user) });
});

router.get("/admin/overview", requireOwner, (request, response) => {
    const counts = {};
    for (const table of ["users", "companies", "trucks", "trips", "facilities", "audit_events"]) {
        counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    }
    response.json({ counts });
});

router.get("/admin/records/:kind", requireOwner, (request, response) => {
    const kind = request.params.kind;
    if (!allowedRecordKinds.has(kind)) {
        response.status(404).json({ error: "Record type not found." });
        return;
    }
    const page = Math.max(1, Math.min(100000, Number.parseInt(request.query.page, 10) || 1));
    const pageSize = 50;
    const offset = (page - 1) * pageSize;
    const queries = {
        users: {
            count: "SELECT COUNT(*) AS count FROM users",
            rows: `SELECT u.id, u.username, u.email, u.name, u.role, u.status, u.created_at, c.name AS company_name
                FROM users u LEFT JOIN companies c ON c.id = u.company_id
                ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
        },
        companies: {
            count: "SELECT COUNT(*) AS count FROM companies",
            rows: `SELECT c.id, c.name, c.type, c.business_email, c.business_kind, c.dot_number, c.status, c.created_at, COUNT(DISTINCT u.id) AS user_count
                FROM companies c LEFT JOIN users u ON u.company_id = c.id
                GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
        },
        trucks: {
            count: "SELECT COUNT(*) AS count FROM trucks",
            rows: `SELECT t.id, t.name, t.unit, t.plate, t.updated_at, u.name AS driver_name, c.name AS company_name
                FROM trucks t JOIN users u ON u.id = t.user_id LEFT JOIN companies c ON c.id = t.company_id
                ORDER BY t.updated_at DESC LIMIT ? OFFSET ?`
        },
        trips: {
            count: "SELECT COUNT(*) AS count FROM trips",
            rows: `SELECT t.id, t.customer, t.reference, t.origin, t.origin_address, t.destination, t.destination_address,
                t.entry_notes, t.odometer_start, t.odometer_end, t.created_at, u.name AS driver_name, c.name AS company_name
                FROM trips t JOIN users u ON u.id = t.user_id LEFT JOIN companies c ON c.id = t.company_id
                ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
        },
        facilities: {
            count: "SELECT COUNT(*) AS count FROM facilities",
            rows: `SELECT f.id, f.name, f.country, f.address, f.notes, f.verified_at, u.name AS added_by, c.name AS company_name
                FROM facilities f JOIN users u ON u.id = f.user_id LEFT JOIN companies c ON c.id = f.company_id
                ORDER BY f.verified_at DESC LIMIT ? OFFSET ?`
        },
        activity: {
            count: "SELECT COUNT(*) AS count FROM audit_events",
            rows: `SELECT e.id, e.action, e.entity_type, e.entity_id, e.created_at, u.username AS actor, c.name AS company_name
                FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id LEFT JOIN companies c ON c.id = e.company_id
                ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
        }
    }[kind];
    response.json({
        page,
        pageSize,
        total: db.prepare(queries.count).get().count,
        records: db.prepare(queries.rows).all(pageSize, offset)
    });
});

router.post("/admin/companies", requireOwner, (request, response) => {
    const name = cleanText(request.body.name, 100);
    if (!name) {
        response.status(400).json({ error: "Enter a company name." });
        return;
    }
    const id = crypto.randomUUID();
    const inviteCode = crypto.randomBytes(18).toString("base64url");
    db.prepare(`
        INSERT INTO companies (id, name, type, status, invite_code_hash, created_at)
        VALUES (?, ?, 'carrier', 'active', ?, ?)
    `).run(id, name, hashToken(inviteCode), new Date().toISOString());
    recordAudit({ actorUserId: request.user.id, companyId: id, action: "company.created", entityType: "company", entityId: id });
    response.status(201).json({ company: { id, name, status: "active" }, inviteCode });
});

router.patch("/admin/users/:id/status", requireOwner, (request, response) => {
    const status = request.body.status;
    if (!["active", "suspended"].includes(status)) {
        response.status(400).json({ error: "Choose active or suspended." });
        return;
    }
    const target = db.prepare("SELECT id, role, company_id FROM users WHERE id = ?").get(request.params.id);
    if (!target || target.role === "owner") {
        response.status(404).json({ error: "Account not found or cannot be changed here." });
        return;
    }
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, target.id);
    if (status === "suspended") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(target.id);
    recordAudit({ actorUserId: request.user.id, companyId: target.company_id, action: `user.${status}`, entityType: "user", entityId: target.id });
    response.json({ id: target.id, status });
});

router.patch("/admin/companies/:id/status", requireOwner, (request, response) => {
    const status = request.body.status;
    if (!["active", "suspended"].includes(status)) {
        response.status(400).json({ error: "Choose active or suspended." });
        return;
    }
    const company = db.prepare("SELECT id FROM companies WHERE id = ?").get(request.params.id);
    if (!company) {
        response.status(404).json({ error: "Company not found." });
        return;
    }
    db.prepare("UPDATE companies SET status = ? WHERE id = ?").run(status, company.id);
    if (status === "suspended") {
        db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)").run(company.id);
    }
    recordAudit({ actorUserId: request.user.id, companyId: company.id, action: `company.${status}`, entityType: "company", entityId: company.id });
    response.json({ id: company.id, status });
});

router.use((error, request, response, next) => {
    if (response.headersSent) {
        next(error);
        return;
    }
    if (error.type === "entity.too.large") {
        response.status(413).json({ error: "Request data is too large." });
        return;
    }
    console.error("Haulwise API request failed:", error.message);
    response.status(500).json({ error: "The server could not complete the request." });
});

function requireSameOrigin(request, response, next) {
    let expectedOrigin;
    try {
        const appUrl = new URL(process.env.APP_BASE_URL);
        if (appUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(appUrl.hostname)) {
            throw new Error("HTTPS is required outside localhost.");
        }
        expectedOrigin = appUrl.origin;
    } catch {
        response.status(503).json({ error: "The public site URL is not configured." });
        return;
    }
    if (request.get("origin") !== expectedOrigin) {
        response.status(403).json({ error: "Request origin is not allowed." });
        return;
    }
    next();
}

function requireActiveUser(request, response, next) {
    const user = findSessionUser(request);
    if (!user) {
        response.status(401).json({ error: "Sign in to sync your account data." });
        return;
    }
    if (user.status !== "active" || (user.company_id && user.company_status !== "active")) {
        response.status(403).json({ error: "This account is pending approval or suspended." });
        return;
    }
    if (!user.company_id) {
        response.status(403).json({ error: "This account has no active company workspace." });
        return;
    }
    request.user = user;
    next();
}

function requireOwner(request, response, next) {
    const user = findSessionUser(request);
    if (!user || user.role !== "owner" || user.status !== "active") {
        response.status(401).json({ error: "Owner sign-in is required." });
        return;
    }
    request.user = user;
    next();
}

function findSessionUser(request) {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return null;
    const now = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    return db.prepare(`
        SELECT u.*, c.name AS company_name, c.status AS company_status
        FROM sessions s JOIN users u ON u.id = s.user_id
        LEFT JOIN companies c ON c.id = u.company_id
        WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), now) || null;
}

function issueSession(response, userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_DURATION;
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), userId, expiresAt);
    const secure = new URL(process.env.APP_BASE_URL).protocol === "https:";
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION / 1000}${secure ? "; Secure" : ""}`);
}

function clearSessionCookie(response) {
    const secure = process.env.APP_BASE_URL && process.env.APP_BASE_URL.startsWith("https://");
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`);
}

function readCookie(request, name) {
    const cookies = String(request.headers.cookie || "").split(";");
    const entry = cookies.map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith(`${name}=`));
    return entry ? entry.slice(name.length + 1) : "";
}

function isBootstrapConfigured() {
    return typeof process.env.ADMIN_BOOTSTRAP_TOKEN === "string" && process.env.ADMIN_BOOTSTRAP_TOKEN.length >= 32;
}

function secureStringEqual(candidate, expected) {
    if (typeof candidate !== "string" || typeof expected !== "string") return false;
    const candidateDigest = crypto.createHash("sha256").update(candidate).digest();
    const expectedDigest = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(candidateDigest, expectedDigest) && candidate.length === expected.length;
}

async function hashPassword(password, salt) {
    return (await scrypt(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString("hex");
}

async function verifyPassword(password, salt, expectedHash) {
    if (typeof password !== "string" || password.length > 256 || !salt || !expectedHash) return false;
    const actual = await hashPassword(password, salt);
    const expected = Buffer.from(expectedHash, "hex");
    const candidate = Buffer.from(actual, "hex");
    return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function cleanText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanEmail(value) {
    const email = cleanText(value, 254).toLocaleLowerCase("en-US");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanUsername(value) {
    const username = cleanText(value, 40);
    return /^[a-zA-Z0-9._-]{3,40}$/.test(username) ? username : "";
}

function hashToken(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function recordAudit({ actorUserId, companyId, action, entityType, entityId }) {
    db.prepare(`
        INSERT INTO audit_events (id, actor_user_id, company_id, action, entity_type, entity_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), actorUserId || null, companyId || null, action, entityType, entityId || "", new Date().toISOString());
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.company_id || null,
        companyName: user.company_name || null
    };
}

function getAccountData(user) {
    const truck = db.prepare("SELECT name, unit, plate FROM trucks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1").get(user.id);
    const trips = db.prepare("SELECT * FROM trips WHERE user_id = ? ORDER BY created_at DESC").all(user.id).map((trip) => ({
        id: trip.id,
        company: trip.customer,
        reference: trip.reference,
        origin: trip.origin,
        originAddress: trip.origin_address,
        destination: trip.destination,
        address: trip.destination_address,
        entry: trip.entry_notes,
        start: trip.odometer_start,
        end: trip.odometer_end,
        date: trip.created_at
    }));
    const facilities = db.prepare("SELECT * FROM facilities WHERE user_id = ? ORDER BY verified_at DESC").all(user.id).map((facility) => ({
        id: facility.id,
        name: facility.name,
        country: facility.country,
        address: facility.address,
        notes: facility.notes,
        verifiedAt: facility.verified_at,
        source: "driver-verified"
    }));
    return { truck: truck || { name: "", unit: "", plate: "" }, trips, facilities };
}

function saveAccountData(user, payload, isImport) {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.trips) || !Array.isArray(payload.facilities)
        || (payload.truck !== undefined && payload.truck !== null
            && (typeof payload.truck !== "object" || Array.isArray(payload.truck)))) {
        return { error: "Account data has an invalid format." };
    }
    if (payload.trips.length > 1000 || payload.facilities.length > 1000) {
        return { error: "This import exceeds the 1,000 trip or facility limit." };
    }
    const trips = [];
    for (const trip of payload.trips) {
        if (!trip || typeof trip !== "object" || Array.isArray(trip)) return { error: "A trip record has an invalid format." };
        if (trip.id === "sample-trip") continue;
        const start = Number(trip.start);
        const end = Number(trip.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
            return { error: "A trip has invalid odometer readings." };
        }
        trips.push({
            id: safeRecordId(trip.id),
            customer: cleanText(trip.company, 100),
            reference: cleanText(trip.reference, 80),
            origin: cleanText(trip.origin, 160),
            origin_address: cleanText(trip.originAddress, 240),
            destination: cleanText(trip.destination, 160),
            destination_address: cleanText(trip.address, 240),
            entry_notes: cleanText(trip.entry, 240),
            odometer_start: start,
            odometer_end: end,
            created_at: validDate(trip.date)
        });
    }
    const facilities = [];
    for (const facility of payload.facilities) {
        if (!facility || typeof facility !== "object" || Array.isArray(facility)) {
            return { error: "A facility record has an invalid format." };
        }
        const country = facility.country === "CA" ? "CA" : facility.country === "US" ? "US" : "";
        const name = cleanText(facility.name, 100);
        const address = cleanText(facility.address, 240);
        if (!country || !name || !address) {
            return { error: "A facility needs a name, a U.S. or Canadian country, and an address." };
        }
        facilities.push({
            id: safeRecordId(facility.id),
            name,
            country,
            address,
            notes: cleanText(facility.notes, 240),
            verified_at: validDate(facility.verifiedAt)
        });
    }
    const truck = payload.truck ? {
        name: cleanText(payload.truck.name, 100),
        unit: cleanText(payload.truck.unit, 30),
        plate: cleanText(payload.truck.plate, 20)
    } : null;

    let imported = 0;
    const writeData = db.transaction(() => {
        if (truck && truck.name) {
            db.prepare(`
                INSERT INTO trucks (id, user_id, company_id, name, unit, plate, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, unit = excluded.unit, plate = excluded.plate, updated_at = excluded.updated_at
                WHERE trucks.user_id = excluded.user_id
            `).run(user.id, user.id, user.company_id, truck.name, truck.unit, truck.plate, new Date().toISOString());
        }

        const tripStatement = db.prepare(`
            INSERT INTO trips (id, user_id, company_id, customer, reference, origin, origin_address, destination,
                destination_address, entry_notes, odometer_start, odometer_end, created_at)
            VALUES (@id, @user_id, @company_id, @customer, @reference, @origin, @origin_address, @destination,
                @destination_address, @entry_notes, @odometer_start, @odometer_end, @created_at)
            ON CONFLICT(id) DO UPDATE SET customer = excluded.customer, reference = excluded.reference,
                origin = excluded.origin, origin_address = excluded.origin_address, destination = excluded.destination,
                destination_address = excluded.destination_address, entry_notes = excluded.entry_notes,
                odometer_start = excluded.odometer_start, odometer_end = excluded.odometer_end, created_at = excluded.created_at
            WHERE trips.user_id = excluded.user_id
        `);
        for (const trip of trips) {
            tripStatement.run({
                id: trip.id,
                user_id: user.id,
                company_id: user.company_id,
                ...trip
            });
            imported += 1;
        }

        const facilityStatement = db.prepare(`
            INSERT INTO facilities (id, user_id, company_id, name, country, address, notes, verified_at)
            VALUES (@id, @user_id, @company_id, @name, @country, @address, @notes, @verified_at)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, country = excluded.country, address = excluded.address,
                notes = excluded.notes, verified_at = excluded.verified_at
            WHERE facilities.user_id = excluded.user_id
        `);
        for (const facility of facilities) {
            facilityStatement.run({
                id: facility.id,
                user_id: user.id,
                company_id: user.company_id,
                ...facility
            });
            imported += 1;
        }
        recordAudit({
            actorUserId: user.id,
            companyId: user.company_id,
            action: isImport ? "records.imported" : "records.synced",
            entityType: "account_data",
            entityId: ""
        });
    });
    writeData();
    return { imported };
}

function safeRecordId(value) {
    const id = cleanText(value, 80);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ? id
        : crypto.randomUUID();
}

function validDate(value) {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

module.exports = router;
