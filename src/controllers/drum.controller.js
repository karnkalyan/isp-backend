const { logAudit } = require('../utils/auditLogger');

/**
 * Get all drums
 */
async function getDrums(req, res, next) {
    try {
        const { search, status } = req.query;

        const where = {
            ...(status ? { status } : {}),
            ...(search ? {
                OR: [
                    { serialNumber: { contains: search, mode: 'insensitive' } },
                    { drumType: { contains: search, mode: 'insensitive' } },
                    { fiberType: { contains: search, mode: 'insensitive' } }
                ]
            } : {})
        };

        const drums = await req.prisma.drum.findMany({
            where,
            include: { vendor: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' }
        });

        res.json(drums);
    } catch (err) {
        next(err);
    }
}

/**
 * Get single drum details including assignments
 */
async function getDrumById(req, res, next) {
    try {
        const { id } = req.params;

        const drum = await req.prisma.drum.findUnique({
            where: { id: parseInt(id) },
            include: {
                vendor: { select: { id: true, name: true } },
                assignments: {
                    include: {
                        branch: { select: { id: true, name: true } },
                        user: { select: { id: true, name: true, email: true } }
                    },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!drum) {
            return res.status(404).json({ error: 'Drum not found.' });
        }

        res.json(drum);
    } catch (err) {
        next(err);
    }
}

/**
 * Create a new drum
 */
async function createDrum(req, res, next) {
    try {
        const { serialNumber, drumType, fiberType, capacity, totalLength, manufacturer, purchaseDate, vendorId } = req.body;

        if (!serialNumber || !drumType || !fiberType || totalLength === undefined || parseFloat(totalLength) <= 0) {
            return res.status(400).json({ error: 'SerialNumber, drumType, fiberType, and positive totalLength are required.' });
        }

        // Check unique serial number
        const existing = await req.prisma.drum.findUnique({
            where: { serialNumber }
        });

        if (existing) {
            return res.status(400).json({ error: 'Drum with this serial number already exists.' });
        }

        const len = parseFloat(totalLength);
        const cap = capacity ? parseFloat(capacity) : len;

        const drum = await req.prisma.drum.create({
            data: {
                serialNumber,
                drumType,
                fiberType,
                capacity: cap,
                totalLength: len,
                assignedLength: 0,
                usedLength: 0,
                remainingLength: len,
                manufacturer,
                purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
                vendorId: vendorId && vendorId !== 'none' ? Number(vendorId) : null,
                status: 'IN_STOCK'
            }
        });

        await logAudit(req.prisma, req.user?.id, 'DRUM_CREATE', { id: drum.id, serialNumber: drum.serialNumber }, req);

        res.status(201).json(drum);
    } catch (err) {
        next(err);
    }
}

/**
 * Update drum details
 */
async function updateDrum(req, res, next) {
    try {
        const { id } = req.params;
        const { drumType, fiberType, capacity, totalLength, manufacturer, purchaseDate, status, vendorId } = req.body;

        const drum = await req.prisma.drum.findUnique({
            where: { id: parseInt(id) }
        });

        if (!drum) {
            return res.status(404).json({ error: 'Drum not found.' });
        }

        const updateData = {};
        if (drumType !== undefined) updateData.drumType = drumType;
        if (fiberType !== undefined) updateData.fiberType = fiberType;
        if (manufacturer !== undefined) updateData.manufacturer = manufacturer;
        if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
        if (status !== undefined) updateData.status = status;
        if (vendorId !== undefined) updateData.vendorId = vendorId === null || vendorId === '' || vendorId === 'none' ? null : Number(vendorId);

        if (totalLength !== undefined) {
            const len = parseFloat(totalLength);
            if (len < drum.assignedLength) {
                return res.status(400).json({
                    error: `Cannot reduce total length below already assigned length (${drum.assignedLength}m).`
                });
            }
            updateData.totalLength = len;
            updateData.remainingLength = len - drum.usedLength;
        }

        if (capacity !== undefined) {
            updateData.capacity = parseFloat(capacity);
        }

        const updatedDrum = await req.prisma.drum.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        await logAudit(req.prisma, req.user?.id, 'DRUM_UPDATE', { id: updatedDrum.id, updates: updateData }, req);

        res.json(updatedDrum);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete drum
 */
async function deleteDrum(req, res, next) {
    try {
        const { id } = req.params;

        const drum = await req.prisma.drum.findUnique({
            where: { id: parseInt(id) },
            include: { assignments: true }
        });

        if (!drum) {
            return res.status(404).json({ error: 'Drum not found.' });
        }

        if (drum.assignments.length > 0) {
            return res.status(400).json({ error: 'Cannot delete drum with assignment records.' });
        }

        await req.prisma.drum.delete({
            where: { id: parseInt(id) }
        });

        await logAudit(req.prisma, req.user?.id, 'DRUM_DELETE', { id, serialNumber: drum.serialNumber }, req);

        res.json({ message: 'Drum deleted successfully.' });
    } catch (err) {
        next(err);
    }
}

/**
 * Get all drum assignments
 */
async function getDrumAssignments(req, res, next) {
    try {
        const { drumId, branchId, userId } = req.query;

        const where = {
            ...(drumId ? { drumId: parseInt(drumId) } : {}),
            ...(branchId ? { branchId: parseInt(branchId) } : {}),
            ...(userId ? { userId: parseInt(userId) } : {})
        };

        const assignments = await req.prisma.drumAssignment.findMany({
            where,
            include: {
                drum: true,
                branch: { select: { id: true, name: true } },
                user: { select: { id: true, name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(assignments);
    } catch (err) {
        next(err);
    }
}

/**
 * Assign length from a drum
 */
async function assignDrum(req, res, next) {
    try {
        const { drumId, assignedLength, assignedTo, branchId, userId, location, remarks } = req.body;

        if (!drumId || assignedLength === undefined || parseFloat(assignedLength) <= 0) {
            return res.status(400).json({ error: 'Drum ID and positive assignedLength are required.' });
        }

        const lenToAssign = parseFloat(assignedLength);

        const result = await req.prisma.$transaction(async (tx) => {
            const drum = await tx.drum.findUnique({
                where: { id: parseInt(drumId) }
            });

            if (!drum) {
                throw new Error('Drum not found.');
            }

            const unassignedLength = drum.totalLength - drum.assignedLength;
            if (unassignedLength < lenToAssign) {
                throw new Error(`Insufficient unassigned length. Available unassigned: ${unassignedLength}m, requested: ${lenToAssign}m`);
            }

            // Update Drum assignedLength and status
            const updatedDrum = await tx.drum.update({
                where: { id: drum.id },
                data: {
                    assignedLength: drum.assignedLength + lenToAssign,
                    status: 'ASSIGNED'
                }
            });

            // Create assignment
            const assignment = await tx.drumAssignment.create({
                data: {
                    drumId: drum.id,
                    assignedLength: lenToAssign,
                    assignedTo: assignedTo || null,
                    usedLength: 0,
                    remainingLength: lenToAssign,
                    location,
                    branchId: branchId ? parseInt(branchId) : null,
                    userId: userId ? parseInt(userId) : null,
                    remarks,
                    assignedDate: new Date()
                },
                include: {
                    drum: true,
                    branch: { select: { name: true } },
                    user: { select: { name: true } }
                }
            });

            return { assignment, updatedDrum };
        });

        await logAudit(req.prisma, req.user?.id, 'DRUM_ASSIGN', {
            id: result.assignment.id,
            drumId,
            assignedLength: lenToAssign,
            branchId,
            userId
        }, req);

        res.status(201).json(result);
    } catch (err) {
        if (err.message.includes('Insufficient') || err.message.includes('not found')) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}

/**
 * Report fiber usage on a drum assignment
 */
async function reportUsage(req, res, next) {
    try {
        const { id } = req.params; // Assignment ID
        const { usedLength } = req.body; // Length used in this report/task

        if (usedLength === undefined || parseFloat(usedLength) <= 0) {
            return res.status(400).json({ error: 'Positive usedLength is required.' });
        }

        const lenUsed = parseFloat(usedLength);

        const result = await req.prisma.$transaction(async (tx) => {
            const assignment = await tx.drumAssignment.findUnique({
                where: { id: parseInt(id) },
                include: { drum: true }
            });

            if (!assignment) {
                throw new Error('Drum assignment not found.');
            }

            if (assignment.remainingLength < lenUsed) {
                throw new Error(`Reported usage exceeds remaining assignment length. Remaining: ${assignment.remainingLength}m`);
            }

            // Update assignment
            const updatedAssignment = await tx.drumAssignment.update({
                where: { id: assignment.id },
                data: {
                    usedLength: assignment.usedLength + lenUsed,
                    remainingLength: assignment.remainingLength - lenUsed
                }
            });

            // Update Drum
            const drum = assignment.drum;
            const newDrumUsed = drum.usedLength + lenUsed;
            const newDrumRemaining = drum.remainingLength - lenUsed;
            const isFullyUsed = newDrumRemaining <= 0.01; // handle floating precision

            const updatedDrum = await tx.drum.update({
                where: { id: drum.id },
                data: {
                    usedLength: newDrumUsed,
                    remainingLength: newDrumRemaining,
                    status: isFullyUsed ? 'USED' : drum.status
                }
            });

            return { assignment: updatedAssignment, updatedDrum };
        });

        await logAudit(req.prisma, req.user?.id, 'DRUM_USAGE_REPORT', {
            id,
            usedLength: lenUsed,
            drumId: result.assignment.drumId
        }, req);

        res.json(result);
    } catch (err) {
        if (err.message.includes('exceeds') || err.message.includes('not found')) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}

module.exports = {
    getDrums,
    getDrumById,
    createDrum,
    updateDrum,
    deleteDrum,
    getDrumAssignments,
    assignDrum,
    reportUsage
};
