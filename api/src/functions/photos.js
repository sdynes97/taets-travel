const { app } = require('@azure/functions');
const crypto = require('crypto');
const { authorize, STAFF } = require('../auth');
const { getTable, getPhotoContainer, parsePhotos } = require('../storage');

const MAX_PHOTOS_PER_POSTCARD = 20;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_THUMB_BYTES = 512 * 1024;
const ID_RE = /^[\w.-]+$/;

const unauthorized = { status: 401, jsonBody: { error: 'Unauthorized' } };

const blobName = (locationId, photoId, thumb) => `${locationId}/${photoId}${thumb ? '_t' : ''}.jpg`;
const isJpeg = buf => buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;

async function readFile(form, field, maxBytes) {
    const file = form.get(field);
    if (!file || typeof file.arrayBuffer !== 'function') return { error: `${field} is required` };
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > maxBytes) return { error: `${field} is too large` };
    if (!isJpeg(buf)) return { error: `${field} must be a JPEG` };
    return { buf };
}

async function getLocation(id) {
    try {
        return await getTable('locations').getEntity('location', id);
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

// ── POST /api/locations/{id}/photos ─────────────────────────────────────────
// multipart/form-data with JPEG parts "image" (full size) and "thumb".
// The admin page resizes photos in the browser before uploading.
app.http('addPhoto', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'locations/{id}/photos',
    handler: async (request, context) => {
        const id = request.params.id;
        if (!ID_RE.test(id)) return { status: 400, jsonBody: { error: 'Invalid id' } };

        try {
            if (!await authorize(request, STAFF)) return unauthorized;

            let form;
            try { form = await request.formData(); } catch {
                return { status: 400, jsonBody: { error: 'Expected multipart form data' } };
            }
            const image = await readFile(form, 'image', MAX_IMAGE_BYTES);
            if (image.error) return { status: 400, jsonBody: { error: image.error } };
            const thumb = await readFile(form, 'thumb', MAX_THUMB_BYTES);
            if (thumb.error) return { status: 400, jsonBody: { error: thumb.error } };

            const location = await getLocation(id);
            if (!location) return { status: 404, jsonBody: { error: 'Postcard not found' } };

            const photos = parsePhotos(location.photos);
            if (photos.length >= MAX_PHOTOS_PER_POSTCARD) {
                return { status: 400, jsonBody: { error: `A postcard can have at most ${MAX_PHOTOS_PER_POSTCARD} photos` } };
            }

            const photoId = crypto.randomBytes(8).toString('hex');
            const container = getPhotoContainer();
            await container.createIfNotExists();
            const opts = { blobHTTPHeaders: { blobContentType: 'image/jpeg' } };
            await container.getBlockBlobClient(blobName(id, photoId, false)).uploadData(image.buf, opts);
            await container.getBlockBlobClient(blobName(id, photoId, true)).uploadData(thumb.buf, opts);

            await getTable('locations').updateEntity(
                { partitionKey: 'location', rowKey: id, photos: JSON.stringify([...photos, photoId]) },
                'Merge'
            );

            return { status: 201, jsonBody: { id: photoId } };
        } catch (err) {
            context.log('Error adding photo:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to save photo' } };
        }
    }
});

// ── GET /api/photos/{id}/{photoId}?size=thumb ───────────────────────────────
// Public. Photos are immutable, so they are cached aggressively.
app.http('getPhoto', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'photos/{id}/{photoId}',
    handler: async (request, context) => {
        const { id, photoId } = request.params;
        if (!ID_RE.test(id) || !ID_RE.test(photoId)) return { status: 400, jsonBody: { error: 'Invalid id' } };

        try {
            const thumb = request.query.get('size') === 'thumb';
            const data = await getPhotoContainer().getBlockBlobClient(blobName(id, photoId, thumb)).downloadToBuffer();
            return {
                status: 200,
                body: data,
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable'
                }
            };
        } catch (err) {
            if (err.statusCode === 404) return { status: 404, jsonBody: { error: 'Photo not found' } };
            context.log('Error fetching photo:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to load photo' } };
        }
    }
});

// ── DELETE /api/locations/{id}/photos/{photoId} ─────────────────────────────
app.http('deletePhoto', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'locations/{id}/photos/{photoId}',
    handler: async (request, context) => {
        const { id, photoId } = request.params;
        if (!ID_RE.test(id) || !ID_RE.test(photoId)) return { status: 400, jsonBody: { error: 'Invalid id' } };

        try {
            if (!await authorize(request, STAFF)) return unauthorized;

            const location = await getLocation(id);
            if (!location) return { status: 404, jsonBody: { error: 'Postcard not found' } };

            const photos = parsePhotos(location.photos);
            if (!photos.includes(photoId)) return { status: 404, jsonBody: { error: 'Photo not found' } };

            await getTable('locations').updateEntity(
                { partitionKey: 'location', rowKey: id, photos: JSON.stringify(photos.filter(p => p !== photoId)) },
                'Merge'
            );
            const container = getPhotoContainer();
            await container.deleteBlob(blobName(id, photoId, false)).catch(() => {});
            await container.deleteBlob(blobName(id, photoId, true)).catch(() => {});

            return { status: 200, jsonBody: { message: 'Photo deleted' } };
        } catch (err) {
            context.log('Error deleting photo:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to delete photo' } };
        }
    }
});
