const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

const TABLE_NAME = 'locations';
const PARTITION_KEY = 'location';

function getClient() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    return TableClient.fromConnectionString(connStr, TABLE_NAME);
}

function isAuthorized(request) {
    const adminKey = process.env.ADMIN_KEY;
    const provided = request.headers.get('x-admin-key');
    return adminKey && provided === adminKey;
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
                    country: entity.country || '',
                    latitude: Number(entity.latitude),
                    longitude: Number(entity.longitude),
                    visitDate: entity.visitDate,
                    message: entity.message || '',
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

// ── POST /api/locations  ────────────────────────────────────────────────────
// Adds a new location. Requires x-admin-key header.
app.http('addLocation', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'locations',
    handler: async (request, context) => {
        if (!isAuthorized(request)) {
            return { status: 401, jsonBody: { error: 'Unauthorized' } };
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, jsonBody: { error: 'Invalid JSON body' } };
        }

        const { name, country, latitude, longitude, visitDate, message, photoUrl } = body;

        if (!name || typeof name !== 'string' || name.trim() === '') {
            return { status: 400, jsonBody: { error: 'name is required' } };
        }
        if (!visitDate || !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
            return { status: 400, jsonBody: { error: 'visitDate is required (YYYY-MM-DD)' } };
        }

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return { status: 400, jsonBody: { error: 'Valid latitude and longitude are required' } };
        }

        try {
            const client = getClient();
            // Ensure table exists
            try { await client.createTable(); } catch { /* already exists */ }

            const rowKey = `${visitDate}_${Date.now()}`;

            await client.createEntity({
                partitionKey: PARTITION_KEY,
                rowKey,
                name: name.trim(),
                country: (country || '').trim(),
                latitude: lat,
                longitude: lng,
                visitDate,
                message: (message || '').trim(),
                photoUrl: (photoUrl || '').trim()
            });

            context.log(`Added location: ${name.trim()} on ${visitDate}`);

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

// ── DELETE /api/locations/{id}  ─────────────────────────────────────────────
// Removes a location by ID. Requires x-admin-key header.
app.http('deleteLocation', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'locations/{id}',
    handler: async (request, context) => {
        if (!isAuthorized(request)) {
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
