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

module.exports = {
    getAuditLogs,
    getDistinctActions
};
