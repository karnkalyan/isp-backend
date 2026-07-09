/**
 * Get system audit logs with pagination and filters
 */
async function getAuditLogs(req, res, next) {
    try {
        const { page = 1, limit = 50, userId, action, search, startDate, endDate } = req.query;

        const where = {
            ...(userId ? { userId: parseInt(userId) } : {}),
            ...(action ? { action } : {}),
            ...(startDate || endDate ? {
                timestamp: {
                    ...(startDate ? { gte: new Date(startDate) } : {}),
                    ...(endDate ? { lte: new Date(endDate) } : {})
                }
            } : {}),
            ...(search ? {
                OR: [
                    { action: { contains: search, mode: 'insensitive' } },
                    { details: { contains: search, mode: 'insensitive' } },
                    { ip: { contains: search, mode: 'insensitive' } },
                    { browser: { contains: search, mode: 'insensitive' } }
                ]
            } : {})
        };

        const parsedPage = parseInt(page);
        const parsedLimit = parseInt(limit);

        const [logs, total] = await Promise.all([
            req.prisma.auditLog.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: { select: { name: true } }
                        }
                    }
                },
                orderBy: { timestamp: 'desc' },
                take: parsedLimit,
                skip: (parsedPage - 1) * parsedLimit
            }),
            req.prisma.auditLog.count({ where })
        ]);

        res.json({
            data: logs,
            pagination: {
                total,
                page: parsedPage,
                limit: parsedLimit,
                totalPages: Math.ceil(total / parsedLimit)
            }
        });
    } catch (err) {
        next(err);
    }
}

/**
 * Get distinct actions for filtering dropdowns
 */
async function getDistinctActions(req, res, next) {
    try {
        const actions = await req.prisma.auditLog.findMany({
            select: { action: true },
            distinct: ['action']
        });

        res.json(actions.map(a => a.action));
    } catch (err) {
        next(err);
    }
}

async function getCustomerAuditLogs(req, res, next) {
    try {
        const customerId = parseInt(req.params.customerId);
        if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customer ID" });

        const customer = await req.prisma.customer.findUnique({
            where: { id: customerId },
            select: { leadId: true }
        });

        const leadId = customer?.leadId;

        const OR = [
            { details: { contains: `"id":${customerId}` } },
            { details: { contains: `"id": ${customerId}` } },
            { details: { contains: `"customerId":${customerId}` } },
            { details: { contains: `"customerId": ${customerId}` } }
        ];

        if (leadId) {
            OR.push(
                { details: { contains: `"id":${leadId}` } },
                { details: { contains: `"id": ${leadId}` } },
                { details: { contains: `"leadId":${leadId}` } },
                { details: { contains: `"leadId": ${leadId}` } }
            );
        }

        const logs = await req.prisma.auditLog.findMany({
            where: { OR },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: { select: { name: true } }
                    }
                }
            },
            orderBy: { timestamp: 'desc' }
        });

        res.json({ success: true, data: logs });
    } catch (err) {
        next(err);
    }
}

async function getLeadAuditLogs(req, res, next) {
    try {
        const leadId = parseInt(req.params.leadId);
        if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });

        const OR = [
            { details: { contains: `"id":${leadId}` } },
            { details: { contains: `"id": ${leadId}` } },
            { details: { contains: `"leadId":${leadId}` } },
            { details: { contains: `"leadId": ${leadId}` } }
        ];

        const logs = await req.prisma.auditLog.findMany({
            where: { OR },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: { select: { name: true } }
                    }
                }
            },
            orderBy: { timestamp: 'desc' }
        });

        res.json({ success: true, data: logs });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getAuditLogs,
    getDistinctActions,
    getCustomerAuditLogs,
    getLeadAuditLogs
};
