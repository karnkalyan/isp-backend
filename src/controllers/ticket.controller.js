const prisma = require('../../prisma/client');

// Reusable customer include that resolves name via lead
const customerInclude = {
    select: {
        id: true,
        customerUniqueId: true,
        lead: {
            select: {
                firstName: true,
                lastName: true,
                email: true,
                phoneNumber: true,
            }
        }
    }
};

const leadInclude = {
    select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
    }
};

const customerIncludeBasic = {
    select: {
        id: true,
        customerUniqueId: true,
        lead: {
            select: {
                firstName: true,
                lastName: true,
                email: true,
            }
        }
    }
};

/**
 * Transform customer data to flatten lead fields for frontend consumption
 */
function flattenCustomer(ticket) {
    if (!ticket) return ticket;
    
    let subject = null;
    if (ticket.customer) {
        subject = {
            type: 'CUSTOMER',
            id: ticket.customer.id,
            uniqueId: ticket.customer.customerUniqueId,
            firstName: ticket.customer.lead?.firstName || '',
            lastName: ticket.customer.lead?.lastName || '',
            email: ticket.customer.lead?.email || '',
            phoneNumber: ticket.customer.lead?.phoneNumber || '',
        };
    } else if (ticket.lead) {
        subject = {
            type: 'LEAD',
            id: ticket.lead.id,
            uniqueId: `LEAD-${ticket.lead.id}`,
            firstName: ticket.lead.firstName || '',
            lastName: ticket.lead.lastName || '',
            email: ticket.lead.email || '',
            phoneNumber: ticket.lead.phoneNumber || '',
        };
    }

    const { customer, lead, ...rest } = ticket;
    return {
        ...rest,
        subject
    };
}

function flattenCustomerList(tickets) {
    return tickets.map(flattenCustomer);
}

/**
 * Create a new ticket
 */
async function createTicket(req, res, next) {
    try {
        let { title, description, priority, category, customerId, leadId, assignedToId, targetBranchId, notifyEmail } = req.body;
        const ispId = req.ispId;
        let branchId = targetBranchId ? parseInt(targetBranchId) : (req.branchId || null);
        const createdById = req.user?.id;

        // If user is a customer, auto-assign their info and branch
        if (req.user && req.user.role === 'Customer') {
            const customer = await req.prisma.customer.findFirst({
                where: { lead: { email: req.user.email } },
                select: { id: true, branchId: true }
            });
            if (customer) {
                customerId = customer.id;
                // Auto assign to their branch if not specifically targeted
                if (!branchId) branchId = customer.branchId;
            }
        }

        if (!customerId && !leadId) {
            return res.status(400).json({ error: 'Select a lead or customer for the ticket.' });
        }

        if (!branchId) {
            if (customerId) {
                const customer = await req.prisma.customer.findFirst({
                    where: { id: parseInt(customerId), ispId, isDeleted: false },
                    select: { branchId: true, subBranchId: true }
                });
                branchId = customer?.subBranchId || customer?.branchId || null;
            } else if (leadId) {
                const lead = await req.prisma.lead.findFirst({
                    where: { id: parseInt(leadId), ispId, isDeleted: false },
                    select: { branchId: true }
                });
                branchId = lead?.branchId || null;
            }
        }

        if (assignedToId) {
            const assignee = await req.prisma.user.findFirst({
                where: {
                    id: parseInt(assignedToId),
                    ispId,
                    isDeleted: false,
                    ...(branchId ? {
                        OR: [
                            { branchId },
                            { userBranches: { some: { branchId } } }
                        ]
                    } : {})
                },
                select: { id: true }
            });
            if (!assignee) {
                return res.status(400).json({ error: 'Assigned user must belong to the ticket branch.' });
            }
        }

        // Generate ticket number
        const count = await req.prisma.ticket.count({ where: { ispId } });
        const ticketNumber = `TKT-${String(count + 1).padStart(5, '0')}`;

        const ticket = await req.prisma.ticket.create({
            data: {
                ticketNumber,
                title,
                description,
                priority: priority || 'MEDIUM',
                category,
                customerId: customerId ? parseInt(customerId) : null,
                leadId: leadId ? parseInt(leadId) : null,
                assignedToId: assignedToId ? parseInt(assignedToId) : null,
                createdById,
                ispId,
                branchId,
                updatedAt: new Date(),
            },
            include: {
                customer: customerIncludeBasic,
                lead: leadInclude,
                assignedTo: { select: { id: true, name: true, email: true } },
                createdBy: { select: { id: true, name: true, email: true } },
                branch: { select: { id: true, name: true } },
            }
        });

        // Emit WebSocket notification
        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            wsManager.emitEvent('system.notification', {
                ispId,
                type: 'info',
                title: 'New Ticket Created',
                message: `Ticket ${ticketNumber}: ${title}`,
            });
        }

        // Trigger automated SMS
        const smsHelper = require('../utils/smsHelper');
        const subject = flattenCustomer(ticket).subject;
        if (subject && subject.phoneNumber) {
            await smsHelper.sendEventSms(ispId, 'ticket_creation', {
                firstName: subject.firstName,
                lastName: subject.lastName,
                phoneNumber: subject.phoneNumber,
                ticketNumber: ticketNumber,
                title: title
            });
        }

        // Email Notification to Customer/Branch/Assignee if enabled (default true)
        const shouldNotify = notifyEmail !== false;

        if (shouldNotify) {
            // 1) Email Notification to customer
            if (subject && subject.email) {
                try {
                    const mailHelper = require('../utils/mailHelper');
                    await mailHelper.sendMail(ispId, {
                        to: subject.email,
                        subject: `Ticket Created: ${ticketNumber}`,
                        html: `<p>Dear ${subject.firstName},</p><p>A new support ticket (<b>${ticketNumber}</b>) has been created for you.</p><p><b>Title:</b> ${title}</p><p>We will look into this and get back to you shortly.</p>`
                    });
                } catch (e) {
                    console.error("Failed to send ticket email notification to customer:", e);
                }
            }

            // 2) Email Notification to Assignee
            if (ticket.assignedTo && ticket.assignedTo.email) {
                try {
                    const mailHelper = require('../utils/mailHelper');
                    await mailHelper.sendMail(ispId, {
                        to: ticket.assignedTo.email,
                        subject: `Ticket Assigned: ${ticketNumber}`,
                        html: `<p>Dear ${ticket.assignedTo.name},</p><p>A support ticket (<b>${ticketNumber}</b>) has been assigned to you.</p><p><b>Title:</b> ${title}</p><p><b>Description:</b> ${description || ''}</p><p>Please review and take action.</p>`
                    });
                } catch (e) {
                    console.error("Failed to send ticket assignee email notification:", e);
                }
            }

            // 3) Email Notification to branch support team
            if (branchId) {
                try {
                    const branchUsers = await req.prisma.user.findMany({
                        where: {
                            ispId,
                            isDeleted: false,
                            OR: [
                                { branchId },
                                { userBranches: { some: { branchId } } }
                            ],
                            role: {
                                isActive: true,
                            }
                        },
                        select: { email: true, name: true, role: { select: { name: true } } }
                    });

                    const supportRoles = ['support agent', 'support manager', 'technician', 'administrator', 'admin', 'branch admin', 'sub branch admin'];
                    const filteredUsers = branchUsers.filter(u => u.role && supportRoles.includes(String(u.role.name).toLowerCase()));

                    if (filteredUsers.length > 0) {
                        const mailHelper = require('../utils/mailHelper');
                        for (const user of filteredUsers) {
                            if (user.email) {
                                await mailHelper.sendMail(ispId, {
                                    to: user.email,
                                    subject: `New Ticket Created in your Branch: ${ticketNumber}`,
                                    html: `<p>Dear ${user.name},</p><p>A new support ticket (<b>${ticketNumber}</b>) has been created in your branch.</p><p><b>Title:</b> ${title}</p><p><b>Description:</b> ${description || ''}</p><p>Please review and take action.</p>`
                                }).catch(err => console.error(`Error sending support notify email to ${user.email}:`, err));
                            }
                        }
                    }
                } catch (e) {
                    console.error("Failed to send branch support team email notifications:", e);
                }
            }
        }

        res.status(201).json(flattenCustomer(ticket));

    } catch (err) {
        next(err);
    }
}

/**
 * Get all tickets with pagination and filters
 */
async function getTickets(req, res, next) {
    try {
        const ispId = req.ispId;
        const branchId = req.branchId || null;
        const { page = 1, limit = 20, status, priority, search, customerId } = req.query;

        const where = {
            ispId,
            isDeleted: false,
            AND: [
                {
                    OR: [
                        { customerId: { not: null } },
                        { leadId: { not: null } }
                    ]
                }
            ],
            ...(branchId ? { branchId } : {}),
            ...(status ? { status } : {}),
            ...(priority ? { priority } : {}),
            ...(customerId ? { customerId: parseInt(customerId) } : {}),
            ...(search ? {
                OR: [
                    { title: { contains: search } },
                    { ticketNumber: { contains: search } },
                    { description: { contains: search } },
                ]
            } : {}),
        };

        const roleName = String(req.user?.role || '').toLowerCase();
        const isAdmin = roleName === 'administrator' || roleName === 'admin' || roleName === 'isp admin';

        if (!isAdmin) {
            const userId = req.user?.id;
            let categories = [];

            if (roleName.includes('tech') || roleName.includes('field')) {
                categories = ['technical', 'connectivity'];
            } else if (roleName.includes('support')) {
                categories = null; // Sees all unassigned
            } else if (roleName.includes('marketing') || roleName.includes('sales')) {
                categories = ['billing', 'account'];
            }

            if (categories === null) {
                where.AND.push({
                    OR: [
                        { assignedToId: userId },
                        { assignedToId: null }
                    ]
                });
            } else if (categories.length > 0) {
                where.AND.push({
                    OR: [
                        { assignedToId: userId },
                        {
                            AND: [
                                { assignedToId: null },
                                { category: { in: categories } }
                            ]
                        }
                    ]
                });
            } else {
                where.AND.push({
                    assignedToId: userId
                });
            }
        }

        const [tickets, total] = await Promise.all([
            req.prisma.ticket.findMany({
                where,
                include: {
                    customer: customerIncludeBasic,
                    lead: leadInclude,
                    assignedTo: { select: { id: true, name: true, email: true } },
                    createdBy: { select: { id: true, name: true, email: true } },
                    branch: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit),
            }),
            req.prisma.ticket.count({ where }),
        ]);

        const commentCounts = await req.prisma.ticketComment.groupBy({
            by: ['ticketId'],
            where: { ticketId: { in: tickets.map(ticket => ticket.id) } },
            _count: true
        });
        const commentCountByTicket = new Map(commentCounts.map(row => [row.ticketId, row._count]));
        tickets.forEach(ticket => {
            ticket._count = { comments: commentCountByTicket.get(ticket.id) || 0 };
        });

        res.json({
            data: flattenCustomerList(tickets),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            }
        });
    } catch (err) {
        next(err);
    }
}

/**
 * Get single ticket by ID
 */
async function getTicketById(req, res, next) {
    try {
        const { id } = req.params;
        const ticket = await req.prisma.ticket.findUnique({
            where: { id: parseInt(id) },
            include: {
                customer: customerInclude,
                lead: leadInclude,
                assignedTo: { select: { id: true, name: true, email: true } },
                createdBy: { select: { id: true, name: true, email: true } },
                branch: { select: { id: true, name: true } },
            },
        });

        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        
        let comments = await req.prisma.ticketComment.findMany({
            where: { ticketId: ticket.id },
            orderBy: { createdAt: 'asc' },
        });

        // Filter comments if user is a customer
        const roleName = String(req.user?.role || '').toLowerCase();
        if (roleName === 'customer') {
            const visibilitySetting = await req.prisma.iSPSettings.findUnique({
                where: { key: 'show_ticket_comments_to_customer' }
            });
            const showToCustomer = visibilitySetting ? (visibilitySetting.value === 'true' || visibilitySetting.value === 'Enable') : false;
            
            if (!showToCustomer) {
                comments = comments.filter(c => !c.isInternal);
            }
        }

        const userIds = [...new Set(comments.map(comment => comment.userId).filter(Boolean))];
        const users = userIds.length
            ? await req.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, name: true, email: true }
            })
            : [];
        const userById = new Map(users.map(user => [user.id, user]));
        ticket.comments = comments.map(comment => ({ ...comment, user: userById.get(comment.userId) || null }));
        res.json(flattenCustomer(ticket));
    } catch (err) {
        next(err);
    }
}

/**
 * Update a ticket
 */
async function updateTicket(req, res, next) {
    try {
        const { id } = req.params;
        const { title, description, status, priority, category, assignedToId, resolution } = req.body;

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (status !== undefined) updateData.status = status;
        if (priority !== undefined) updateData.priority = priority;
        if (category !== undefined) updateData.category = category;
        if (assignedToId !== undefined) updateData.assignedToId = assignedToId ? parseInt(assignedToId) : null;
        if (resolution !== undefined) updateData.resolution = resolution;

        if (status === 'RESOLVED' || status === 'CLOSED') {
            updateData.resolvedAt = new Date();
        }

        const ticket = await req.prisma.ticket.update({
            where: { id: parseInt(id) },
            data: updateData,
            include: {
                customer: customerIncludeBasic,
                assignedTo: { select: { id: true, name: true, email: true } },
            },
        });

        // Emit WebSocket notification
        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            wsManager.emitEvent('system.notification', {
                ispId: ticket.ispId,
                type: 'info',
                title: 'Ticket Updated',
                message: `Ticket ${ticket.ticketNumber} status changed to ${status || 'updated'}`,
            });
        }

        res.json(flattenCustomer(ticket));
    } catch (err) {
        next(err);
    }
}

/**
 * Add a comment to a ticket
 */
async function addComment(req, res, next) {
    try {
        const { id } = req.params;
        const { content, isInternal } = req.body;
        const userId = req.user?.id;

        if (!content || !String(content).trim()) {
            return res.status(400).json({ error: 'Comment content is required' });
        }

        const ticket = await req.prisma.ticket.findFirst({
            where: { id: parseInt(id), ispId: req.ispId, isDeleted: false },
            select: { id: true, assignedToId: true, createdById: true }
        });

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        if (req.user?.permissions?.includes('tickets_read_self') && !req.user.permissions.includes('tickets_read')) {
            const canComment = ticket.assignedToId === userId || ticket.createdById === userId;
            if (!canComment) {
                return res.status(403).json({ error: 'Access Denied' });
            }
        }

        const comment = await req.prisma.ticketComment.create({
            data: {
                ticketId: parseInt(id),
                userId,
                content: String(content).trim(),
                isInternal: isInternal || false,
            }
        });

        const user = userId
            ? await req.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, name: true, email: true }
            })
            : null;

        // Update ticket's updatedAt
        await req.prisma.ticket.update({
            where: { id: parseInt(id) },
            data: { updatedAt: new Date() },
        });

        res.status(201).json({ ...comment, user });
    } catch (err) {
        next(err);
    }
}

/**
 * Get tickets by customer ID
 */
async function getTicketsByCustomer(req, res, next) {
    try {
        const { customerId } = req.params;
        const tickets = await req.prisma.ticket.findMany({
            where: {
                customerId: parseInt(customerId),
                isDeleted: false,
            },
            include: {
                assignedTo: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const commentCounts = tickets.length
            ? await req.prisma.ticketComment.groupBy({
                by: ['ticketId'],
                where: { ticketId: { in: tickets.map(ticket => ticket.id) } },
                _count: true
            })
            : [];
        const commentCountByTicket = new Map(commentCounts.map(row => [row.ticketId, row._count]));

        res.json(tickets.map(ticket => ({
            ...ticket,
            _count: { comments: commentCountByTicket.get(ticket.id) || 0 }
        })));
    } catch (err) {
        next(err);
    }
}

module.exports = {
    createTicket,
    getTickets,
    getTicketById,
    updateTicket,
    addComment,
    getTicketsByCustomer,
};
