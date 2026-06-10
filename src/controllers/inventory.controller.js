/**
 * Get all inventory items with filtering
 */
function normalizeInventoryType(value) {
    if (!value) return undefined;
    const normalized = String(value).trim().toUpperCase();
    const aliases = {
        ROUTER: 'ROUTE',
        ROUTE: 'ROUTE',
        ONT: 'ONT',
        OLT: 'OLT',
        DROPWIRE: 'DROPWIRE',
        DROP_WIRE: 'DROPWIRE',
        SWITCH: 'SWITCH',
        STB: 'STB',
        OTHER: 'OTHER'
    };
    return aliases[normalized] || normalized;
}

async function listInventoryItems(req, res, next) {
    try {
        const { type, status, branchId, userId, customerId, serialNumber } = req.query;
        const ispId = req.ispId;
        const normalizedType = normalizeInventoryType(type);

        const { getBranchFilter } = require('../utils/branchHelper');
        const branchFilter = await getBranchFilter(req);

        const where = {
            ispId,
            ...(normalizedType && { type: normalizedType }),
            ...(userId && { userId: Number(userId) }),
            ...(customerId && { customerId: Number(customerId) }),
            ...(serialNumber && { serialNumber: { contains: serialNumber } })
        };

        if (branchFilter?.branchId) {
            where.branchId = branchFilter.branchId;
        }

        if (branchId) {
            const requestedBranchId = Number(branchId);
            const allowedBranchIds = branchFilter?.branchId?.in;

            if (Array.isArray(allowedBranchIds) && !allowedBranchIds.includes(requestedBranchId)) {
                return res.status(403).json({ error: 'Access denied for selected branch' });
            }

            where.branchId = requestedBranchId;
        }

        const statuses = Array.isArray(status) ? status : (status ? [status] : []);
        if (statuses.includes('IN_STOCK')) {
            const otherStatuses = statuses.filter(s => s !== 'IN_STOCK');
            const orConditions = [
                { status: 'IN_STOCK' },
                { status: 'ASSIGNED_TO_BRANCH' }
            ];
            if (req.user?.roleId) {
                orConditions.push({
                    status: 'ASSIGNED_TO_ROLE',
                    assignedRoleId: Number(req.user.roleId)
                });
            }
            if (otherStatuses.length > 0) {
                orConditions.push({ status: { in: otherStatuses } });
            }
            where.OR = orConditions;
        } else if (statuses.length === 1) {
            where.status = statuses[0];
        } else if (statuses.length > 1) {
            where.status = { in: statuses };
        }


        const includeLogsFlag = req.query.includeLogs === 'true';

        const items = await req.prisma.InventoryItem.findMany({
            where,
            orderBy: { updatedAt: 'desc' }
        });

        const branchIds = [...new Set(items.map(item => item.branchId).filter(Boolean))];
        const userIds = [...new Set(items.map(item => item.userId).filter(Boolean))];
        const customerIds = [...new Set(items.map(item => item.customerId).filter(Boolean))];
        const itemIds = items.map(item => item.id);

        const [branches, users, customers, logs] = await Promise.all([
            branchIds.length
                ? req.prisma.Branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
                : [],
            userIds.length
                ? req.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
                : [],
            customerIds.length
                ? req.prisma.customer.findMany({
                    where: { id: { in: customerIds } },
                    select: {
                        id: true,
                        customerUniqueId: true,
                        lead: { select: { firstName: true, lastName: true } }
                    }
                })
                : [],
            includeLogsFlag && itemIds.length
                ? req.prisma.InventoryLog.findMany({
                    where: { inventoryItemId: { in: itemIds } },
                    orderBy: { createdAt: 'desc' }
                })
                : []
        ]);

        const branchById = new Map(branches.map(branch => [branch.id, branch]));
        const userById = new Map(users.map(user => [user.id, user]));
        const customerById = new Map(customers.map(customer => [customer.id, customer]));
        const logsByItemId = new Map();

        logs.forEach(log => {
            if (!logsByItemId.has(log.inventoryItemId)) logsByItemId.set(log.inventoryItemId, []);
            logsByItemId.get(log.inventoryItemId).push(log);
        });

        const enrichedItems = items.map(item => ({
            ...item,
            branch: item.branchId ? branchById.get(item.branchId) || null : null,
            user: item.userId ? userById.get(item.userId) || null : null,
            customer: item.customerId ? customerById.get(item.customerId) || null : null,
            ...(includeLogsFlag && { logs: logsByItemId.get(item.id) || [] })
        }));

        // The frontend expects { success: true, data: items } for the lifecycle component
        if (includeLogsFlag) {
            return res.json({ success: true, data: enrichedItems });
        }

        res.json(enrichedItems);
    } catch (err) {
        next(err);
    }
}

/**
 * Add a new inventory item
 */
async function addInventoryItem(req, res, next) {
    try {
        const { type, name, serialNumber, model, ponSerialNumber, macAddress, branchId, qty } = req.body;
        const normalizedType = normalizeInventoryType(type) || 'ONT';
        const ispId = req.ispId;

        // Verify serial number uniqueness only if provided
        if (serialNumber) {
            const existing = await req.prisma.InventoryItem.findUnique({
                where: { serialNumber }
            });

            if (existing) {
                return res.status(400).json({ error: 'Serial number already exists in inventory' });
            }
        }

        const targetBranchId = (branchId !== undefined && branchId !== null && branchId !== 'none')
            ? Number(branchId)
            : (branchId === 'none' || branchId === null ? null : (req.selectedBranchId || null));
        const initialStatus = targetBranchId ? 'ASSIGNED_TO_BRANCH' : 'IN_STOCK';
        const itemQty = qty ? Number(qty) : 1;

        try {
            const item = await req.prisma.InventoryItem.create({
                data: {
                    type: normalizedType,
                    name,
                    serialNumber,
                    model,
                    ponSerialNumber,
                    macAddress,
                    ispId,
                    branchId: targetBranchId,
                    status: initialStatus,
                    qty: itemQty,
                    availableQty: itemQty,
                    updatedAt: new Date()
                }
            });

            await req.prisma.InventoryLog.create({
                data: {
                    inventoryItemId: item.id,
                    toStatus: initialStatus,
                    toEntityId: targetBranchId,
                    entityType: 'BRANCH',
                    actionByUserId: req.user.id,
                    note: `Initial entry into system with quantity ${itemQty}`
                }
            });

            res.status(201).json(item);
        } catch (err) {
            if (err.code === 'P2002') {
                return res.status(400).json({ error: 'Serial number already exists' });
            }
            throw err;
        }
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ error: 'Serial number already exists' });
        }
        next(err);
    }
}

/**
 * Transfer item ownership / status
 */
async function transferItem(req, res, next) {
    try {
        const { itemId } = req.params;
        const { toBranchId, toUserId, toCustomerId, status, note, qty } = req.body;

        const item = await req.prisma.InventoryItem.findUnique({
            where: { id: Number(itemId) }
        });

        if (!item || item.ispId !== req.ispId) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const reqQty = qty ? Number(qty) : 1;
        if (reqQty <= 0) {
            return res.status(400).json({ error: 'Quantity must be greater than 0' });
        }

        if (reqQty > item.availableQty) {
            return res.status(400).json({ error: `Requested quantity (${reqQty}) exceeds available quantity (${item.availableQty})` });
        }

        const fromStatus = item.status;
        const targetStatus = status || 'ASSIGNED_TO_BRANCH';
        let updated;

        if (reqQty < item.availableQty) {
            // Partial Transfer: Split the item
            const newParentAvailable = item.availableQty - reqQty;
            
            // 1. Update parent availableQty
            await req.prisma.InventoryItem.update({
                where: { id: item.id },
                data: {
                    availableQty: newParentAvailable,
                    updatedAt: new Date()
                }
            });

            // 2. Create parent log for the split
            await req.prisma.InventoryLog.create({
                data: {
                    inventoryItemId: item.id,
                    fromStatus,
                    toStatus: fromStatus,
                    toEntityId: item.branchId,
                    entityType: 'BRANCH',
                    actionByUserId: req.user.id,
                    note: `Split off ${reqQty} unit(s) for transfer. Remaining available: ${newParentAvailable}`
                }
            });

            // 3. Create new child item in target
            const childSerialNumber = item.serialNumber ? `${item.serialNumber}-part-${Date.now()}` : null;
            updated = await req.prisma.InventoryItem.create({
                data: {
                    type: item.type,
                    name: item.name,
                    serialNumber: childSerialNumber,
                    ponSerialNumber: item.ponSerialNumber,
                    macAddress: item.macAddress,
                    model: item.model,
                    condition: item.condition,
                    ispId: item.ispId,
                    status: targetStatus,
                    branchId: toBranchId ? Number(toBranchId) : null,
                    userId: toUserId ? Number(toUserId) : null,
                    customerId: toCustomerId ? Number(toCustomerId) : null,
                    qty: reqQty,
                    availableQty: reqQty,
                    updatedAt: new Date()
                }
            });
        } else {
            // Full Transfer
            updated = await req.prisma.InventoryItem.update({
                where: { id: Number(itemId) },
                data: {
                    status: targetStatus,
                    branchId: toBranchId ? Number(toBranchId) : null,
                    userId: toUserId ? Number(toUserId) : null,
                    customerId: toCustomerId ? Number(toCustomerId) : null,
                    updatedAt: new Date()
                }
            });
        }

        const toEntityId = toBranchId || toUserId || toCustomerId || null;
        const entityType = toBranchId ? 'BRANCH' : (toUserId ? 'USER' : (toCustomerId ? 'CUSTOMER' : 'HEAD_OFFICE'));

        await req.prisma.InventoryLog.create({
            data: {
                inventoryItemId: updated.id,
                fromStatus,
                toStatus: targetStatus,
                toEntityId,
                entityType,
                actionByUserId: req.user.id,
                note: note || `Transferred ${reqQty} unit(s) to ${entityType.toLowerCase()}`
            }
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

/**
 * Get item history logs
 */
/**
 * Return item from customer/user to branch/HQ
 */
async function returnItem(req, res, next) {
    try {
        const { itemId } = req.params;
        const { status, note, toBranchId } = req.body; // status: RETURNED or FAULTY

        const item = await req.prisma.InventoryItem.findUnique({
            where: { id: Number(itemId) }
        });

        if (!item || item.ispId !== req.ispId) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const fromStatus = item.status;
        const targetStatus = status || 'IN_STOCK'; // Default back to stock if not specified as faulty
        
        // If returning from customer, we might want to also remove the CustomerDevice entry or mark it
        if (item.customerId) {
            // Find the CustomerDevice entry and delete it or mark it as returned
            await req.prisma.CustomerDevice.deleteMany({
                where: { 
                    customerId: item.customerId,
                    serialNumber: item.serialNumber
                }
            });
        }

        const updated = await req.prisma.InventoryItem.update({
            where: { id: Number(itemId) },
            data: {
                status: targetStatus,
                customerId: null,
                userId: null,
                branchId: toBranchId ? Number(toBranchId) : item.branchId, // Keep in same branch unless specified
                updatedAt: new Date()
            }
        });

        await req.prisma.InventoryLog.create({
            data: {
                inventoryItemId: updated.id,
                fromStatus,
                toStatus: targetStatus,
                toEntityId: toBranchId ? Number(toBranchId) : item.branchId,
                entityType: toBranchId ? 'BRANCH' : 'HEAD_OFFICE',
                actionByUserId: req.user.id,
                note: note || 'Returned from customer/user'
            }
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

async function getItemLogs(req, res, next) {

    try {
        const { itemId } = req.params;
        const logs = await req.prisma.InventoryLog.findMany({
            where: { inventoryItemId: Number(itemId) },
            orderBy: { createdAt: 'desc' }
        });

        const item = await req.prisma.InventoryItem.findUnique({
            where: { id: Number(itemId) },
            select: { serialNumber: true, type: true }
        });

        res.json(logs.map(log => ({ ...log, item })));
    } catch (err) {
        next(err);
    }
}

/**
 * Bulk add inventory items
 */
async function bulkAddInventoryItems(req, res, next) {
    try {
        const { items, branchId } = req.body;
        const ispId = req.ispId;
        const userId = req.user.id;
        const selectedBranchId = branchId ? Number(branchId) : (req.selectedBranchId || null);

        const results = {
            successCount: 0,
            failedCount: 0,
            errors: []
        };

        for (const itemData of items) {
            try {
                const { type, name, serialNumber, model, ponSerialNumber, macAddress } = itemData;
                const normalizedType = normalizeInventoryType(type) || 'ONT';

                // Verify serial number uniqueness only if provided
                if (serialNumber) {
                    const existing = await req.prisma.InventoryItem.findUnique({
                        where: { serialNumber }
                    });

                    if (existing) {
                        throw new Error(`Serial number ${serialNumber} already exists`);
                    }
                }

                const created = await req.prisma.InventoryItem.create({
                    data: {
                        type: normalizedType,
                        name: name || `Device ${normalizedType}`,
                        serialNumber,
                        model,
                        ponSerialNumber,
                        macAddress,
                        ispId,
                        branchId: selectedBranchId,
                        status: selectedBranchId ? 'ASSIGNED_TO_BRANCH' : 'IN_STOCK',
                        updatedAt: new Date()
                    }
                });

                await req.prisma.InventoryLog.create({
                    data: {
                        inventoryItemId: created.id,
                        toStatus: selectedBranchId ? 'ASSIGNED_TO_BRANCH' : 'IN_STOCK',
                        toEntityId: selectedBranchId,
                        entityType: 'BRANCH',
                        actionByUserId: userId,
                        note: 'Bulk Import'
                    }
                });

                results.successCount++;
            } catch (err) {
                results.failedCount++;
                results.errors.push({ serialNumber: itemData.serialNumber, error: err.message });
            }
        }

        res.json(results);
    } catch (err) {
        next(err);
    }
}

/**
 * Bulk transfer inventory items
 */
async function bulkTransferItems(req, res, next) {
    try {
        const { itemIds, toBranchId, toUserId, toCustomerId, status, note } = req.body;

        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return res.status(400).json({ error: 'No items provided for transfer' });
        }

        const items = await req.prisma.InventoryItem.findMany({
            where: { id: { in: itemIds.map(Number) }, ispId: req.ispId }
        });

        if (items.length !== itemIds.length) {
            return res.status(404).json({ error: 'One or more items not found or access denied' });
        }

        const updateData = {
            status,
            branchId: toBranchId ? Number(toBranchId) : null,
            userId: toUserId ? Number(toUserId) : null,
            customerId: toCustomerId ? Number(toCustomerId) : null,
            updatedAt: new Date()
        };

        const entityType = toBranchId ? 'BRANCH' : (toUserId ? 'USER' : (toCustomerId ? 'CUSTOMER' : 'HEAD_OFFICE'));
        const toEntityId = toBranchId || toUserId || toCustomerId || null;

        await req.prisma.$transaction(items.flatMap(item => [
            req.prisma.InventoryItem.update({
                where: { id: item.id },
                data: updateData
            }),
            req.prisma.InventoryLog.create({
                data: {
                    inventoryItemId: item.id,
                    fromStatus: item.status,
                    toStatus: status,
                    toEntityId,
                    entityType,
                    actionByUserId: req.user.id,
                    note: note || 'Bulk Transfer'
                }
            })
        ]));

        res.json({ message: 'Items transferred successfully', count: items.length });
    } catch (err) {
        next(err);
    }
}

async function assignInventoryItem(req, res, next) {
    try {
        const { itemId } = req.params;
        const { customerId, userId, assignedRoleId, note, qty } = req.body;

        if (!customerId && !userId && !assignedRoleId) {
            return res.status(400).json({ error: 'Customer ID, User ID, or Role ID is required' });
        }

        const item = await req.prisma.InventoryItem.findUnique({
            where: { id: Number(itemId) }
        });

        if (!item || item.ispId !== req.ispId) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const reqQty = qty ? Number(qty) : 1;
        if (reqQty <= 0) {
            return res.status(400).json({ error: 'Quantity must be greater than 0' });
        }

        if (reqQty > item.availableQty) {
            return res.status(400).json({ error: `Requested quantity (${reqQty}) exceeds available quantity (${item.availableQty})` });
        }

        const fromStatus = item.status;
        let toStatus;
        if (customerId) toStatus = 'ASSIGNED_TO_CUSTOMER';
        else if (userId) toStatus = 'ASSIGNED_TO_USER';
        else if (assignedRoleId) toStatus = 'ASSIGNED_TO_ROLE';

        let updated;

        if (reqQty < item.availableQty) {
            // Partial Assignment: Split the item
            const newParentAvailable = item.availableQty - reqQty;
            
            // 1. Update parent item availableQty
            await req.prisma.InventoryItem.update({
                where: { id: item.id },
                data: {
                    availableQty: newParentAvailable,
                    updatedAt: new Date()
                }
            });

            // 2. Create parent log for the split
            await req.prisma.InventoryLog.create({
                data: {
                    inventoryItemId: item.id,
                    fromStatus,
                    toStatus: fromStatus,
                    toEntityId: item.branchId,
                    entityType: 'BRANCH',
                    actionByUserId: req.user.id,
                    note: `Split off ${reqQty} unit(s) for assignment. Remaining available: ${newParentAvailable}`
                }
            });

            // 3. Create new child item representing assigned portion
            // We append a timestamp to the serial number if it exists to maintain uniqueness
            const childSerialNumber = item.serialNumber ? `${item.serialNumber}-part-${Date.now()}` : null;
            updated = await req.prisma.InventoryItem.create({
                data: {
                    type: item.type,
                    name: item.name,
                    serialNumber: childSerialNumber,
                    ponSerialNumber: item.ponSerialNumber,
                    macAddress: item.macAddress,
                    model: item.model,
                    condition: item.condition,
                    ispId: item.ispId,
                    branchId: item.branchId,
                    status: toStatus,
                    qty: reqQty,
                    availableQty: reqQty,
                    customerId: customerId ? Number(customerId) : null,
                    userId: userId ? Number(userId) : null,
                    assignedRoleId: assignedRoleId ? Number(assignedRoleId) : null,
                    updatedAt: new Date()
                }
            });
        } else {
            // Full Assignment: Update existing item
            updated = await req.prisma.InventoryItem.update({
                where: { id: Number(itemId) },
                data: {
                    status: toStatus,
                    customerId: customerId ? Number(customerId) : null,
                    userId: userId ? Number(userId) : null,
                    assignedRoleId: assignedRoleId ? Number(assignedRoleId) : null,
                    updatedAt: new Date()
                }
            });
        }

        await req.prisma.InventoryLog.create({
            data: {
                inventoryItemId: updated.id,
                fromStatus,
                toStatus,
                entityType: customerId ? 'CUSTOMER' : (userId ? 'USER' : 'ROLE'),
                toEntityId: customerId ? Number(customerId) : (userId ? Number(userId) : Number(assignedRoleId)),
                actionByUserId: req.user.id,
                note: note || `Assigned ${reqQty} unit(s) to ${customerId ? 'customer' : (userId ? 'user' : 'role')}`
            }
        });

        // If assigned to customer, also create a CustomerDevice entry for tracking
        if (customerId) {
            await req.prisma.CustomerDevice.create({
                data: {
                    customerId: Number(customerId),
                    deviceType: item.type,
                    brand: item.name || 'Unknown',
                    model: item.model || 'Unknown',
                    serialNumber: updated.serialNumber || '',
                    macAddress: updated.macAddress || '',
                    ponSerial: updated.ponSerialNumber || '',
                    provisioningStatus: 'PENDING',
                    updatedAt: new Date()
                }
            });
        }

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listInventoryItems,
    addInventoryItem,
    bulkAddInventoryItems,
    transferItem,
    bulkTransferItems,
    returnItem,
    getItemLogs,
    assignInventoryItem
};
