const { getBranchFilter } = require('../utils/branchHelper');

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
    getRecentActivity
};
