const { getBranchFilter } = require('../utils/branchHelper');
const { RadiusClient } = require('../services/radiusClient');

function numeric(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isActiveRadiusSession(session) {
    return !session?.acctstoptime || session.acctstoptime === '0000-00-00 00:00:00';
}

function getSessionTimestamp(session) {
    const raw = session?.acctstarttime || session?.createdAt || session?.updatedAt;
    const date = raw ? new Date(raw) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function sessionTrafficMbps(session) {
    const inputOctets = numeric(session?.acctinputoctets || session?.inputOctets || session?.downloadBytes);
    const outputOctets = numeric(session?.acctoutputoctets || session?.outputOctets || session?.uploadBytes);
    const duration = Math.max(numeric(session?.acctsessiontime || session?.sessionTime || session?.durationSeconds), 1);

    return {
        download: Number(((inputOctets * 8) / duration / 1000000).toFixed(2)),
        upload: Number(((outputOctets * 8) / duration / 1000000).toFixed(2))
    };
}

async function getDashboardSummary(req, res, next) {
    try {
        const ispId = req.ispId;
        const branchFilter = await getBranchFilter(req);
        const now = new Date();
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextMonth = new Date(now);
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const customerWhere = { ispId, isDeleted: false, ...(branchFilter || {}) };
        const [totalCustomers, activeCustomers, totalLeads, openTickets, pendingInvoices, paidRevenue, expiringThisWeek, expiringThisMonth, expiredUsers] = await Promise.all([
            req.prisma.customer.count({ where: customerWhere }),
            req.prisma.customer.count({ where: { ...customerWhere, status: 'active' } }),
            req.prisma.lead.count({ where: { ispId, isDeleted: false, ...(branchFilter || {}) } }),
            req.prisma.ticket.count({ where: { ispId, isDeleted: false, status: { in: ['OPEN', 'IN_PROGRESS'] }, ...(branchFilter || {}) } }),
            req.prisma.customerOrderManagement.count({ where: { isDeleted: false, isPaid: false, customer: customerWhere } }),
            req.prisma.customerOrderManagement.aggregate({ where: { isDeleted: false, isPaid: true, customer: customerWhere }, _sum: { totalAmount: true } }),
            req.prisma.customerSubscription.count({ where: { isActive: true, planEnd: { gte: now, lte: nextWeek }, customer: customerWhere } }),
            req.prisma.customerSubscription.count({ where: { isActive: true, planEnd: { gte: now, lte: nextMonth }, customer: customerWhere } }),
            req.prisma.customerSubscription.count({ where: { isActive: true, planEnd: { lt: now }, customer: customerWhere } })
        ]);

        res.json({
            success: true,
            data: {
                totalCustomers,
                activeCustomers,
                inactiveCustomers: Math.max(totalCustomers - activeCustomers, 0),
                totalLeads,
                openTickets,
                pendingInvoices,
                totalRevenue: paidRevenue?._sum?.totalAmount || 0,
                expiringThisWeek,
                expiringThisMonth,
                expiredUsers
            }
        });
    } catch (err) {
        next(err);
    }
}

async function getRevenueOverview(req, res, next) {
    try {
        const ispId = req.ispId;
        const branchFilter = await getBranchFilter(req);
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const customerWhere = { ispId, isDeleted: false, ...(branchFilter || {}) };

        const orders = await req.prisma.customerOrderManagement.findMany({
            where: {
                isDeleted: false,
                isPaid: true,
                orderDate: { gte: start },
                customer: customerWhere
            },
            select: { totalAmount: true, orderDate: true }
        });

        const formatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
        const buckets = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            buckets.push({
                key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                month: formatter.format(d),
                revenue: 0
            });
        }
        const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));

        orders.forEach(order => {
            const d = new Date(order.orderDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const bucket = byKey.get(key);
            if (bucket) bucket.revenue += numeric(order.totalAmount);
        });

        res.json({ success: true, data: buckets.map(({ key, ...bucket }) => bucket) });
    } catch (err) {
        next(err);
    }
}

async function getTrafficOverview(req, res, next) {
    try {
        const range = String(req.query.range || '1h');
        const radius = await RadiusClient.create(req.ispId);
        const sessions = await radius.getActiveSessions();
        const active = Array.isArray(sessions) ? sessions.filter(isActiveRadiusSession) : [];
        const pointCount = range === '24h' ? 24 : range === '7d' ? 7 : 60;
        const now = new Date();
        const labels = [];
        const download = Array(pointCount).fill(0);
        const upload = Array(pointCount).fill(0);

        for (let i = pointCount - 1; i >= 0; i--) {
            const d = new Date(now);
            if (range === '24h') {
                d.setHours(now.getHours() - i, 0, 0, 0);
                labels.push(`${String(d.getHours()).padStart(2, '0')}:00`);
            } else if (range === '7d') {
                d.setDate(now.getDate() - i);
                labels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
            } else {
                d.setMinutes(now.getMinutes() - i, 0, 0);
                labels.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
            }
        }

        active.forEach(session => {
            const started = getSessionTimestamp(session);
            let index = pointCount - 1;
            if (range === '24h') {
                const diffHours = Math.floor((now - started) / 3600000);
                index = pointCount - 1 - Math.min(Math.max(diffHours, 0), pointCount - 1);
            } else if (range === '7d') {
                const diffDays = Math.floor((now - started) / 86400000);
                index = pointCount - 1 - Math.min(Math.max(diffDays, 0), pointCount - 1);
            } else {
                const diffMinutes = Math.floor((now - started) / 60000);
                index = pointCount - 1 - Math.min(Math.max(diffMinutes, 0), pointCount - 1);
            }

            const traffic = sessionTrafficMbps(session);
            download[index] += traffic.download;
            upload[index] += traffic.upload;
        });

        res.json({
            success: true,
            data: {
                source: 'radius',
                labels,
                download: download.map(value => Number(value.toFixed(2))),
                upload: upload.map(value => Number(value.toFixed(2))),
                sessions: active.length
            }
        });
    } catch (err) {
        res.json({
            success: true,
            data: {
                source: 'unavailable',
                labels: [],
                download: [],
                upload: [],
                sessions: 0,
                message: err.message || 'Radius traffic data unavailable'
            }
        });
    }
}

async function getSystemAlerts(req, res, next) {
    try {
        const ispId = req.ispId;
        const branchFilter = await getBranchFilter(req);
        const [tickets, services, offlineOlts, lowInventory] = await Promise.all([
            req.prisma.ticket.findMany({
                where: { ispId, isDeleted: false, status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: { in: ['HIGH', 'URGENT'] }, ...(branchFilter || {}) },
                select: { id: true, ticketNumber: true, title: true, priority: true, status: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
                take: 10
            }),
            req.prisma.iSPService.findMany({
                where: { ispId, isDeleted: false, OR: [{ isEnabled: false }, { isActive: false }] },
                include: { service: { select: { name: true, code: true } } },
                orderBy: { updatedAt: 'desc' },
                take: 10
            }),
            req.prisma.oLT.findMany({
                where: { ispId, isDeleted: false, status: { not: 'online' }, ...(branchFilter || {}) },
                select: { id: true, name: true, status: true, updatedAt: true },
                orderBy: { updatedAt: 'desc' },
                take: 10
            }),
            req.prisma.inventoryItem.findMany({
                where: { ispId, availableQty: { lte: 0 } },
                select: { id: true, name: true, serialNumber: true, updatedAt: true },
                orderBy: { updatedAt: 'desc' },
                take: 10
            }).catch(() => [])
        ]);

        const alerts = [
            ...tickets.map(ticket => ({
                id: `ticket-${ticket.id}`,
                title: `Ticket ${ticket.ticketNumber}`,
                description: ticket.title,
                timestamp: ticket.createdAt,
                severity: ticket.priority === 'URGENT' ? 'critical' : 'warning',
                status: 'active',
                source: 'ticket'
            })),
            ...services.map(service => ({
                id: `service-${service.id}`,
                title: `${service.service?.name || service.service?.code || 'Service'} disabled`,
                description: 'Service is configured but not active/enabled.',
                timestamp: service.updatedAt,
                severity: 'warning',
                status: service.isEnabled ? 'acknowledged' : 'active',
                source: 'service'
            })),
            ...offlineOlts.map(olt => ({
                id: `olt-${olt.id}`,
                title: `${olt.name} is ${olt.status}`,
                description: 'OLT is not reporting online status.',
                timestamp: olt.updatedAt,
                severity: 'critical',
                status: 'active',
                source: 'olt'
            })),
            ...lowInventory.map(item => ({
                id: `inventory-${item.id}`,
                title: `${item.name || item.serialNumber || 'Inventory item'} unavailable`,
                description: 'Available quantity is zero.',
                timestamp: item.updatedAt,
                severity: 'info',
                status: 'active',
                source: 'inventory'
            }))
        ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ success: true, data: alerts.slice(0, 25) });
    } catch (err) {
        next(err);
    }
}

/**
 * Get recent activity across multiple modules (Leads, Tickets, etc.)
 */
async function getRecentActivity(req, res, next) {
    try {
        const ispId = req.ispId;
        const branchFilter = await getBranchFilter(req);
        
        // Fetch recent Leads
        const recentLeads = await req.prisma.lead.findMany({
            where: {
                ispId,
                isDeleted: false,
                ...(branchFilter || {})
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                status: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
        });

        // Fetch recent Tickets
        const recentTickets = await req.prisma.ticket.findMany({
            where: {
                ispId,
                isDeleted: false,
                ...(branchFilter || {})
            },
            select: {
                id: true,
                title: true,
                ticketNumber: true,
                status: true,
                createdAt: true,
                priority: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
        });

        // Format activities
        const activities = [
            ...recentLeads.map(lead => ({
                id: `lead-${lead.id}`,
                title: 'New Lead',
                description: `${lead.firstName} ${lead.lastName} (Status: ${lead.status})`,
                timestamp: lead.createdAt,
                status: 'info',
                type: 'lead'
            })),
            ...recentTickets.map(ticket => ({
                id: `ticket-${ticket.id}`,
                title: `Ticket: ${ticket.ticketNumber}`,
                description: ticket.title,
                timestamp: ticket.createdAt,
                status: ticket.priority === 'HIGH' || ticket.priority === 'URGENT' ? 'warning' : 'success',
                type: 'ticket'
            }))
        ];

        // Sort by timestamp descending
        activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return res.json({
            success: true,
            data: activities.slice(0, 10)
        });
    } catch (err) {
        console.error('getRecentActivity error:', err);
        return next(err);
    }
}

module.exports = {
    getRecentActivity,
    getDashboardSummary,
    getRevenueOverview,
    getTrafficOverview,
    getSystemAlerts
};
