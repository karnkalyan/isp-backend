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

        const buildExactIdFilters = (field, id) => [
            { details: { contains: `"${field}":${id},` } },
            { details: { contains: `"${field}":${id}}` } },
            { details: { contains: `"${field}": ${id},` } },
            { details: { contains: `"${field}": ${id}}` } },
            { details: { contains: `"${field}":"${id}",` } },
            { details: { contains: `"${field}":"${id}"}` } },
            { details: { contains: `"${field}": "${id}",` } },
            { details: { contains: `"${field}": "${id}"}` } }
        ];

        const OR = [
            ...buildExactIdFilters("id", customerId),
            ...buildExactIdFilters("customerId", customerId)
        ];

        if (leadId) {
            OR.push(
                ...buildExactIdFilters("id", leadId),
                ...buildExactIdFilters("leadId", leadId)
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

        // 100% precise post-filtering in JS by parsing JSON details
        const filteredLogs = logs.filter(log => {
            let details = null;
            try {
                details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            } catch (e) {
                return false;
            }
            
            if (!details) return false;

            // 1. Explicit customerId match
            if (details.customerId !== undefined && String(details.customerId) === String(customerId)) {
                return true;
            }

            // 2. Customer profile action and id matches customerId
            const customerProfileActions = [
                'CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'CUSTOMER_DELETE', 
                'CUSTOMER_STATUS_CHANGE', 'CUSTOMER_PASSWORD_CHANGE', 
                'CUSTOMER_RENEW', 'CUSTOMER_MAC_RESET', 'SESSION_DISCONNECT'
            ];
            const actionUpper = log.action.toUpperCase();
            if (customerProfileActions.some(act => actionUpper.startsWith(act)) && 
                details.id !== undefined && String(details.id) === String(customerId)) {
                return true;
            }

            // 3. Explicit leadId match
            if (leadId && details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                return true;
            }

            // 4. Lead profile action and id matches leadId
            const leadProfileActions = [
                'LEAD_CREATE', 'LEAD_UPDATE', 'LEAD_DELETE', 
                'LEAD_STATUS_CHANGE', 'LEAD_CONVERT'
            ];
            if (leadId && leadProfileActions.some(act => actionUpper.startsWith(act)) && 
                details.id !== undefined && String(details.id) === String(leadId)) {
                return true;
            }

            // 5. Task action matching customerId or leadId
            if (actionUpper.includes('TASK')) {
                if (details.customerId !== undefined && String(details.customerId) === String(customerId)) {
                    return true;
                }
                if (leadId && details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                    return true;
                }
            }

            return false;
        });

        res.json({ success: true, data: filteredLogs });
    } catch (err) {
        next(err);
    }
}

async function getLeadAuditLogs(req, res, next) {
    try {
        const leadId = parseInt(req.params.leadId);
        if (isNaN(leadId)) return res.status(400).json({ error: "Invalid lead ID" });

        const buildExactIdFilters = (field, id) => [
            { details: { contains: `"${field}":${id},` } },
            { details: { contains: `"${field}":${id}}` } },
            { details: { contains: `"${field}": ${id},` } },
            { details: { contains: `"${field}": ${id}}` } },
            { details: { contains: `"${field}":"${id}",` } },
            { details: { contains: `"${field}":"${id}"}` } },
            { details: { contains: `"${field}": "${id}",` } },
            { details: { contains: `"${field}": "${id}"}` } }
        ];

        const OR = [
            ...buildExactIdFilters("id", leadId),
            ...buildExactIdFilters("leadId", leadId)
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

        // 100% precise post-filtering in JS by parsing JSON details
        const filteredLogs = logs.filter(log => {
            let details = null;
            try {
                details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            } catch (e) {
                return false;
            }
            
            if (!details) return false;

            const actionUpper = log.action.toUpperCase();

            // 1. Explicit leadId match
            if (details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                return true;
            }

            // 2. Lead profile action and id matches leadId
            const leadProfileActions = [
                'LEAD_CREATE', 'LEAD_UPDATE', 'LEAD_DELETE', 
                'LEAD_STATUS_CHANGE', 'LEAD_CONVERT'
            ];
            if (leadProfileActions.some(act => actionUpper.startsWith(act)) && 
                details.id !== undefined && String(details.id) === String(leadId)) {
                return true;
            }

            // 3. Task action and leadId matches leadId
            if (actionUpper.includes('TASK') && details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                return true;
            }

            return false;
        });

        res.json({ success: true, data: filteredLogs });
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
