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
                    { action: { contains: search } },
                    { details: { contains: search } },
                    { ip: { contains: search } },
                    { browser: { contains: search } }
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

        if (!customer) return res.status(404).json({ error: "Customer not found" });
        const leadId = customer?.leadId;

        // Fetch all task IDs related to this customer
        const tasks = await req.prisma.task.findMany({
            where: { customerId },
            select: { id: true }
        });
        const taskIds = tasks.map(t => t.id);

        // Fetch all ticket IDs related to this customer or lead
        const tickets = await req.prisma.ticket.findMany({
            where: {
                OR: [
                    { customerId },
                    ...(leadId ? [{ leadId }] : [])
                ]
            },
            select: { id: true }
        });
        const ticketIds = tickets.map(t => t.id);

        // Fetch all followup IDs related to the lead
        let followupIds = [];
        if (leadId) {
            const followups = await req.prisma.followUp.findMany({
                where: { leadId },
                select: { id: true }
            });
            followupIds = followups.map(f => f.id);
        }

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

        // Combine all DB candidate search filters
        const OR = [
            ...buildExactIdFilters("id", customerId),
            ...buildExactIdFilters("customerId", customerId),
            { details: { contains: `/customers/${customerId}` } },
            { details: { contains: `/customer/${customerId}` } }
        ];

        if (leadId) {
            OR.push(
                ...buildExactIdFilters("id", leadId),
                ...buildExactIdFilters("leadId", leadId),
                { details: { contains: `/leads/${leadId}` } },
                { details: { contains: `/lead/${leadId}` } }
            );
        }

        taskIds.forEach(id => {
            OR.push(
                ...buildExactIdFilters("id", id),
                { details: { contains: `/tasks/${id}` } },
                { details: { contains: `/task/${id}` } }
            );
        });

        ticketIds.forEach(id => {
            OR.push(
                ...buildExactIdFilters("id", id),
                { details: { contains: `/tickets/${id}` } },
                { details: { contains: `/ticket/${id}` } }
            );
        });

        followupIds.forEach(id => {
            OR.push(
                ...buildExactIdFilters("id", id),
                { details: { contains: `/followups/${id}` } },
                { details: { contains: `/followup/${id}` } }
            );
        });

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

        const urlMatchesId = (url, pathSegment, id) => {
            if (!url) return false;
            const regex = new RegExp(`/${pathSegment}/${id}(?:/|\\?|$)`, 'i');
            return regex.test(url);
        };

        const filteredLogs = logs.filter(log => {
            let details = null;
            try {
                details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            } catch (e) {
                return false;
            }
            if (!details) return false;

            const actionUpper = log.action.toUpperCase();

            // 1. Check Customer direct attributes
            if (details.customerId !== undefined && String(details.customerId) === String(customerId)) {
                return true;
            }
            if (actionUpper.startsWith('CUSTOMER') && !actionUpper.startsWith('CUSTOMER_TYPE') && !actionUpper.startsWith('CUSTOMER_GROUP')) {
                if (details.id !== undefined && String(details.id) === String(customerId)) {
                    return true;
                }
            }
            if (urlMatchesId(details.url, 'customers', customerId) || urlMatchesId(details.url, 'customer', customerId)) {
                return true;
            }

            // 2. Check Lead direct attributes (if converted)
            if (leadId) {
                if (details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                    return true;
                }
                if (actionUpper.startsWith('LEAD')) {
                    if (details.id !== undefined && String(details.id) === String(leadId)) {
                        return true;
                    }
                }
                if (urlMatchesId(details.url, 'leads', leadId) || urlMatchesId(details.url, 'lead', leadId)) {
                    return true;
                }
            }

            // 3. Check Tasks
            if (actionUpper.includes('TASK')) {
                if (details.customerId !== undefined && String(details.customerId) === String(customerId)) {
                    return true;
                }
                if (details.id !== undefined && taskIds.includes(Number(details.id))) {
                    return true;
                }
                if (taskIds.some(tid => urlMatchesId(details.url, 'tasks', tid) || urlMatchesId(details.url, 'task', tid))) {
                    return true;
                }
            }

            // 4. Check Tickets
            if (actionUpper.includes('TICKET')) {
                if (details.customerId !== undefined && String(details.customerId) === String(customerId)) {
                    return true;
                }
                if (leadId && details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                    return true;
                }
                if (details.id !== undefined && ticketIds.includes(Number(details.id))) {
                    return true;
                }
                if (ticketIds.some(tid => urlMatchesId(details.url, 'tickets', tid) || urlMatchesId(details.url, 'ticket', tid))) {
                    return true;
                }
            }

            // 5. Check FollowUps
            if (actionUpper.includes('FOLLOWUP')) {
                if (leadId && details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                    return true;
                }
                if (details.id !== undefined && followupIds.includes(Number(details.id))) {
                    return true;
                }
                if (followupIds.some(fid => urlMatchesId(details.url, 'followups', fid) || urlMatchesId(details.url, 'followup', fid))) {
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

        // Fetch all ticket IDs related to this lead
        const tickets = await req.prisma.ticket.findMany({
            where: { leadId },
            select: { id: true }
        });
        const ticketIds = tickets.map(t => t.id);

        // Fetch all followup IDs related to this lead
        const followups = await req.prisma.followUp.findMany({
            where: { leadId },
            select: { id: true }
        });
        const followupIds = followups.map(f => f.id);

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
            ...buildExactIdFilters("leadId", leadId),
            { details: { contains: `/leads/${leadId}` } },
            { details: { contains: `/lead/${leadId}` } }
        ];

        ticketIds.forEach(id => {
            OR.push(
                ...buildExactIdFilters("id", id),
                { details: { contains: `/tickets/${id}` } },
                { details: { contains: `/ticket/${id}` } }
            );
        });

        followupIds.forEach(id => {
            OR.push(
                ...buildExactIdFilters("id", id),
                { details: { contains: `/followups/${id}` } },
                { details: { contains: `/followup/${id}` } }
            );
        });

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

        const urlMatchesId = (url, pathSegment, id) => {
            if (!url) return false;
            const regex = new RegExp(`/${pathSegment}/${id}(?:/|\\?|$)`, 'i');
            return regex.test(url);
        };

        const filteredLogs = logs.filter(log => {
            let details = null;
            try {
                details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
            } catch (e) {
                return false;
            }
            if (!details) return false;

            const actionUpper = log.action.toUpperCase();

            // 1. Check Lead direct attributes
            if (details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                return true;
            }
            if (actionUpper.startsWith('LEAD')) {
                if (details.id !== undefined && String(details.id) === String(leadId)) {
                    return true;
                }
            }
            if (urlMatchesId(details.url, 'leads', leadId) || urlMatchesId(details.url, 'lead', leadId)) {
                return true;
            }

            // 2. Check Tickets
            if (actionUpper.includes('TICKET')) {
                if (details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                    return true;
                }
                if (details.id !== undefined && ticketIds.includes(Number(details.id))) {
                    return true;
                }
                if (ticketIds.some(tid => urlMatchesId(details.url, 'tickets', tid) || urlMatchesId(details.url, 'ticket', tid))) {
                    return true;
                }
            }

            // 3. Check FollowUps
            if (actionUpper.includes('FOLLOWUP')) {
                if (details.leadId !== undefined && String(details.leadId) === String(leadId)) {
                    return true;
                }
                if (details.id !== undefined && followupIds.includes(Number(details.id))) {
                    return true;
                }
                if (followupIds.some(fid => urlMatchesId(details.url, 'followups', fid) || urlMatchesId(details.url, 'followup', fid))) {
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

module.exports = {
    getAuditLogs,
    getDistinctActions,
    getCustomerAuditLogs,
    getLeadAuditLogs
};
