const { app } = require('@azure/functions');
const auth = require('../auth');

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const unauthorized = { status: 401, jsonBody: { error: 'Unauthorized' } };

// ── POST /api/login ─────────────────────────────────────────────────────────
app.http('login', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'login',
    handler: async (request, context) => {
        let body;
        try { body = await request.json(); } catch {
            return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
        }
        const username = auth.normalizeUsername(body.username);
        const password = typeof body.password === 'string' ? body.password : '';
        if (!username || !password) {
            return { status: 400, jsonBody: { error: 'Username and password are required' } };
        }

        try {
            const user = await auth.getUser(username);
            if (user) {
                if (!auth.verifyPassword(password, user.passwordHash)) return unauthorized;
                if (user.approved === false) {
                    return { status: 403, jsonBody: { error: 'Your account is waiting for approval' } };
                }
                return { status: 200, jsonBody: { token: auth.createToken(user.rowKey, user.role), username: user.rowKey, role: user.role } };
            }
            // Bootstrap: ADMIN_KEY acts as the "admin" password until users exist.
            if (username === auth.BOOTSTRAP_USER && await auth.bootstrapAvailable()
                && auth.safeEqual(password, process.env.ADMIN_KEY)) {
                return { status: 200, jsonBody: { token: auth.createToken(username, 'admin'), username, role: 'admin', bootstrap: true } };
            }
            return unauthorized;
        } catch (err) {
            context.log('Login error:', err.message);
            return { status: 500, jsonBody: { error: 'Login failed' } };
        }
    }
});

// ── GET /api/users (admin) ──────────────────────────────────────────────────
app.http('listUsers', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'users',
    handler: async (request, context) => {
        try {
            if (!await auth.authorize(request, ['admin'])) return unauthorized;
            return { status: 200, jsonBody: await auth.listUsers() };
        } catch (err) {
            context.log('Error listing users:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to list users' } };
        }
    }
});

// ── POST /api/users (admin) — create or update a user ───────────────────────
app.http('saveUser', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'users',
    handler: async (request, context) => {
        try {
            const me = await auth.authorize(request, ['admin']);
            if (!me) return unauthorized;

            let body;
            try { body = await request.json(); } catch {
                return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
            }
            const username = auth.normalizeUsername(body.username);
            const { password, role } = body;

            if (!USERNAME_RE.test(username)) {
                return { status: 400, jsonBody: { error: 'Username must be 3-32 characters: letters, numbers, . _ -' } };
            }
            if (!auth.ROLES.includes(role)) {
                return { status: 400, jsonBody: { error: 'Role must be "admin", "edit" or "commenter"' } };
            }

            const client = auth.getUsersClient();
            try { await client.createTable(); } catch { /* already exists */ }
            const existing = await auth.getUser(username);

            if (!existing && (typeof password !== 'string' || password.length < 8)) {
                return { status: 400, jsonBody: { error: 'Password must be at least 8 characters' } };
            }
            if (password && (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
                return { status: 400, jsonBody: { error: 'Password must be 8-128 characters' } };
            }
            if (existing && existing.role === 'admin' && role !== 'admin' && await countAdmins() <= 1) {
                return { status: 400, jsonBody: { error: 'Cannot demote the last admin' } };
            }

            // Staff are vetted by the admin; commenters keep their approval state
            // unless the request sets it (new admin-created accounts start approved).
            const approved = role !== 'commenter' ? true
                : typeof body.approved === 'boolean' ? body.approved
                : existing ? existing.approved !== false : true;

            await client.upsertEntity({
                partitionKey: auth.USERS_PARTITION,
                rowKey: username,
                role,
                approved,
                passwordHash: password ? auth.hashPassword(password) : existing.passwordHash
            }, 'Replace');

            return { status: existing ? 200 : 201, jsonBody: { username, role, approved } };
        } catch (err) {
            context.log('Error saving user:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to save user' } };
        }
    }
});

// ── DELETE /api/users/{username} (admin) ────────────────────────────────────
app.http('deleteUser', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'users/{username}',
    handler: async (request, context) => {
        try {
            const me = await auth.authorize(request, ['admin']);
            if (!me) return unauthorized;

            const username = auth.normalizeUsername(request.params.username);
            const target = await auth.getUser(username);
            if (!target) return { status: 404, jsonBody: { error: 'User not found' } };
            if (target.role === 'admin' && await countAdmins() <= 1) {
                return { status: 400, jsonBody: { error: 'Cannot delete the last admin' } };
            }
            await auth.getUsersClient().deleteEntity(auth.USERS_PARTITION, username);
            return { status: 200, jsonBody: { message: 'User deleted' } };
        } catch (err) {
            context.log('Error deleting user:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to delete user' } };
        }
    }
});

async function countAdmins() {
    return (await auth.listUsers()).filter(u => u.role === 'admin').length;
}
