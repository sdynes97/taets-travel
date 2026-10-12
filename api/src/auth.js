const crypto = require('crypto');
const { TableClient } = require('@azure/data-tables');

const USERS_TABLE = 'users';
const USERS_PARTITION = 'user';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
// admin: everything; edit: add/edit postcards and photos, and comment.
const ROLES = ['admin', 'edit'];
const STAFF = ['admin', 'edit'];

function getUsersClient() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    return TableClient.fromConnectionString(connStr, USERS_TABLE);
}

function normalizeUsername(u) {
    return typeof u === 'string' ? u.trim().toLowerCase() : '';
}

// ── Password hashing (scrypt) ───────────────────────────────────────────────
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
    const [saltHex, hashHex] = String(stored || '').split(':');
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ── Signed tokens (stateless) ───────────────────────────────────────────────
function getSecret() {
    const secret = process.env.SESSION_SECRET || process.env.ADMIN_KEY;
    if (!secret) throw new Error('SESSION_SECRET is not set');
    return secret;
}

function sign(data) {
    return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

function createToken(username, role) {
    const payload = Buffer.from(JSON.stringify({
        u: username, r: role, exp: Date.now() + TOKEN_TTL_MS
    })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

function parseToken(token) {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!data.exp || data.exp < Date.now() || !ROLES.includes(data.r)) return null;
        return { username: data.u, role: data.r };
    } catch {
        return null;
    }
}

// ── Request authorization ───────────────────────────────────────────────────
// Returns the authenticated user ({ username, role }) when the bearer token is
// valid and the role is one of `allowedRoles`; otherwise null.
// The role is re-checked against the users table so removed/demoted users lose
// access immediately. The bootstrap admin (no users exist yet) is token-only.
async function authorize(request, allowedRoles) {
    // SWA reserves the Authorization header, so the token travels in a custom one.
    const header = request.headers.get('x-auth-token') || '';
    const match = header.match(/^Bearer (.+)$/i);
    const session = match && parseToken(match[1]);
    if (!session) return null;

    const entity = await getUser(session.username);
    if (entity) {
        if (entity.approved === false) return null; // legacy sign-up an admin hasn't enabled
        session.role = entity.role;
    } else if (session.username !== BOOTSTRAP_USER || !(await bootstrapAvailable())) {
        return null;
    }
    return allowedRoles.includes(session.role) ? session : null;
}

// ── User store ──────────────────────────────────────────────────────────────
// "commenter" accounts (an older role) are the same as "edit".
function normalizeRole(role) {
    return role === 'commenter' ? 'edit' : role;
}

async function getUser(username) {
    try {
        const entity = await getUsersClient().getEntity(USERS_PARTITION, normalizeUsername(username));
        entity.role = normalizeRole(entity.role);
        return entity;
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

async function listUsers() {
    const users = [];
    try {
        for await (const e of getUsersClient().listEntities()) {
            users.push({ username: e.rowKey, role: normalizeRole(e.role), disabled: e.approved === false });
        }
    } catch (err) {
        if (err.statusCode !== 404) throw err;
    }
    return users;
}

// ── Bootstrap ───────────────────────────────────────────────────────────────
// While no admin user exists, the legacy ADMIN_KEY env var signs in as the
// "admin" user so the first real accounts can be created from the admin page.
const BOOTSTRAP_USER = 'admin';

async function bootstrapAvailable() {
    return !!process.env.ADMIN_KEY && !(await listUsers()).some(u => u.role === 'admin');
}

module.exports = {
    ROLES, STAFF, USERS_PARTITION, BOOTSTRAP_USER,
    getUsersClient, normalizeUsername, hashPassword, verifyPassword, safeEqual,
    createToken, authorize, getUser, listUsers, bootstrapAvailable
};
