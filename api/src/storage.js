const { TableClient, odata } = require('@azure/data-tables');
const { BlobServiceClient } = require('@azure/storage-blob');

const PHOTO_CONTAINER = 'photos';

function connectionString() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    return connStr;
}

function getTable(name) {
    return TableClient.fromConnectionString(connectionString(), name);
}

function getPhotoContainer() {
    return BlobServiceClient.fromConnectionString(connectionString()).getContainerClient(PHOTO_CONTAINER);
}

function parsePhotos(value) {
    try {
        const list = JSON.parse(value || '[]');
        return Array.isArray(list) ? list.filter(p => typeof p === 'string') : [];
    } catch {
        return [];
    }
}

// Best-effort removal of a postcard's comments and photos.
async function deleteLocationData(locationId) {
    try {
        const comments = getTable('comments');
        for await (const c of comments.listEntities({ queryOptions: { filter: odata`PartitionKey eq ${locationId}` } })) {
            await comments.deleteEntity(c.partitionKey, c.rowKey);
        }
    } catch { /* no comments table yet */ }
    try {
        const container = getPhotoContainer();
        for await (const blob of container.listBlobsFlat({ prefix: `${locationId}/` })) {
            await container.deleteBlob(blob.name);
        }
    } catch { /* no photo container yet */ }
}

module.exports = { getTable, getPhotoContainer, parsePhotos, deleteLocationData, odata };
