const { app } = require('@azure/functions');
const crypto = require('crypto');
const { authorize, ROLES } = require('../auth');
const { getTable, odata } = require('../storage');

const COMMENTS_TABLE = 'comments';
const MAX_COMMENT_LENGTH = 1000;
const MAX_COMMENTS_RETURNED = 300;
const ID_RE = /^[\w.-]+$/;

const unauthorized = { status: 401, jsonBody: { error: 'Please sign in to comment' } };

function isNotFound(err) {
    return err && err.statusCode === 404;
}

// ── GET /api/locations/{id}/comments ────────────────────────────────────────
// Public. Oldest first.
app.http('getComments', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'locations/{id}/comments',
    handler: async (request, context) => {
        const id = request.params.id;
        if (!ID_RE.test(id)) return { status: 400, jsonBody: { error: 'Invalid id' } };

        try {
            const comments = [];
            try {
                const iter = getTable(COMMENTS_TABLE).listEntities({
                    queryOptions: { filter: odata`PartitionKey eq ${id}` }
                });
                for await (const c of iter) {
                    comments.push({ id: c.rowKey, author: c.author, text: c.text, createdAt: c.createdAt });
                    if (comments.length >= MAX_COMMENTS_RETURNED) break;
                }
            } catch (err) {
                if (!isNotFound(err)) throw err; // no comments table yet
            }
            return { status: 200, jsonBody: comments };
        } catch (err) {
            context.log('Error fetching comments:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to load comments' } };
        }
    }
});

// ── POST /api/locations/{id}/comments ───────────────────────────────────────
// Any signed-in user (admin or edit).
app.http('addComment', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'locations/{id}/comments',
    handler: async (request, context) => {
        const id = request.params.id;
        if (!ID_RE.test(id)) return { status: 400, jsonBody: { error: 'Invalid id' } };

        try {
            const me = await authorize(request, ROLES);
            if (!me) return unauthorized;

            let body;
            try { body = await request.json(); } catch {
                return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
            }
            const text = typeof body.text === 'string' ? body.text.trim() : '';
            if (!text) return { status: 400, jsonBody: { error: 'Comment cannot be empty' } };
            if (text.length > MAX_COMMENT_LENGTH) {
                return { status: 400, jsonBody: { error: `Comments are limited to ${MAX_COMMENT_LENGTH} characters` } };
            }

            try {
                await getTable('locations').getEntity('location', id);
            } catch (err) {
                if (isNotFound(err)) return { status: 404, jsonBody: { error: 'Postcard not found' } };
                throw err;
            }

            const client = getTable(COMMENTS_TABLE);
            try { await client.createTable(); } catch { /* already exists */ }

            const createdAt = new Date().toISOString();
            // Sortable row key: oldest first, random suffix avoids collisions.
            const rowKey = `${String(Date.now()).padStart(15, '0')}_${crypto.randomBytes(4).toString('hex')}`;
            await client.createEntity({ partitionKey: id, rowKey, author: me.username, text, createdAt });

            return { status: 201, jsonBody: { id: rowKey, author: me.username, text, createdAt } };
        } catch (err) {
            context.log('Error adding comment:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to save comment' } };
        }
    }
});

// ── DELETE /api/locations/{id}/comments/{commentId} ─────────────────────────
// Admins can delete any comment; everyone else only their own.
app.http('deleteComment', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'locations/{id}/comments/{commentId}',
    handler: async (request, context) => {
        const { id, commentId } = request.params;
        if (!ID_RE.test(id) || !ID_RE.test(commentId)) {
            return { status: 400, jsonBody: { error: 'Invalid id' } };
        }

        try {
            const me = await authorize(request, ROLES);
            if (!me) return { status: 401, jsonBody: { error: 'Unauthorized' } };

            const client = getTable(COMMENTS_TABLE);
            let comment;
            try {
                comment = await client.getEntity(id, commentId);
            } catch (err) {
                if (isNotFound(err)) return { status: 404, jsonBody: { error: 'Comment not found' } };
                throw err;
            }

            if (me.role !== 'admin' && comment.author !== me.username) {
                return { status: 403, jsonBody: { error: 'You can only delete your own comments' } };
            }

            await client.deleteEntity(id, commentId);
            return { status: 200, jsonBody: { message: 'Comment deleted' } };
        } catch (err) {
            context.log('Error deleting comment:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to delete comment' } };
        }
    }
});
