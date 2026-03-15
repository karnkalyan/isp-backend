// src/controllers/nas.controller.js
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

// Create a new NAS
async function createNas(req, res, next) {
    try {
        const data = {
            nasname: req.body.nasname,
            shortname: req.body.shortname,
            type: req.body.type || 'other',
            ports: req.body.ports ? String(req.body.ports) : null,
            secret: req.body.secret,
            server: req.body.server,
            community: req.body.community,
            description: req.body.description,
            isActive: req.body.isActive ?? true,
            isDeleted: false,
            isDefault: req.body.isDefault ?? false,
            ispId: req.ispId ? Number(req.ispId) : null,
            branchId: req.user?.branchId ? Number(req.user.branchId) : null
        };

        // If this one is set as default, we must unset the previously default NAS
        if (data.isDefault && data.ispId) {
            await req.prisma.nas.updateMany({
                where: { ispId: data.ispId, isDefault: true, isDeleted: false },
                data: { isDefault: false }
            });
        }

        // Create in local DB
        const nas = await req.prisma.nas.create({ data });

        // Sync with Radius service
        try {
            const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, data.ispId);
            await client.createNas({
                nasname: data.nasname,
                shortname: data.shortname,
                type: data.type,
                ports: data.ports,
                secret: data.secret,
                server: data.server,
                community: data.community,
                description: data.description
            });
        } catch (radiusError) {
            console.error('Failed to sync NAS with radius:', radiusError);
            // We could consider rolling back the db creation here, but we will leave it
            // as syncing can be retried.
        }

        return res.status(201).json(nas);
    } catch (err) {
        return next(err);
    }
}

// Get all (non-deleted) NAS
async function listNas(req, res, next) {
    try {
        const list = await req.prisma.nas.findMany({
            where: {
                isDeleted: false,
                ispId: req.ispId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        return res.json(list);
    } catch (err) {
        return next(err);
    }
}

// Get a single NAS by ID
async function getNasById(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const nas = await req.prisma.nas.findUnique({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!nas) {
            return res.status(404).json({ error: 'NAS not found' });
        }
        return res.json(nas);
    } catch (err) {
        return next(err);
    }
}

// Update a NAS
async function updateNas(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const existingNas = await req.prisma.nas.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!existingNas) {
            return res.status(404).json({ error: 'NAS not found' });
        }

        const data = {
            nasname: req.body.nasname,
            shortname: req.body.shortname,
            type: req.body.type,
            ports: req.body.ports ? String(req.body.ports) : undefined,
            secret: req.body.secret,
            server: req.body.server,
            community: req.body.community,
            description: req.body.description,
            isActive: req.body.isActive,
            isDefault: req.body.isDefault,
        };

        const updateData = Object.fromEntries(
            Object.entries(data).filter(([_, value]) => value !== undefined)
        );

        // If we are updating to make it default, unset any existing ones
        if (updateData.isDefault && existingNas.ispId) {
            await req.prisma.nas.updateMany({
                where: { ispId: existingNas.ispId, isDefault: true, isDeleted: false, NOT: { id } },
                data: { isDefault: false }
            });
        }

        const updated = await req.prisma.nas.update({
            where: { id },
            data: updateData
        });

        // Sync with Radius service
        try {
            const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
            await client.updateNas(existingNas.id, {
                nasname: updated.nasname,
                shortname: updated.shortname,
                type: updated.type,
                ports: updated.ports,
                secret: updated.secret,
                server: updated.server,
                community: updated.community,
                description: updated.description
            });
        } catch (radiusError) {
            console.error('Failed to sync updated NAS with radius:', radiusError);
        }

        return res.json(updated);
    } catch (err) {
        return next(err);
    }
}

// Soft-delete a NAS
async function deleteNas(req, res, next) {
    try {
        const id = Number(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

        const existingNas = await req.prisma.nas.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!existingNas) {
            return res.status(404).json({ error: 'NAS not found' });
        }

        const softDeleted = await req.prisma.nas.update({
            where: { id },
            data: { isDeleted: true }
        });

        // Delete from Radius service
        try {
            const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
            await client.deleteNas(existingNas.id);
        } catch (radiusError) {
            console.error(`Failed to delete NAS ${existingNas.id} from radius:`, radiusError);
            // Proceed even if radius deletion fails
        }

        return res.json({ message: 'NAS deleted', id: softDeleted.id });
    } catch (err) {
        return next(err);
    }
}

// Resync controller to perform 2-way sync between local DB and Radius server
async function resyncNas(req, res, next) {
    try {
        const client = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
        const radiusNasList = await client.getNas();
        if (!Array.isArray(radiusNasList)) {
            return res.status(500).json({ error: 'Invalid response from radius server' });
        }

        const localNasList = await req.prisma.nas.findMany({
            where: {
                isDeleted: false,
                ispId: req.ispId
            }
        });

        // 1. Sync from Radius to Local DB
        let radiusAddedOrUpdated = 0;
        for (const rNas of radiusNasList) {
            // Check if it exists locally by nasname (which should be unique)
            const localNas = localNasList.find(n => n.nasname === rNas.nasname);

            if (localNas) {
                // Update local if necessary (we assume radius is source of truth for these properties)
                await req.prisma.nas.update({
                    where: { id: localNas.id },
                    data: {
                        shortname: rNas.shortname,
                        type: rNas.type,
                        ports: rNas.ports ? String(rNas.ports) : null,
                        secret: rNas.secret,
                        server: rNas.server,
                        community: rNas.community,
                        description: rNas.description
                    }
                });
                radiusAddedOrUpdated++;
            } else {
                // Create locally if missing
                const newLocalNas = await req.prisma.nas.create({
                    data: {
                        nasname: rNas.nasname,
                        shortname: rNas.shortname,
                        type: rNas.type,
                        ports: rNas.ports ? String(rNas.ports) : null,
                        secret: rNas.secret,
                        server: rNas.server,
                        community: rNas.community,
                        description: rNas.description,
                        isDeleted: false,
                        ispId: req.ispId
                    }
                });
                // Add to our local list so we don't try to sync it back to radius in step 2
                localNasList.push(newLocalNas);
                radiusAddedOrUpdated++;
            }
        }

        // 2. Sync from Local DB to Radius
        let localPushedToRadius = 0;
        for (const localNas of localNasList) {
            // Check if this local NAS exists in Radius
            const existsInRadius = radiusNasList.some(r => r.nasname === localNas.nasname);

            if (!existsInRadius) {
                // Attempt to create it in Radius
                try {
                    await client.createNas({
                        nasname: localNas.nasname,
                        shortname: localNas.shortname,
                        type: localNas.type,
                        ports: localNas.ports,
                        secret: localNas.secret,
                        server: localNas.server,
                        community: localNas.community,
                        description: localNas.description
                    });
                    localPushedToRadius++;
                } catch (radiusError) {
                    console.error(`Failed to push local NAS '${localNas.nasname}' to radius during sync:`, radiusError);
                }
            }
        }

        return res.json({
            message: '2-way NAS sync complete',
            stats: {
                syncedFromRadiusToLocal: radiusAddedOrUpdated,
                syncedFromLocalToRadius: localPushedToRadius
            }
        });
    } catch (err) {
        return next(err);
    }
}

module.exports = {
    createNas,
    listNas,
    getNasById,
    updateNas,
    deleteNas,
    resyncNas
};
