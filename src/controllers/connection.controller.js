// src/controllers/connectionController.js

// Create a new connection type
async function createConnection(req, res, next) {
    try {
        // Directly use req.body fields as per the Prisma model
        const data = {
            name: req.body.name, // Assuming frontend sends 'name' directly
            code: req.body.code,
            iconUrl: req.body.iconUrl,
            isExtra: req.body.isExtra ?? false, // Use direct field, provide default
            description: req.body.description,
            isActive: req.body.isActive ?? true, // Use direct field, provide default
            isDeleted: false, // Always false for creation
            ispId: req.ispId ? Number(req.ispId) : null,
        };

        const connectionType = await req.prisma.ConnectionType.create({ data });
        return res.status(201).json(connectionType);
    } catch (err) {
        return next(err);
    }
}

// Get all (non-deleted) connection types
async function listConnections(req, res, next) {
    try {
        // Removed explicit select to return all fields by default
        const list = await req.prisma.ConnectionType.findMany({
            where: { isDeleted: false, ispId: req.ispId },
        });
        return res.json(list);
    } catch (err) {
        return next(err);
    }
}

// Get a single connection type by ID
async function getConnectionById(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Removed explicit select to return all fields by default
        const connectionType = await req.prisma.ConnectionType.findUnique({
            where: { id ,
                ispId: req.ispId, // Ensure the connection type belongs to the authenticated ISP
                isDeleted: false // Only fetch non-deleted connection types
            },
        });

        if (!connectionType || connectionType.isDeleted) {
            return res.status(404).json({ error: 'Connection type not found' });
        }
        return res.json(connectionType);
    } catch (err) {
        return next(err);
    }
}

// Update a connection type
async function updateConnection(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // Directly use req.body fields.
        // Only include fields that might be updated. Prisma will ignore undefined ones.
        const data = {
            name: req.body.name,
            code: req.body.code,
            iconUrl: req.body.iconUrl,
            isExtra: req.body.isExtra, // Allow null/undefined if not provided for partial update
            description: req.body.description,
            isActive: req.body.isActive, // Allow null/undefined for partial update
            ispId: req.ispId ? Number(req.ispId) : null,
            // isDeleted: req.body.isDeleted // Usually handled by a specific delete endpoint, not generic update
        };

        // Filter out undefined values to only update provided fields
        const updateData = Object.fromEntries(
            Object.entries(data).filter(([_, value]) => value !== undefined)
        );

        const updated = await req.prisma.ConnectionType.update({
            where: { id },
            data: updateData // Use filtered data
        });
        return res.json(updated);
    } catch (err) {
        return next(err);
    }
}

// Soft-delete a connection type
async function deleteConnection(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        // No changes needed here, as it's a specific update for isDeleted
        const softDeleted = await req.prisma.ConnectionType.update({
            where: { id },
            data: { isDeleted: true }
        });
        return res.json({ message: 'Connection type deleted', id: softDeleted.id });
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    createConnection,
    listConnections,
    getConnectionById,
    updateConnection,
    deleteConnection
};