const { logAudit } = require('../utils/auditLogger');

/**
 * Get all bulk inventory items
 */
async function getBulkInventory(req, res, next) {
    try {
        const ispId = req.ispId;
        const { search } = req.query;

        const where = {
            ispId,
            ...(search ? {
                name: { contains: search, mode: 'insensitive' }
            } : {})
        };

        const inventory = await req.prisma.bulkInventory.findMany({
            where,
            orderBy: { name: 'asc' }
        });

        res.json(inventory);
    } catch (err) {
        next(err);
    }
}

/**
 * Create a new bulk inventory item
 */
async function createBulkInventory(req, res, next) {
    try {
        const ispId = req.ispId;
        const { name, unit, totalQuantity } = req.body;

        if (!name || !unit || totalQuantity === undefined || totalQuantity < 0) {
            return res.status(400).json({ error: 'Name, unit, and non-negative total quantity are required.' });
        }

        const qty = parseFloat(totalQuantity);

        const newItem = await req.prisma.bulkInventory.create({
            data: {
                name,
                unit,
                totalQuantity: qty,
                availableQuantity: qty,
                assignedQuantity: 0,
                usedQuantity: 0,
                ispId
            }
        });

        await logAudit(req.prisma, req.user?.id, 'BULK_INVENTORY_CREATE', { id: newItem.id, name: newItem.name, totalQuantity: qty }, req);

        res.status(201).json(newItem);
    } catch (err) {
        next(err);
    }
}

/**
 * Update bulk inventory item
 */
async function updateBulkInventory(req, res, next) {
    try {
        const { id } = req.params;
        const { name, unit, totalQuantity } = req.body;

        const item = await req.prisma.bulkInventory.findUnique({
            where: { id: parseInt(id) }
        });

        if (!item) {
            return res.status(404).json({ error: 'Bulk inventory item not found.' });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (unit !== undefined) updateData.unit = unit;

        if (totalQuantity !== undefined) {
            const qty = parseFloat(totalQuantity);
            if (qty < 0) {
                return res.status(400).json({ error: 'Total quantity cannot be negative.' });
            }
            // New available quantity would be: totalQuantity - assignedQuantity - usedQuantity
            const newAvailable = qty - item.assignedQuantity - item.usedQuantity;
            if (newAvailable < 0) {
                return res.status(400).json({
                    error: `Cannot reduce total quantity to ${qty}. Active assigned (${item.assignedQuantity}) and used (${item.usedQuantity}) exceed this amount.`
                });
            }
            updateData.totalQuantity = qty;
            updateData.availableQuantity = newAvailable;
        }

        const updatedItem = await req.prisma.bulkInventory.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        await logAudit(req.prisma, req.user?.id, 'BULK_INVENTORY_UPDATE', { id: updatedItem.id, updates: updateData }, req);

        res.json(updatedItem);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete a bulk inventory item
 */
async function deleteBulkInventory(req, res, next) {
    try {
        const { id } = req.params;

        const item = await req.prisma.bulkInventory.findUnique({
            where: { id: parseInt(id) },
            include: {
                assignments: {
                    where: { status: { in: ['ASSIGNED', 'USED'] } }
                }
            }
        });

        if (!item) {
            return res.status(404).json({ error: 'Bulk inventory item not found.' });
        }

        if (item.assignments.length > 0) {
            return res.status(400).json({ error: 'Cannot delete inventory item with active or completed assignments. Return or scrap first.' });
        }

        await req.prisma.bulkInventory.delete({
            where: { id: parseInt(id) }
        });

        await logAudit(req.prisma, req.user?.id, 'BULK_INVENTORY_DELETE', { id, name: item.name }, req);

        res.json({ message: 'Bulk inventory item deleted successfully.' });
    } catch (err) {
        next(err);
    }
}

/**
 * Get all inventory assignments
 */
async function getAssignments(req, res, next) {
    try {
        const { bulkInventoryId, branchId, subBranchId, userId, status } = req.query;
        const ispId = req.ispId;

        const where = {
            bulkInventory: { ispId },
            ...(bulkInventoryId ? { bulkInventoryId: parseInt(bulkInventoryId) } : {}),
            ...(branchId ? { branchId: parseInt(branchId) } : {}),
            ...(subBranchId ? { subBranchId: parseInt(subBranchId) } : {}),
            ...(userId ? { userId: parseInt(userId) } : {}),
            ...(status ? { status } : {})
        };

        const assignments = await req.prisma.bulkInventoryAssignment.findMany({
            where,
            include: {
                bulkInventory: true,
                branch: { select: { id: true, name: true } },
                subBranch: { select: { id: true, name: true } },
                user: { select: { id: true, name: true, email: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(assignments);
    } catch (err) {
        next(err);
    }
}

async function getMyAssignments(req, res, next) {
    try {
        const assignments = await req.prisma.bulkInventoryAssignment.findMany({
            where: { userId: req.user.id, bulkInventory: { ispId: req.ispId } },
            include: { bulkInventory: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(assignments);
    } catch (err) {
        next(err);
    }
}

/**
 * Assign inventory to user, branch, or sub-branch
 */
async function assignInventory(req, res, next) {
    try {
        const { bulkInventoryId, quantity, branchId, subBranchId, userId, remarks } = req.body;

        if (!bulkInventoryId || quantity === undefined || parseFloat(quantity) <= 0) {
            return res.status(400).json({ error: 'Bulk inventory ID and positive quantity are required.' });
        }

        if (!branchId && !subBranchId && !userId) {
            return res.status(400).json({ error: 'Must assign to either a Branch, Sub-branch, or User.' });
        }

        const qty = parseFloat(quantity);

        const result = await req.prisma.$transaction(async (tx) => {
            const item = await tx.bulkInventory.findUnique({
                where: { id: parseInt(bulkInventoryId) }
            });

            if (!item) {
                throw new Error('Bulk inventory item not found.');
            }

            if (item.availableQuantity < qty) {
                throw new Error(`Insufficient stock. Available: ${item.availableQuantity} ${item.unit}, requested: ${qty}`);
            }

            // Update item counts
            const updatedItem = await tx.bulkInventory.update({
                where: { id: item.id },
                data: {
                    availableQuantity: item.availableQuantity - qty,
                    assignedQuantity: item.assignedQuantity + qty
                }
            });

            // Create assignment record
            const assignment = await tx.bulkInventoryAssignment.create({
                data: {
                    bulkInventoryId: item.id,
                    quantity: qty,
                    branchId: branchId ? parseInt(branchId) : null,
                    subBranchId: subBranchId ? parseInt(subBranchId) : null,
                    userId: userId ? parseInt(userId) : null,
                    status: 'ASSIGNED',
                    remarks,
                    date: new Date()
                },
                include: {
                    bulkInventory: true,
                    branch: { select: { name: true } },
                    subBranch: { select: { name: true } },
                    user: { select: { name: true } }
                }
            });

            return { assignment, updatedItem };
        });

        await logAudit(req.prisma, req.user?.id, 'BULK_INVENTORY_ASSIGN', {
            id: result.assignment.id,
            bulkInventoryId,
            quantity: qty,
            branchId,
            subBranchId,
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
 * Update status of an assignment (USED or RETURNED)
 */
async function updateAssignmentStatus(req, res, next) {
    try {
        const { id } = req.params;
        const { status } = req.body; // USED or RETURNED

        if (!['USED', 'RETURNED'].includes(status)) {
            return res.status(400).json({ error: 'Status must be USED or RETURNED.' });
        }

        const result = await req.prisma.$transaction(async (tx) => {
            const assignment = await tx.bulkInventoryAssignment.findUnique({
                where: { id: parseInt(id) },
                include: { bulkInventory: true }
            });

            if (!assignment) {
                throw new Error('Assignment not found.');
            }

            if (assignment.status !== 'ASSIGNED') {
                throw new Error(`Assignment status is already ${assignment.status} and cannot be changed.`);
            }

            const item = assignment.bulkInventory;
            const qty = assignment.quantity;

            let updatedItem;
            if (status === 'USED') {
                // ASSIGNED -> USED
                updatedItem = await tx.bulkInventory.update({
                    where: { id: item.id },
                    data: {
                        assignedQuantity: item.assignedQuantity - qty,
                        usedQuantity: item.usedQuantity + qty
                    }
                });
            } else {
                // ASSIGNED -> RETURNED
                updatedItem = await tx.bulkInventory.update({
                    where: { id: item.id },
                    data: {
                        assignedQuantity: item.assignedQuantity - qty,
                        availableQuantity: item.availableQuantity + qty
                    }
                });
            }

            const updatedAssignment = await tx.bulkInventoryAssignment.update({
                where: { id: assignment.id },
                data: { status }
            });

            return { assignment: updatedAssignment, updatedItem };
        });

        await logAudit(req.prisma, req.user?.id, 'BULK_INVENTORY_ASSIGNMENT_UPDATE', {
            id,
            status,
            quantity: result.assignment.quantity,
            bulkInventoryId: result.assignment.bulkInventoryId
        }, req);

        res.json(result);
    } catch (err) {
        if (err.message.includes('not found') || err.message.includes('already')) {
            return res.status(400).json({ error: err.message });
        }
        next(err);
    }
}

module.exports = {
    getBulkInventory,
    createBulkInventory,
    updateBulkInventory,
    deleteBulkInventory,
    getAssignments,
    assignInventory,
    updateAssignmentStatus,
    getMyAssignments
};
