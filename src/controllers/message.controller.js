const express = require('express');
const { getAllSubBranchIds } = require('../utils/branchHelper');

const SUPPORT_ROLE_KEYWORDS = [
    'admin',
    'support',
    'technic',
    'manager'
];

const SUPPORT_ROLE_NAMES = [
    'Administrator',
    'administrator',
    'admin',
    'isp_admin',
    'Global Manager',
    'global manager',
    'Global Support',
    'global support',
    'Global Technical',
    'global technical',
    'Global Marketing',
    'global marketing',
    'Branch Admin',
    'branch admin',
    'Sub Branch Admin',
    'sub branch admin',
    'Branch Support',
    'branch support',
    'Branch Technical',
    'branch technical',
    'support',
    'support agent',
    'support manager',
    'technician'
];

function normalizeRoleName(role) {
    return String(typeof role === 'string' ? role : role?.name || '').toLowerCase();
}

function isCustomerRole(role) {
    const name = normalizeRoleName(role);
    return name.includes('customer');
}

function isSupportRole(role) {
    const name = normalizeRoleName(role);
    if (!name || isCustomerRole(role)) return false;
    return SUPPORT_ROLE_KEYWORDS.some(keyword => name.includes(keyword)) ||
        SUPPORT_ROLE_NAMES.some(supportRole => name === supportRole.toLowerCase());
}

function isGlobalRole(role) {
    const name = normalizeRoleName(role);
    return name === 'administrator' || name === 'admin' || name === 'isp_admin' ||
           name === 'global manager' || name.startsWith('global ');
}

const MESSAGE_INCLUDE = {
    branch: { select: { id: true, name: true, code: true } },
    sender: {
        select: {
            id: true,
            name: true,
            email: true,
            branchId: true,
            role: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true, code: true } },
            customer: {
                select: {
                    id: true,
                    customerUniqueId: true,
                    branchId: true,
                    branch: { select: { id: true, name: true, code: true } },
                    lead: {
                        select: {
                            phoneNumber: true,
                            email: true,
                            address: true,
                            street: true,
                            district: true,
                            branch: { select: { id: true, name: true, code: true } }
                        }
                    }
                }
            }
        }
    },
    receiver: {
        select: {
            id: true,
            name: true,
            email: true,
            branchId: true,
            role: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true, code: true } },
            customer: {
                select: {
                    id: true,
                    customerUniqueId: true,
                    branchId: true,
                    branch: { select: { id: true, name: true, code: true } },
                    lead: {
                        select: {
                            phoneNumber: true,
                            email: true,
                            address: true,
                            street: true,
                            district: true,
                            branch: { select: { id: true, name: true, code: true } }
                        }
                    }
                }
            }
        }
    }
};

// Get users the current account can chat with
async function getRecipients(req, res, next) {
    try {
        const userId = req.user.id;
        const ispId = req.ispId;
        const customerId = req.user.customerId || null;
        const userIsCustomer = Boolean(customerId) || isCustomerRole(req.user.role);

        let branchIds = [req.user.branchId, req.user.subBranchId].filter(Boolean).map(Number);
        if (customerId) {
            const customer = await req.prisma.customer.findFirst({
                where: { id: Number(customerId), ispId, isDeleted: false },
                select: { branchId: true, subBranchId: true }
            });
            branchIds = [customer?.branchId, customer?.subBranchId, ...branchIds]
                .filter(Boolean)
                .map(Number);
        }
        branchIds = [...new Set(branchIds)];

        const messageParticipants = await req.prisma.message.findMany({
            where: {
                ispId,
                isDeleted: false,
                OR: [{ receiverId: userId }, { senderId: userId }]
            },
            select: { senderId: true, receiverId: true },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        const participantIds = [...new Set(messageParticipants.flatMap(message => [message.senderId, message.receiverId]))]
            .filter(id => id && id !== userId);

        let users = await req.prisma.user.findMany({
            where: {
                ispId,
                isDeleted: false,
                id: { not: userId },
                status: 'active',
                role: { name: { notIn: ['Customer', 'customer', 'Customers', 'customers'] } }
            },
            select: {
                id: true,
                name: true,
                email: true,
                branchId: true,
                role: { select: { name: true } },
                branch: { select: { id: true, name: true, code: true } }
            },
            orderBy: { name: 'asc' },
            take: 100
        });

        users = users.filter(user => {
            if (participantIds.includes(user.id)) return true;
            if (isSupportRole(user.role)) {
                // Global roles are always accessible
                if (isGlobalRole(user.role)) return true;
                // If branchIds specified, allow staff of that branch
                if (branchIds.length > 0 && user.branchId && branchIds.includes(user.branchId)) return true;
                if (branchIds.length === 0) return true;
            }
            return false;
        });

        res.json(users);
    } catch (err) {
        next(err);
    }
}

// Get messages
async function getMessages(req, res, next) {
    try {
        const userId = req.user.id;
        const ispId = req.ispId;
        const userRole = req.user.role;
        const customerId = req.user.customerId || null;
        const userIsCustomer = Boolean(customerId) || isCustomerRole(userRole);
        const userIsGlobal = isGlobalRole(userRole);
        const userIsSupport = isSupportRole(userRole);

        let whereClause = {
            ispId,
            isDeleted: false
        };

        if (userIsCustomer) {
            // Customer only sees messages they sent or received
            whereClause.OR = [
                { receiverId: userId },
                { senderId: userId }
            ];
        } else if (userIsGlobal) {
            // Global support / admin sees messages directly sent/received OR all customer messages across ISP
            whereClause.OR = [
                { receiverId: userId },
                { senderId: userId },
                { receiverId: null },
                { sender: { role: { name: { in: ['Customer', 'customer'] } } } },
                { receiver: { role: { name: { in: ['Customer', 'customer'] } } } }
            ];
        } else if (userIsSupport) {
            // Branch support staff sees direct messages and ONLY customer messages from their branch/sub-branches
            const baseBranchIds = [
                req.user.branchId,
                req.branchId,
                ...(req.user.userBranches || []).map(ub => ub.branchId)
            ].filter(Boolean).map(Number);

            let allowedBranchIds = [];
            for (const bId of baseBranchIds) {
                const subIds = await getAllSubBranchIds(req.prisma, bId);
                allowedBranchIds.push(...subIds);
            }
            allowedBranchIds = [...new Set(allowedBranchIds)];

            const branchFilterConditions = allowedBranchIds.length > 0 ? [
                { branchId: { in: allowedBranchIds } },
                { sender: { branchId: { in: allowedBranchIds } } },
                { sender: { customer: { branchId: { in: allowedBranchIds } } } },
                { sender: { customer: { lead: { branchId: { in: allowedBranchIds } } } } },
                { receiver: { branchId: { in: allowedBranchIds } } },
                { receiver: { customer: { branchId: { in: allowedBranchIds } } } },
                { receiver: { customer: { lead: { branchId: { in: allowedBranchIds } } } } }
            ] : [];

            whereClause.OR = [
                { receiverId: userId },
                { senderId: userId },
                ...(branchFilterConditions.length > 0 ? [
                    {
                        AND: [
                            {
                                OR: [
                                    { receiverId: null },
                                    { sender: { role: { name: { in: ['Customer', 'customer'] } } } },
                                    { receiver: { role: { name: { in: ['Customer', 'customer'] } } } }
                                ]
                            },
                            {
                                OR: branchFilterConditions
                            }
                        ]
                    }
                ] : [])
            ];
        } else {
            // Other staff sees only direct messages
            whereClause.OR = [
                { receiverId: userId },
                { senderId: userId }
            ];
        }

        const messages = await req.prisma.message.findMany({
            where: whereClause,
            include: MESSAGE_INCLUDE,
            orderBy: { createdAt: 'desc' }
        });

        // Deduplicate sent messages for customer accounts (merging broadcast duplicates)
        if (userIsCustomer) {
            const seen = new Set();
            const deduplicated = [];
            for (const msg of messages) {
                if (msg.senderId === userId) {
                    const timeBucket = Math.floor(new Date(msg.createdAt).getTime() / 3000);
                    const key = `${msg.content?.trim()}_${timeBucket}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                }
                deduplicated.push(msg);
            }
            return res.json(deduplicated);
        }

        res.json(messages);
    } catch (err) {
        next(err);
    }
}

// Send a message
async function sendMessage(req, res, next) {
    try {
        const senderId = req.user.id;
        const ispId = req.ispId;
        const customerId = req.user.customerId || null;
        let { receiverId, content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        let targetReceiverId = receiverId ? Number(receiverId) : null;

        // Resolve accurate branchId:
        // Check req.user.branchId, or Customer.branchId, or Customer.lead.branchId
        let effectiveBranchId = req.user.branchId || null;
        if (!effectiveBranchId && customerId) {
            const cust = await req.prisma.customer.findUnique({
                where: { id: Number(customerId) },
                select: { branchId: true, lead: { select: { branchId: true } } }
            });
            effectiveBranchId = cust?.branchId || cust?.lead?.branchId || null;
        }
        if (!effectiveBranchId) {
            const userWithCust = await req.prisma.user.findUnique({
                where: { id: senderId },
                select: {
                    branchId: true,
                    customer: {
                        select: {
                            branchId: true,
                            lead: { select: { branchId: true } }
                        }
                    }
                }
            });
            effectiveBranchId = userWithCust?.branchId || userWithCust?.customer?.branchId || userWithCust?.customer?.lead?.branchId || null;
        }
        if (!effectiveBranchId && targetReceiverId) {
            const targetUser = await req.prisma.user.findUnique({
                where: { id: targetReceiverId },
                select: {
                    branchId: true,
                    customer: {
                        select: {
                            branchId: true,
                            lead: { select: { branchId: true } }
                        }
                    }
                }
            });
            effectiveBranchId = targetUser?.branchId || targetUser?.customer?.branchId || targetUser?.customer?.lead?.branchId || null;
        }

        // Find all staff who should receive WebSocket alert
        let staffReceivers = [];
        if (!targetReceiverId) {
            // Customer messaging support team
            // Find global support / admin users + branch staff
            const allStaff = await req.prisma.user.findMany({
                where: {
                    ispId,
                    isDeleted: false,
                    id: { not: senderId },
                    status: 'active',
                    role: { name: { notIn: ['Customer', 'customer'] } }
                },
                select: {
                    id: true,
                    branchId: true,
                    role: { select: { name: true } },
                    userBranches: { select: { branchId: true } }
                },
                orderBy: { id: 'asc' }
            });

            // Filter staff: Global support/admin always receive all customer messages.
            // Branch support only receives if effectiveBranchId matches their branch/sub-branches.
            for (const staff of allStaff) {
                if (isGlobalRole(staff.role)) {
                    staffReceivers.push(staff);
                } else if (isSupportRole(staff.role)) {
                    if (!effectiveBranchId) {
                        staffReceivers.push(staff);
                    } else {
                        const staffBranchIds = [
                            staff.branchId,
                            ...(staff.userBranches || []).map(ub => ub.branchId)
                        ].filter(Boolean).map(Number);

                        let allowedIds = [];
                        for (const bId of staffBranchIds) {
                            const subIds = await getAllSubBranchIds(req.prisma, bId);
                            allowedIds.push(...subIds);
                        }
                        allowedIds = [...new Set(allowedIds)];

                        if (allowedIds.includes(Number(effectiveBranchId))) {
                            staffReceivers.push(staff);
                        }
                    }
                }
            }
        }

        // Create the message with effectiveBranchId and full relation inclusion
        const message = await req.prisma.message.create({
            data: {
                ispId,
                branchId: effectiveBranchId,
                senderId,
                receiverId: targetReceiverId || null,
                content: content.trim(),
                updatedAt: new Date()
            },
            include: MESSAGE_INCLUDE
        });

        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            if (targetReceiverId) {
                wsManager.sendToUser(targetReceiverId, 'chat.message', message);
            } else {
                staffReceivers.forEach(staff => {
                    wsManager.sendToUser(Number(staff.id), 'chat.message', message);
                });
            }
            wsManager.sendToUser(senderId, 'chat.message', message);
        }

        res.status(201).json(message);
    } catch (err) {
        next(err);
    }
}

// Mark as read
async function markMessageRead(req, res, next) {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const msg = await req.prisma.message.findUnique({ where: { id: Number(id) } });
        if (!msg) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const isAuthorized = msg.receiverId === userId ||
            (!msg.receiverId && isSupportRole(req.user.role)) ||
            isSupportRole(req.user.role);

        if (!isAuthorized) {
            return res.status(403).json({ error: 'Unauthorized to mark this message as read' });
        }

        const updated = await req.prisma.message.update({
            where: { id: Number(id) },
            data: { isRead: true, updatedAt: new Date() }
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
}

async function markAllMessagesRead(req, res, next) {
    try {
        const userId = req.user.id;
        const ispId = req.ispId;
        const userIsGlobal = isGlobalRole(req.user.role);
        const userIsSupport = isSupportRole(req.user.role);

        let whereClause = {
            ispId,
            receiverId: userId,
            isRead: false,
            isDeleted: false
        };

        if (userIsGlobal) {
            whereClause = {
                ispId,
                isRead: false,
                isDeleted: false,
                OR: [
                    { receiverId: userId },
                    { receiverId: null }
                ]
            };
        } else if (userIsSupport) {
            const baseBranchIds = [
                req.user.branchId,
                req.branchId,
                ...(req.user.userBranches || []).map(ub => ub.branchId)
            ].filter(Boolean).map(Number);
            let allowedBranchIds = [];
            for (const bId of baseBranchIds) {
                const subIds = await getAllSubBranchIds(req.prisma, bId);
                allowedBranchIds.push(...subIds);
            }
            allowedBranchIds = [...new Set(allowedBranchIds)];

            whereClause = {
                ispId,
                isRead: false,
                isDeleted: false,
                OR: [
                    { receiverId: userId },
                    {
                        AND: [
                            { receiverId: null },
                            allowedBranchIds.length ? { branchId: { in: allowedBranchIds } } : { branchId: -1 }
                        ]
                    }
                ]
            };
        }

        const result = await req.prisma.message.updateMany({
            where: whereClause,
            data: { isRead: true, updatedAt: new Date() }
        });

        res.json({ success: true, count: result.count });
    } catch (err) {
        next(err);
    }
}

// Delete message
async function deleteMessage(req, res, next) {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const msg = await req.prisma.message.findUnique({ where: { id: Number(id) } });
        if (!msg || (msg.senderId !== userId && msg.receiverId !== userId)) {
            return res.status(404).json({ error: 'Message not found' });
        }

        await req.prisma.message.update({
            where: { id: Number(id) },
            data: { isDeleted: true, updatedAt: new Date() }
        });

        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getRecipients,
    getMessages,
    sendMessage,
    markMessageRead,
    markAllMessagesRead,
    deleteMessage
};
