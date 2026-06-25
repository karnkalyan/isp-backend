const express = require('express');

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
        const { receiverId, content } = req.body;

        if (!receiverId || !content) {
            return res.status(400).json({ error: 'Receiver and content are required' });
        }

        const message = await req.prisma.message.create({
            data: {
                ispId,
                branchId,
                senderId,
                receiverId: Number(receiverId),
                content,
                updatedAt: new Date()
            },
            include: {
                sender: { select: { id: true, name: true, role: true } },
                receiver: { select: { id: true, name: true, role: true } }
            }
        });

        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            wsManager.sendToUser(Number(receiverId), 'chat.message', message);
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
    getMessages,
    sendMessage,
    markMessageRead,
    markAllMessagesRead,
    deleteMessage
};
