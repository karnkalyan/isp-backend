const { computeExpiryFromBase } = require('../utils/dateHelper');

async function createRequest(req, res, next) {
    const prisma = req.prisma;
    const { customerId, type, details, reason } = req.body;
    try {
        if (!customerId || !type || !details) {
            return res.status(400).json({ error: 'customerId, type, and details are required' });
        }

        const customer = await prisma.customer.findFirst({
            where: { id: Number(customerId), isDeleted: false, ispId: req.ispId }
        });
        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        const request = await prisma.branchRequest.create({
            data: {
                ispId: req.ispId,
                branchId: req.branchId || customer.branchId || 1,
                customerId: Number(customerId),
                type,
                status: 'PENDING',
                details: typeof details === 'string' ? details : JSON.stringify(details),
                reason: reason || '',
                requestedBy: req.user.id
            }
        });

        res.status(201).json({ success: true, message: 'Request submitted successfully', request });
    } catch (err) {
        next(err);
    }
}

async function listRequests(req, res, next) {
    const prisma = req.prisma;
    try {
        const isGlobalAdmin = req.user.role === 'admin' || 
                             req.user.role?.name === 'administrator' || 
                             req.user.role?.name === 'isp_admin' || 
                             req.user.role?.name === 'super admin' || 
                             req.user.role?.name?.startsWith('global') ||
                             req.user.role?.name?.toLowerCase().includes('admin');

        const where = {
            ispId: req.ispId,
            ...(!isGlobalAdmin && req.branchId ? { branchId: req.branchId } : {})
        };

        const requests = await prisma.branchRequest.findMany({
            where,
            include: {
                branch: { select: { name: true } },
                customer: { include: { lead: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Resolve requestedBy / approvedBy user names manually
        const userIds = Array.from(new Set(
            requests.flatMap(r => [r.requestedBy, r.approvedBy].filter(Boolean))
        ));

        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true }
        });

        const userMap = new Map(users.map(u => [u.id, u.name || u.email]));

        const results = requests.map(r => ({
            ...r,
            details: JSON.parse(r.details),
            requestedByName: userMap.get(r.requestedBy) || `User #${r.requestedBy}`,
            approvedByName: r.approvedBy ? (userMap.get(r.approvedBy) || `User #${r.approvedBy}`) : null
        }));

        res.json(results);
    } catch (err) {
        next(err);
    }
}

async function approveRejectRequest(req, res, next) {
    const prisma = req.prisma;
    const { id } = req.params;
    const { status, reason } = req.body; // status: APPROVED or REJECTED

    try {
        const isGlobalAdmin = req.user.role === 'admin' || 
                             req.user.role?.name === 'administrator' || 
                             req.user.role?.name === 'isp_admin' || 
                             req.user.role?.name === 'super admin' || 
                             req.user.role?.name?.startsWith('global') ||
                             req.user.role?.name?.toLowerCase().includes('admin');

        if (!isGlobalAdmin) {
            return res.status(403).json({ error: 'Access denied: Only administrators can approve or reject requests' });
        }

        const request = await prisma.branchRequest.findFirst({
            where: { id: Number(id), ispId: req.ispId }
        });

        if (!request) return res.status(404).json({ error: 'Request not found' });
        if (request.status !== 'PENDING') return res.status(400).json({ error: 'Request is already processed' });

        if (status === 'REJECTED') {
            const updated = await prisma.branchRequest.update({
                where: { id: request.id },
                data: {
                    status: 'REJECTED',
                    reason: reason || request.reason,
                    approvedBy: req.user.id
                }
            });
            return res.json({ success: true, message: 'Request rejected successfully', request: updated });
        }

        if (status !== 'APPROVED') {
            return res.status(400).json({ error: 'Invalid status. Must be APPROVED or REJECTED' });
        }

        const details = JSON.parse(request.details);

        if (request.type === 'PACKAGE_CHANGE') {
            const { newPackageId } = details;
            if (!newPackageId) return res.status(400).json({ error: 'Invalid request details: newPackageId is missing' });

            const customer = await prisma.customer.findFirst({
                where: { id: request.customerId, isDeleted: false, ispId: req.ispId },
                include: {
                    subscribedPkg: { include: { packagePlanDetails: true } },
                    customerSubscriptions: { where: { isActive: true }, take: 1, orderBy: { createdAt: 'desc' } }
                }
            });
            if (!customer) return res.status(404).json({ error: 'Customer not found' });

            const newPackage = await prisma.packagePrice.findFirst({
                where: { id: Number(newPackageId), isDeleted: false, ispId: req.ispId },
                include: { packagePlanDetails: true }
            });
            if (!newPackage) return res.status(404).json({ error: 'Requested package plan not found' });

            await prisma.$transaction(async (tx) => {
                await tx.customer.update({
                    where: { id: customer.id },
                    data: { subscribedPkgId: Number(newPackageId), assignedPkg: Number(newPackageId) }
                });

                const now = new Date();
                const expiryDate = computeExpiryFromBase(String(newPackage.packageDuration || '1 Day'));

                let updatedSubscription;
                if (customer.customerSubscriptions.length > 0) {
                    const sub = customer.customerSubscriptions[0];
                    updatedSubscription = await tx.customerSubscription.update({
                        where: { id: sub.id },
                        data: { packagePriceId: Number(newPackageId), planEnd: expiryDate, updatedAt: now }
                    });
                } else {
                    updatedSubscription = await tx.customerSubscription.create({
                        data: {
                            customer: { connect: { id: customer.id } },
                            packagePriceId: Number(newPackageId),
                            planStart: now,
                            planEnd: expiryDate,
                            isTrial: newPackage.isTrial || false,
                            isInvoicing: true,
                            isActive: true
                        }
                    });
                }

                const renewalAmount = newPackage.renewAmountWithTax !== null && newPackage.renewAmountWithTax !== undefined
                    ? Number(newPackage.renewAmountWithTax)
                    : Number(newPackage.price || 0);
                const orderAmount = customer.isFree ? 0 : renewalAmount;
                const baseItemPrice = customer.isFree ? 0 : (newPackage.price || 0);

                await tx.customerOrderManagement.create({
                    data: {
                        customerId: customer.id,
                        subscriptionId: updatedSubscription.id,
                        packagePriceId: Number(newPackageId),
                        packageStart: updatedSubscription.planStart,
                        packageEnd: updatedSubscription.planEnd,
                        orderDate: now,
                        totalAmount: orderAmount,
                        isActive: true,
                        isDeleted: false,
                        orderType: 'package_change',
                        items: {
                            create: [
                                {
                                    itemName: `${newPackage.packageName || 'Package'} - Package Change`,
                                    referenceId: newPackage.referenceId || null,
                                    itemPrice: baseItemPrice
                                }
                            ]
                        }
                    }
                });
            });
        } 
        else if (request.type === 'DISCOUNT') {
            const { orderId, itemName, itemPrice } = details;
            if (!orderId || !itemName || itemPrice === undefined) {
                return res.status(400).json({ error: 'Invalid request details: orderId, itemName, or itemPrice is missing' });
            }

            const order = await prisma.customerOrderManagement.findUnique({
                where: { id: Number(orderId) },
                include: { items: true }
            });

            if (!order) return res.status(404).json({ error: 'Target order not found' });
            if (order.isPaid) return res.status(400).json({ error: 'Cannot apply adjustment to a paid order' });

            await prisma.$transaction(async (tx) => {
                const newItem = await tx.orderDetail.create({
                    data: {
                        orderId: order.id,
                        itemName,
                        itemPrice: parseFloat(itemPrice)
                    }
                });

                const totalAmount = order.totalAmount + newItem.itemPrice;

                await tx.customerOrderManagement.update({
                    where: { id: order.id },
                    data: { totalAmount }
                });
            });
        } else {
            return res.status(400).json({ error: 'Unsupported request type' });
        }

        const updated = await prisma.branchRequest.update({
            where: { id: request.id },
            data: {
                status: 'APPROVED',
                approvedBy: req.user.id,
                reason: reason || request.reason
            }
        });

        res.json({ success: true, message: 'Request approved and processed successfully', request: updated });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    createRequest,
    listRequests,
    approveRejectRequest
};
