const express = require('express');

const SUPPORT_ROLE_NAMES = [
    'administrator',
    'admin',
    'isp_admin',
    'branch admin',
    'sub branch admin',
    'support',
    'support agent',
    'support manager',
    'technician'
];

function normalizeRoleName(role) {
    return String(typeof role === 'string' ? role : role?.name || '').toLowerCase();
}

function isSupportRole(role) {
    const name = normalizeRoleName(role);
    return SUPPORT_ROLE_NAMES.some(supportRole => name === supportRole || name.includes(supportRole));
}

// Get users the current account can chat with
async function getRecipients(req, res, next) {
    try {
        const userId = req.user.id;
        const ispId = req.ispId;
        const customerId = req.user.customerId || null;

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

        const branchFilter = branchIds.length > 0
            ? {
                OR: [
                    { branchId: { in: branchIds } },
                    { userBranches: { some: { branchId: { in: branchIds } } } },
                    { role: { name: { in: ['administrator', 'admin', 'isp_admin'] } } }
                ]
            }
            : {};

        let users = await req.prisma.user.findMany({
            where: {
                ispId,
                isDeleted: false,
                id: { not: userId },
                status: 'active',
                ...branchFilter,
                OR: [
                    { id: { in: participantIds.length ? participantIds : [-1] } },
                    { role: { name: { in: SUPPORT_ROLE_NAMES } } }
                ]
            },
            select: {
                id: true,
                name: true,
                email: true,
                branchId: true,
                role: { select: { name: true } }
            },
            orderBy: { name: 'asc' },
            take: 50
        });

        users = users.filter(user => participantIds.includes(user.id) || isSupportRole(user.role));

        if (users.length === 0) {
            users = await req.prisma.user.findMany({
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
                    role: { select: { name: true } }
                },
                orderBy: { name: 'asc' },
                take: 20
            });
        }

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

        const messages = await req.prisma.message.findMany({
            where: {
                ispId,
                isDeleted: false,
                OR: [
                    { receiverId: userId },
                    { senderId: userId }
                ]
            },
            include: {
                sender: { select: { id: true, name: true, role: true } },
                receiver: { select: { id: true, name: true, role: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

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
        const branchId = req.user.branchId || null;
        let { receiverId, content } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        let receiverIds = [];
        if (!receiverId) {
            let fallbackReceivers = await req.prisma.user.findMany({
                where: {
                    ispId,
                    isDeleted: false,
                    id: { not: senderId },
                    status: 'active',
                    role: { name: { in: SUPPORT_ROLE_NAMES } }
                },
                select: { id: true },
                orderBy: { id: 'asc' }
            });

            if (!fallbackReceivers.length) {
                fallbackReceivers = await req.prisma.user.findMany({
                    where: {
                        ispId,
                        isDeleted: false,
                        id: { not: senderId },
                        status: 'active',
                        role: { name: { notIn: ['Customer', 'customer', 'Customers', 'customers'] } }
                    },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                    take: 20
                });
            }

            receiverIds = fallbackReceivers.map(user => Number(user.id)).filter(Boolean);
        } else {
            receiverIds = [Number(receiverId)].filter(Boolean);
        }

        if (receiverIds.length === 0) {
            return res.status(400).json({ error: 'No support or admin user is available for chat.' });
        }

        const messages = await Promise.all(receiverIds.map((targetReceiverId) => req.prisma.message.create({
            data: {
                ispId,
                branchId,
                senderId,
                receiverId: targetReceiverId,
                content,
                updatedAt: new Date()
            },
            include: {
                sender: { select: { id: true, name: true, role: true } },
                receiver: { select: { id: true, name: true, role: true } }
            }
        })));

        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            messages.forEach((message) => {
                wsManager.sendToUser(Number(message.receiverId), 'chat.message', message);
                wsManager.sendToUser(senderId, 'chat.message', message);
            });
        }

        res.status(201).json(messages[0]);
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
        if (!msg || msg.receiverId !== userId) {
            return res.status(404).json({ error: 'Message not found' });
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

        const result = await req.prisma.message.updateMany({
            where: {
                ispId,
                receiverId: userId,
                isRead: false,
                isDeleted: false
            },
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
