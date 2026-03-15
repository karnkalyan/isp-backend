const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');


// ================= CREATE NAS =================
async function createNas(req, res, next) {
    try {

        const data = {
            nasname: req.body.nasname,
            shortname: req.body.shortname,
            type: req.body.type || "other",
            ports: req.body.ports ? String(req.body.ports) : null,
            secret: req.body.secret,
            server: req.body.server,
            community: req.body.community,
            description: req.body.description,
            isActive: req.body.isActive ?? true,
            isDeleted: false,
            isDefault: req.body.isDefault ?? false,
            ispId: req.ispId,
            branchId: req.user?.branchId
        };

        const nas = await req.prisma.nas.create({ data });

        try {

            const client = await ServiceFactory.getClient(
                SERVICE_CODES.RADIUS,
                req.ispId
            );

            const radiusNas = await client.createNas({
                nasname: nas.nasname,
                shortname: nas.shortname,
                type: nas.type,
                ports: nas.ports,
                secret: nas.secret,
                server: nas.server,
                community: nas.community,
                description: nas.description
            });

            await req.prisma.nas.update({
                where: { id: nas.id },
                data: { radiusNasId: radiusNas.id }
            });

        } catch (err) {
            console.error("Radius create failed:", err);
        }

        res.status(201).json(nas);

    } catch (err) {
        next(err);
    }
}



// ================= LIST NAS =================
async function listNas(req, res, next) {

    try {

        const list = await req.prisma.nas.findMany({
            where: {
                ispId: req.ispId,
                isDeleted: false
            },
            orderBy: { createdAt: "desc" }
        });

        res.json(list);

    } catch (err) {
        next(err);
    }

}



// ================= GET NAS =================
async function getNasById(req, res, next) {

    try {

        const id = Number(req.params.id);

        const nas = await req.prisma.nas.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!nas) {
            return res.status(404).json({ error: "NAS not found" });
        }

        res.json(nas);

    } catch (err) {
        next(err);
    }

}



// ================= UPDATE NAS =================
async function updateNas(req, res, next) {

    try {

        const id = Number(req.params.id);

        const existing = await req.prisma.nas.findFirst({
            where: {
                id,
                ispId: req.ispId,
                isDeleted: false
            }
        });

        if (!existing) {
            return res.status(404).json({ error: "NAS not found" });
        }

        const updateData = {
            nasname: req.body.nasname,
            shortname: req.body.shortname,
            type: req.body.type,
            ports: req.body.ports ? String(req.body.ports) : undefined,
            secret: req.body.secret,
            server: req.body.server,
            community: req.body.community,
            description: req.body.description,
            isActive: req.body.isActive
        };

        const updated = await req.prisma.nas.update({
            where: { id },
            data: Object.fromEntries(
                Object.entries(updateData).filter(([_, v]) => v !== undefined)
            )
        });

        if (existing.radiusNasId) {

            try {

                const client = await ServiceFactory.getClient(
                    SERVICE_CODES.RADIUS,
                    req.ispId
                );

                await client.updateNas(existing.radiusNasId, {
                    nasname: updated.nasname,
                    shortname: updated.shortname,
                    type: updated.type,
                    ports: updated.ports,
                    secret: updated.secret,
                    server: updated.server,
                    community: updated.community,
                    description: updated.description
                });

            } catch (err) {
                console.error("Radius update failed:", err);
            }

        }

        res.json(updated);

    } catch (err) {
        next(err);
    }

}



// ================= DELETE NAS =================
async function deleteNas(req, res, next) {

    try {

        const id = Number(req.params.id);

        const nas = await req.prisma.nas.findFirst({
            where: {
                id,
                ispId: req.ispId
            }
        });

        if (!nas) {
            return res.status(404).json({ error: "NAS not found" });
        }

        await req.prisma.nas.update({
            where: { id },
            data: { isDeleted: true }
        });

        if (nas.radiusNasId) {

            try {

                const client = await ServiceFactory.getClient(
                    SERVICE_CODES.RADIUS,
                    req.ispId
                );

                await client.deleteNas(nas.radiusNasId);

            } catch (err) {
                console.error("Radius delete failed:", err);
            }

        }

        res.json({ message: "NAS deleted", id });

    } catch (err) {
        next(err);
    }

}



// ================= RESYNC NAS =================
async function resyncNas(req, res, next) {
    try {

        const client = await ServiceFactory.getClient(
            SERVICE_CODES.RADIUS,
            req.ispId
        );

        const radiusList = await client.getNas();

        const localList = await req.prisma.nas.findMany({
            where: { ispId: req.ispId }
        });

        let createdLocal = 0;
        let updatedLocal = 0;
        let deletedRadius = 0;
        let createdRadius = 0;

        // ================= RADIUS → LOCAL =================
        for (const r of radiusList) {

            const local = localList.find(n => n.radiusNasId === r.id);

            if (local) {

                // If local is deleted → remove from Radius
                if (local.isDeleted) {

                    await client.deleteNas(r.id);
                    deletedRadius++;

                    continue;
                }

                await req.prisma.nas.update({
                    where: { id: local.id },
                    data: {
                        nasname: r.nasname,
                        shortname: r.shortname,
                        type: r.type,
                        ports: r.ports ? String(r.ports) : null,
                        secret: r.secret,
                        server: r.server,
                        community: r.community,
                        description: r.description
                    }
                });

                updatedLocal++;

            } else {

                // Create locally if missing
                await req.prisma.nas.create({
                    data: {
                        nasname: r.nasname,
                        shortname: r.shortname,
                        type: r.type,
                        ports: r.ports ? String(r.ports) : null,
                        secret: r.secret,
                        server: r.server,
                        community: r.community,
                        description: r.description,
                        radiusNasId: r.id,
                        ispId: req.ispId
                    }
                });

                createdLocal++;
            }

        }

        // ================= LOCAL → RADIUS =================
        for (const local of localList) {

            if (local.isDeleted) continue;

            const exists = radiusList.some(r => r.id === local.radiusNasId);

            if (!exists) {

                const radiusNas = await client.createNas({
                    nasname: local.nasname,
                    shortname: local.shortname,
                    type: local.type,
                    ports: local.ports,
                    secret: local.secret,
                    server: local.server,
                    community: local.community,
                    description: local.description
                });

                await req.prisma.nas.update({
                    where: { id: local.id },
                    data: { radiusNasId: radiusNas.id }
                });

                createdRadius++;
            }

        }

        res.json({
            message: "NAS resync completed",
            stats: {
                createdLocal,
                updatedLocal,
                deletedRadius,
                createdRadius
            }
        });

    } catch (err) {
        next(err);
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