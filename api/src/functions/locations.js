const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE_NAME = 'locations';
const PARTITION_KEY = 'location';

function getClient() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    return TableClient.fromConnectionString(connStr, TABLE_NAME);
}

const { authorize } = require('../auth');

// admin: add + delete locations (and manage users); edit: add locations only.
async function isAuthorized(request, roles) {
    try {
        return !!(await authorize(request, roles));
    } catch {
        return false;
    }
}

// ── GET /api/locations  ─────────────────────────────────────────────────────
// Returns all locations sorted by visit date descending.
app.http('getLocations', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'locations',
    handler: async (request, context) => {
        try {
            const client = getClient();
            const locations = [];

            for await (const entity of client.listEntities()) {
                locations.push({
                    id: entity.rowKey,
                    name: entity.name,
                    latitude: Number(entity.latitude),
                    longitude: Number(entity.longitude),
                    visitDate: entity.visitDate,
                    message: entity.message || '',
                    sentBy: entity.sentBy || '',
                    photoUrl: entity.photoUrl || ''
                });
            }

            locations.sort((a, b) => {
                if (!a.visitDate) return 1;
                if (!b.visitDate) return -1;
                return b.visitDate.localeCompare(a.visitDate);
            });

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                jsonBody: locations
            };
        } catch (err) {
            context.log('Error fetching locations:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to retrieve locations' } };
        }
    }
});

// Validates a POST/PUT body. Returns { error } or { fields, body }.
async function parseLocation(request) {
    let body;
    try {
        body = await request.json();
    } catch {
        return { error: 'Invalid JSON body' };
    }

    const { name, latitude, longitude, visitDate, message, sentBy } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
        return { error: 'name is required' };
    }
    if (!visitDate || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
        return { error: 'visitDate is required (YYYY-MM-DD)' };
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { error: 'Valid latitude and longitude are required' };
    }

    return {
        body,
        fields: {
            name: name.trim(),
            latitude: lat,
            longitude: lng,
            visitDate,
            message: String(message || '').trim(),
            sentBy: (typeof sentBy === 'string' ? sentBy : '').trim().slice(0, 100)
        }
    };
}

// ── POST /api/locations  ────────────────────────────────────────────────────
// Adds a new location. Requires an admin or edit user (x-auth-token header).
app.http('addLocation', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'locations',
    handler: async (request, context) => {
        if (!await isAuthorized(request, ['admin', 'edit'])) {
            return { status: 401, jsonBody: { error: 'Unauthorized' } };
        }

        const parsed = await parseLocation(request);
        if (parsed.error) return { status: 400, jsonBody: { error: parsed.error } };
        const { fields } = parsed;

        try {
            const client = getClient();
            // Ensure table exists
            try { await client.createTable(); } catch { /* already exists */ }

            const rowKey = `${fields.visitDate}_${Date.now()}`;

            await client.createEntity({
                partitionKey: PARTITION_KEY,
                rowKey,
                ...fields,
                photoUrl: String(parsed.body.photoUrl || '').trim()
            });

            context.log(`Added location: ${fields.name} on ${fields.visitDate}`);

            return {
                status: 201,
                jsonBody: { id: rowKey, message: 'Location added successfully' }
            };
        } catch (err) {
            context.log('Error adding location:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to save location' } };
        }
    }
});

// ── PUT /api/locations/{id}  ────────────────────────────────────────────────
// Edits a location. Requires an admin or edit user (x-auth-token header).
app.http('updateLocation', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'locations/{id}',
    handler: async (request, context) => {
        if (!await isAuthorized(request, ['admin', 'edit'])) {
            return { status: 401, jsonBody: { error: 'Unauthorized' } };
        }

        const id = request.params.id;
        if (!id) return { status: 400, jsonBody: { error: 'id is required' } };

        const parsed = await parseLocation(request);
        if (parsed.error) return { status: 400, jsonBody: { error: parsed.error } };

        try {
            // Merge keeps fields the form doesn't send (e.g. photoUrl)
            await getClient().updateEntity(
                { partitionKey: PARTITION_KEY, rowKey: id, ...parsed.fields },
                'Merge'
            );
            context.log(`Updated location: ${id}`);
            return { status: 200, jsonBody: { message: 'Location updated' } };
        } catch (err) {
            if (err.statusCode === 404) {
                return { status: 404, jsonBody: { error: 'Location not found' } };
            }
            context.log('Error updating location:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to update location' } };
        }
    }
});

// ── DELETE /api/locations/{id}  ─────────────────────────────────────────────
// Removes a location by ID. Requires an admin user (x-auth-token header).
app.http('deleteLocation', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'locations/{id}',
    handler: async (request, context) => {
        if (!await isAuthorized(request, ['admin'])) {
            return { status: 401, jsonBody: { error: 'Unauthorized' } };
        }

        const id = request.params.id;
        if (!id) {
            return { status: 400, jsonBody: { error: 'id is required' } };
        }

        try {
            const client = getClient();
            await client.deleteEntity(PARTITION_KEY, id);
            context.log(`Deleted location: ${id}`);
            return { status: 200, jsonBody: { message: 'Location deleted' } };
        } catch (err) {
            if (err.statusCode === 404) {
                return { status: 404, jsonBody: { error: 'Location not found' } };
            }
            context.log('Error deleting location:', err.message);
            return { status: 500, jsonBody: { error: 'Failed to delete location' } };
        }
    }
});
