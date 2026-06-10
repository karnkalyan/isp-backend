const { computeExpiryFromBase } = require('../utils/dateHelper');
const RadiusClient = require('../services/radiusClient');
const { getBranchFilter } = require('../utils/branchHelper');

/**
 * Extend a customer's subscription
 */
async function extendSubscription(req, res, next) {
    const prisma = req.prisma;
    const { customerId, days, extendToDate, type } = req.body; // type: 'grace' or 'compensation'
    
    try {
        const isAdmin = req.user.role?.name?.toLowerCase() === 'admin' || req.user.role?.name?.toLowerCase() === 'isp_admin';
        const subscription = await prisma.customerSubscription.findFirst({
            where: { 
                customerId: Number(customerId), 
                isActive: true,
                ...(req.branchId ? { customer: { branchId: req.branchId } } : {})
            },
            include: { customer: { include: { connectionUsers: true } } }
        });

        if (!subscription) return res.status(404).json({ error: 'Active subscription not found' });

        // Normal staff can only extend by 3 days once and only as 'grace'
        if (!isAdmin) {
            if (subscription.extensionCount >= 1) {
                return res.status(403).json({ error: 'Staff can only extend once. Contact Admin for further extensions.' });
            }
            if (Number(days) !== 3) {
                return res.status(403).json({ error: 'Staff can only extend by exactly 3 days.' });
            }
        }

        let newPlanEnd;
        if (extendToDate) {
            newPlanEnd = new Date(extendToDate);
        } else {
            newPlanEnd = new Date(subscription.planEnd);
            newPlanEnd.setDate(newPlanEnd.getDate() + Number(days));
        }

        const extensionDays = Math.ceil((newPlanEnd - new Date(subscription.planEnd)) / (1000 * 60 * 60 * 24));

        await prisma.$transaction(async (tx) => {
            await tx.customerSubscription.update({
                where: { id: subscription.id },
                data: {
                    planEnd: newPlanEnd,
                    extensionCount: { increment: 1 },
                    graceDaysBalance: type === 'grace' ? { increment: extensionDays } : undefined,
                    compensationDays: type === 'compensation' ? { increment: extensionDays } : undefined
                }
            });

            // Sync with Radius if needed
            for (const cu of subscription.customer.connectionUsers) {
                try {
                    const radius = await RadiusClient.create(req.ispId);
                    await radius.updateExpiration(cu.username, newPlanEnd);
                } catch (e) {
                    console.error('Radius sync failed during extension:', e.message);
                }
            }
        });

        res.json({ success: true, newPlanEnd, type });
    } catch (err) {
        next(err);
    }
}

/**
 * Pause / Play functionality
 */
async function togglePause(req, res, next) {
    const prisma = req.prisma;
    const { customerId, action } = req.body; // action: 'pause' or 'play'

    try {
        const subscription = await prisma.customerSubscription.findFirst({
            where: { 
                customerId: Number(customerId), 
                isActive: true,
                ...(req.branchId ? { customer: { branchId: req.branchId } } : {})
            },
            include: { customer: { include: { connectionUsers: true } } }
        });

        if (!subscription) return res.status(404).json({ error: 'Active subscription not found' });

        if (action === 'pause') {
            if (subscription.isPaused) return res.status(400).json({ error: 'Already paused' });
            
            await prisma.$transaction(async (tx) => {
                await tx.customerSubscription.update({
                    where: { id: subscription.id },
                    data: { isPaused: true, pauseDate: new Date() }
                });

                // Set Radius expiry to now to block access
                for (const cu of subscription.customer.connectionUsers) {
                    try {
                        const radius = await RadiusClient.create(req.ispId);
                        await radius.updateExpiration(cu.username, new Date());
                    } catch (e) {}
                }
            });
        } else if (action === 'play') {
            if (!subscription.isPaused) return res.status(400).json({ error: 'Not paused' });

            const pauseDate = new Date(subscription.pauseDate);
            const now = new Date();
            const pauseDurationMs = now - pauseDate;

            const newPlanEnd = new Date(subscription.planEnd.getTime() + pauseDurationMs);

            await prisma.$transaction(async (tx) => {
                await tx.customerSubscription.update({
                    where: { id: subscription.id },
                    data: { isPaused: false, pauseDate: null, planEnd: newPlanEnd }
                });

                for (const cu of subscription.customer.connectionUsers) {
                    try {
                        const radius = await RadiusClient.create(req.ispId);
                        await radius.updateExpiration(cu.username, newPlanEnd);
                    } catch (e) {}
                }
            });
        }


        res.json({ success: true, action });
    } catch (err) {
        next(err);
    }
}

/**
 * Add / Remove Custom Adjustment Items
 */
async function addAdjustmentItem(req, res, next) {
    const prisma = req.prisma;
    const { orderId, itemName, itemPrice } = req.body;

    try {
        const order = await prisma.customerOrderManagement.findUnique({
            where: { id: Number(orderId) },
            include: { items: true }
        });

        if (!order) return res.status(404).json({ error: 'Order not found' });

        const updatedOrder = await prisma.$transaction(async (tx) => {
            const newItem = await tx.orderDetail.create({
                data: {
                    orderId: order.id,
                    itemName,
                    itemPrice: parseFloat(itemPrice)
                }
            });

            const totalAmount = order.totalAmount + newItem.itemPrice;

            return await tx.customerOrderManagement.update({
                where: { id: order.id },
                data: { totalAmount },
                include: { items: true }
            });
        });

        res.json(updatedOrder);
    } catch (err) {
        next(err);
    }
}

async function removeAdjustmentItem(req, res, next) {
    const prisma = req.prisma;
    const { detailId } = req.body;

    try {
        const detail = await prisma.orderDetail.findUnique({
            where: { id: Number(detailId) },
            include: { order: true }
        });

        if (!detail) return res.status(404).json({ error: 'Item not found' });

        const updatedOrder = await prisma.$transaction(async (tx) => {
            await tx.orderDetail.delete({ where: { id: detail.id } });
            
            const totalAmount = detail.order.totalAmount - detail.itemPrice;

            return await tx.customerOrderManagement.update({
                where: { id: detail.order.id },
                data: { totalAmount },
                include: { items: true }
            });
        });

        res.json(updatedOrder);
    } catch (err) {
        next(err);
    }
}

/**
 * Pay an arbitrary order with invoice ID validation
 */
async function payOrder(req, res, next) {
    const prisma = req.prisma;
    const orderId = req.params.orderId || req.body.orderId;
    const { invoiceId, paymentMethod, amount } = req.body;
    
    try {
        const order = await prisma.customerOrderManagement.findUnique({
            where: { id: Number(orderId) }
        });

        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.isPaid) return res.status(400).json({ error: 'Order already paid' });

        const customer = await prisma.customer.findFirst({
            where: { 
                id: order.customerId, 
                ispId: req.ispId, 
                isDeleted: false,
                ...(req.branchId ? { branchId: req.branchId } : {})
            },
            select: { id: true, branchId: true }
        });

        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        if (amount === undefined || amount === null) {
            return res.status(400).json({ error: 'Payment amount is required for validation' });
        }
        if (Number(amount) !== Number(order.totalAmount)) {
            return res.status(400).json({ error: `Incorrect payment amount. Expected: ${order.totalAmount}, Received: ${amount}` });
        }

        const invIdNumeric = Number(invoiceId);
        if (isNaN(invIdNumeric)) return res.status(400).json({ error: 'Invoice ID must be numeric' });

        // Enforce global uniqueness of the invoice ID within the same ISP
        const existingInvoice = await prisma.customerOrderManagement.findFirst({
            where: {
                invoiceId: invoiceId.toString(),
                isPaid: true,
                customer: {
                    ispId: req.ispId
                }
            }
        });
        if (existingInvoice) {
            return res.status(400).json({ error: 'Invoice number is already used/duplicate in this ISP' });
        }

        // Check branch invoice range
        if (customer.branchId) {
            const ranges = await prisma.branchInvoiceRange.findMany({
                where: { branchId: customer.branchId, isActive: true }
            });

            if (ranges.length > 0) {
                const isValid = ranges.some(r => invIdNumeric >= r.rangeStart && invIdNumeric <= r.rangeEnd);
                if (!isValid) {
                    return res.status(400).json({ error: 'Invoice ID is outside the assigned ranges for this branch' });
                }
            }
        }

        const updatedOrder = await prisma.customerOrderManagement.update({
            where: { id: order.id },
            data: {
                isPaid: true,
                invoiceId: invoiceId.toString(),
                paymentId: paymentMethod || 'MANUAL',
                updatedAt: new Date()
            }
        });

        const subscription = await prisma.customerSubscription.findUnique({ where: { id: order.subscriptionId } });

        if (subscription) {
            await prisma.customerSubscription.update({
                where: { id: subscription.id },
                data: { isActive: true, updatedAt: new Date() }
            });
        }

        const pppUsers = await prisma.connectionUser.findMany({
            where: { customerId: customer.id, isDeleted: false, isActive: true },
            select: { username: true }
        }).catch(() => []);

        if (subscription && pppUsers.length) {
            for (const connection of pppUsers) {
                try {
                    const radius = await RadiusClient.create(req.ispId);
                    await radius.updateExpiration(connection.username, subscription.planEnd);
                } catch (e) {
                    console.error('Radius sync failed during payment approval:', e.message);
                }
            }
        }

        res.json(updatedOrder);
    } catch (err) {
        next(err);
    }
}

/**
 * Renew a subscription
 */
async function renewSubscription(req, res, next) {
    const prisma = req.prisma;
    const { customerId, packageId, invoiceId, amount } = req.body;
    
    try {
        const subscription = await prisma.customerSubscription.findFirst({
            where: { customerId: Number(customerId), isActive: true }
        });

        if (!subscription) return res.status(404).json({ error: 'Active subscription not found' });

        const pkgPrice = await prisma.packagePrice.findUnique({
            where: { id: Number(packageId) },
            include: { packagePlanDetails: { select: { planName: true } } }
        });

        if (!pkgPrice) return res.status(404).json({ error: 'Package Price not found' });

        const customer = await prisma.customer.findFirst({
            where: { 
                id: Number(customerId), 
                ispId: req.ispId, 
                isDeleted: false,
                ...(req.branchId ? { branchId: req.branchId } : {})
            },
            select: { id: true, branchId: true, isRechargeable: true }
        });

        if (!customer) return res.status(404).json({ error: 'Customer not found' });

        const newPackageAmount = pkgPrice.initialTotalWithTax !== null && pkgPrice.initialTotalWithTax !== undefined
            ? Number(pkgPrice.initialTotalWithTax)
            : Number(pkgPrice.price || 0);
        const renewalAmount = pkgPrice.renewAmountWithTax !== null && pkgPrice.renewAmountWithTax !== undefined
            ? Number(pkgPrice.renewAmountWithTax)
            : Number(pkgPrice.price || 0);
        const expectedAmount = customer.isRechargeable ? renewalAmount : newPackageAmount;

        // Amount validation
        if (amount !== undefined && amount !== null) {
            if (Number(amount) !== Number(expectedAmount)) {
                return res.status(400).json({ error: `Incorrect payment amount. Expected: ${expectedAmount}, Received: ${amount}` });
            }
        }

        if (invoiceId) {
            const invoiceNumber = Number(invoiceId);
            if (isNaN(invoiceNumber)) return res.status(400).json({ error: 'Invoice number must be numeric' });

            // Enforce global uniqueness of the invoice ID within the same ISP
            const existingInvoice = await prisma.customerOrderManagement.findFirst({
                where: {
                    invoiceId: invoiceId.toString(),
                    isPaid: true,
                    customer: {
                        ispId: req.ispId
                    }
                }
            });
            if (existingInvoice) {
                return res.status(400).json({ error: 'Invoice number is already used/duplicate in this ISP' });
            }

            if (customer.branchId) {
                const activeRange = await prisma.branchInvoiceRange.findFirst({
                    where: {
                        branchId: customer.branchId,
                        isActive: true,
                        rangeStart: { lte: invoiceNumber },
                        rangeEnd: { gte: invoiceNumber }
                    }
                });

                if (!activeRange) {
                    return res.status(400).json({ error: 'Invoice number is outside the active range for this branch' });
                }
            }
        }
        
        let planStart = new Date(subscription.planEnd);
        if (!subscription.isTrial && planStart < new Date()) {
            planStart = new Date();
        }

        let planEnd = computeExpiryFromBase(planStart, pkgPrice.packageDuration);
        
        // Deduct Grace Days
        if (subscription.graceDaysBalance > 0) {
            planEnd.setDate(planEnd.getDate() - subscription.graceDaysBalance);
        }

        const newSub = await prisma.$transaction(async (tx) => {
            // End old sub
            await tx.customerSubscription.update({
                where: { id: subscription.id },
                data: { isActive: false }
            });

            // Create new sub
            const created = await tx.customerSubscription.create({
                data: {
                    customerId: Number(customerId),
                    package: pkgPrice.id,
                    planStart,
                    planEnd,
                    isTrial: false,
                    isActive: true,
                    isInvoicing: true,
                    extensionCount: 0,
                    graceDaysBalance: 0,
                    compensationDays: 0,
                }
            });

            // Create order for renewal
            const orderItems = [
              { itemName: pkgPrice.packagePlanDetails?.planName || 'Package Renewal', referenceId: pkgPrice.referenceId, itemPrice: expectedAmount }
            ];

            await tx.customerOrderManagement.create({
                data: {
                    customerId: Number(customerId),
                    subscriptionId: created.id,
                    package: pkgPrice.id,
                    orderDate: new Date(),
                    packageStart: planStart,
                    packageEnd: planEnd,
                    totalAmount: amount !== undefined ? Number(amount) : expectedAmount,
                    isPaid: false,
                    isActive: true,
                    invoiceId: invoiceId ? String(invoiceId) : null,
                    paymentId: 'PENDING_APPROVAL',
                    updatedAt: new Date()
                }
            });

            if (!customer.isRechargeable) {
                await tx.customer.update({
                    where: { id: customer.id },
                    data: { isRechargeable: true }
                });
            }

            return created;
        });

        res.json({ success: true, subscription: newSub });
    } catch (err) {
        next(err);
    }
}

/**
 * Generate Manual Invoice
 */
async function generateManualInvoice(req, res, next) {
    const prisma = req.prisma;
    const { customerId, items, description } = req.body; // items: [{itemName, itemPrice}]

    try {
        if (!items || items.length === 0) return res.status(400).json({ error: 'Items required' });

        const customer = await prisma.customer.findFirst({
            where: {
                id: Number(customerId),
                ispId: req.ispId,
                isDeleted: false,
                ...(req.branchId ? { branchId: req.branchId } : {})
            }
        });
        if (!customer) return res.status(404).json({ error: 'Customer not found or access denied' });

        const totalAmount = items.reduce((sum, i) => sum + parseFloat(i.itemPrice || 0), 0);
        
        const newOrder = await prisma.customerOrderManagement.create({
            data: {
                customer: { connect: { id: Number(customerId) } },
                orderDate: new Date(),
                totalAmount,
                isPaid: false,
                isActive: true,
                items: {
                    create: items.map(i => ({
                        itemName: i.itemName,
                        itemPrice: parseFloat(i.itemPrice)
                    }))
                }
            },
            include: { items: true }
        });

        res.json(newOrder);
    } catch (err) {
        next(err);
    }
}

async function getBillingStats(req, res, next) {
    const prisma = req.prisma;
    try {
        const now = new Date();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(now.getMonth() - 5);
        sixMonthsAgo.setDate(1);

        const branchFilter = await getBranchFilter(req);
        const customerWhere = {
            ispId: req.ispId,
            ...(branchFilter?.branchId ? { branchId: branchFilter.branchId } : {})
        };
        const customerIds = await prisma.customer.findMany({
            where: customerWhere,
            select: { id: true }
        }).then(customers => customers.map(customer => customer.id));

        const orders = await prisma.customerOrderManagement.findMany({
            where: {
                isPaid: true,
                orderDate: { gte: sixMonthsAgo },
                customerId: { in: customerIds }
            },
            select: {
                totalAmount: true,
                orderDate: true
            }
        });

        // Group by month
        const monthlyStats = {};
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        for (let i = 0; i < 6; i++) {
            const d = new Date();
            d.setMonth(now.getMonth() - i);
            const monthName = months[d.getMonth()];
            monthlyStats[monthName] = { revenue: 0, expenses: 0 }; // We don't have expenses yet, but keeping structure
        }

        orders.forEach(order => {
            const monthName = months[new Date(order.orderDate).getMonth()];
            if (monthlyStats[monthName]) {
                monthlyStats[monthName].revenue += order.totalAmount;
                // Dummy expenses for visualization (e.g., 60% of revenue)
                monthlyStats[monthName].expenses += order.totalAmount * 0.6;
            }
        });

        const formattedStats = Object.keys(monthlyStats).map(month => ({
            month,
            revenue: monthlyStats[month].revenue,
            expenses: monthlyStats[month].expenses
        })).reverse();

        res.json(formattedStats);
    } catch (err) {
        next(err);
    }
}

/**
 * List Invoices (paid/unpaid orders)
 */
async function listInvoices(req, res, next) {
    const prisma = req.prisma;
    try {
        const branchFilter = await getBranchFilter(req);
        const { search, status, page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const where = {
            isDeleted: false,
            customer: {
                ispId: req.ispId,
                ...branchFilter
            }
        };

        if (status === 'paid') {
            where.isPaid = true;
        } else if (status === 'pending') {
            where.isPaid = false;
        }

        if (search) {
            where.OR = [
                { invoiceId: { contains: search } },
                { customer: { lead: { firstName: { contains: search } } } },
                { customer: { lead: { lastName: { contains: search } } } }
            ];
        }

        const [orders, total] = await Promise.all([
            prisma.customerOrderManagement.findMany({
                where,
                include: {
                    customer: {
                        include: {
                            lead: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                    email: true,
                                    phoneNumber: true
                                }
                            }
                        }
                    },
                    items: true,
                    packagePrice: {
                        include: {
                            packagePlanDetails: true
                        }
                    }
                },
                orderBy: { orderDate: 'desc' },
                skip,
                take: Number(limit)
            }),
            prisma.customerOrderManagement.count({ where })
        ]);

        const formattedInvoices = orders.map(order => {
            const customerName = order.customer?.lead 
                ? `${order.customer.lead.firstName} ${order.customer.lead.lastName || ''}`.trim()
                : 'Unknown';

            return {
                id: order.id,
                invoiceId: order.invoiceId || `INV-${order.id.toString().padStart(4, '0')}`,
                customer: customerName,
                customerEmail: order.customer?.lead?.email || '',
                customerPhone: order.customer?.lead?.phoneNumber || '',
                customerId: order.customer?.customerUniqueId || `CUST-${order.customer?.id}`,
                date: order.orderDate,
                dueDate: order.packageEnd,
                amount: order.totalAmount,
                status: order.isPaid ? 'paid' : (new Date(order.packageEnd) < new Date() ? 'overdue' : 'pending'),
                packageName: order.packagePrice?.packagePlanDetails?.planName || 'Package Renewal',
                items: order.items
            };
        });

        res.json({
            success: true,
            invoices: formattedInvoices,
            total,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit))
            }
        });
    } catch (err) {
        next(err);
    }
}

/**
 * Get Invoice Summary statistics
 */
async function getInvoiceSummary(req, res, next) {
    const prisma = req.prisma;
    try {
        const branchFilter = await getBranchFilter(req);

        const where = {
            isDeleted: false,
            customer: {
                ispId: req.ispId,
                ...branchFilter
            }
        };

        const orders = await prisma.customerOrderManagement.findMany({
            where,
            select: {
                isPaid: true,
                totalAmount: true,
                packageEnd: true
            }
        });

        let totalRevenue = 0;
        let pendingAmount = 0;
        let overdueAmount = 0;
        let paidAmount = 0;

        let pendingCount = 0;
        let overdueCount = 0;
        let paidCount = 0;

        const now = new Date();

        orders.forEach(order => {
            if (order.isPaid) {
                totalRevenue += order.totalAmount;
                paidAmount += order.totalAmount;
                paidCount++;
            } else {
                if (new Date(order.packageEnd) < now) {
                    overdueAmount += order.totalAmount;
                    overdueCount++;
                } else {
                    pendingAmount += order.totalAmount;
                    pendingCount++;
                }
            }
        });

        res.json({
            success: true,
            summary: {
                totalRevenue: {
                    value: totalRevenue,
                    count: paidCount
                },
                pending: {
                    value: pendingAmount,
                    count: pendingCount
                },
                overdue: {
                    value: overdueAmount,
                    count: overdueCount
                },
                paid: {
                    value: paidAmount,
                    count: paidCount
                }
            }
        });
    } catch (err) {
        next(err);
    }
}

/**
 * List Invoice Ranges
 */
async function listInvoiceRanges(req, res, next) {
    const prisma = req.prisma;
    try {
        const ranges = await prisma.branchInvoiceRange.findMany({
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            ranges
        });
    } catch (err) {
        next(err);
    }
}

/**
 * Create/Allocate a new invoice range for a branch
 */
async function createInvoiceRange(req, res, next) {
    const prisma = req.prisma;
    const { branchId, rangeStart, rangeEnd } = req.body;

    try {
        if (!branchId || !rangeStart || !rangeEnd) {
            return res.status(400).json({ error: 'branchId, rangeStart, and rangeEnd are required' });
        }

        const start = Number(rangeStart);
        const end = Number(rangeEnd);

        if (isNaN(start) || isNaN(end) || start > end) {
            return res.status(400).json({ error: 'Invalid range bounds' });
        }

        // Check if there is an overlapping range for this branch
        const overlapping = await prisma.branchInvoiceRange.findFirst({
            where: {
                branchId: Number(branchId),
                isActive: true,
                OR: [
                    { rangeStart: { lte: start }, rangeEnd: { gte: start } },
                    { rangeStart: { lte: end }, rangeEnd: { gte: end } },
                    { rangeStart: { gte: start }, rangeEnd: { lte: end } }
                ]
            }
        });

        if (overlapping) {
            return res.status(400).json({ error: 'Range overlaps with an existing active range for this branch' });
        }

        const newRange = await prisma.branchInvoiceRange.create({
            data: {
                branchId: Number(branchId),
                rangeStart: start,
                rangeEnd: end,
                current: start,
                isActive: true,
                updatedAt: new Date()
            }
        });

        res.status(201).json(newRange);
    } catch (err) {
        next(err);
    }
}

/**
 * Toggle an invoice range status (active/inactive)
 */
async function toggleInvoiceRange(req, res, next) {
    const prisma = req.prisma;
    const { id } = req.params;
    const { isActive } = req.body;

    try {
        const updated = await prisma.branchInvoiceRange.update({
            where: { id: Number(id) },
            data: {
                isActive: !!isActive,
                updatedAt: new Date()
            }
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete an invoice range
 */
async function deleteInvoiceRange(req, res, next) {
    const prisma = req.prisma;
    const { id } = req.params;

    try {
        await prisma.branchInvoiceRange.delete({
            where: { id: Number(id) }
        });

        res.json({ success: true, message: 'Invoice range deleted successfully' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    extendSubscription,
    togglePause,
    addAdjustmentItem,
    removeAdjustmentItem,
    payOrder,
    renewSubscription,
    generateManualInvoice,
    getBillingStats,
    listInvoices,
    getInvoiceSummary,
    listInvoiceRanges,
    createInvoiceRange,
    toggleInvoiceRange,
    deleteInvoiceRange
};
