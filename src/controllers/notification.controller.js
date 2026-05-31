/**
 * Get notifications for current user
 */
async function getNotifications(req, res, next) {
    try {
        const ispId = req.ispId;
        const userId = req.user?.id;
        const { page = 1, limit = 20, unreadOnly } = req.query;

        const branchId = req.branchId || null;

        const where = {
            ispId,
            AND: [
                {
                    OR: [
                        { userId },
                        { userId: null },
                    ]
                },
                ...(branchId ? [{
                    OR: [
                        { branchId },
                        { branchId: null },
                        { originBranchId: branchId }
                    ]
                }] : []),
            ],
            ...(unreadOnly === 'true' ? { isRead: false } : {}),
        };

        const [notifications, total, unreadCount] = await Promise.all([
            req.prisma.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit),
            }),
            req.prisma.notification.count({ where }),
            req.prisma.notification.count({
                where: { ...where, isRead: false },
            }),
        ]);

        res.json({
            data: notifications,
            unreadCount,
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
 * Mark notification as read
 */
async function markAsRead(req, res, next) {
    try {
        const { id } = req.params;
        if (!id || id === 'undefined' || isNaN(parseInt(id))) {
            return res.status(400).json({ error: 'Valid notification ID is required' });
        }
        await req.prisma.notification.update({
            where: { id: parseInt(id) },
            data: { isRead: true },
        });
        res.json({ message: 'Notification marked as read' });
    } catch (err) {
        next(err);
    }
}

/**
 * Mark all notifications as read
 */
async function markAllRead(req, res, next) {
    try {
        const ispId = req.ispId;
        const userId = req.user?.id;
        await req.prisma.notification.updateMany({
            where: {
                ispId,
                OR: [{ userId }, { userId: null }],
                isRead: false,
            },
            data: { isRead: true },
        });
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        next(err);
    }
}

/**
 * Create a notification (admin/system use)
 */
async function createNotification(req, res, next) {
    try {
        const { type, title, description, link, userId } = req.body;
        const ispId = req.ispId;
        const branchId = req.branchId || null;

        const notification = await req.prisma.notification.create({
            data: {
                type: type || 'info',
                title,
                description,
                link,
                userId: userId ? parseInt(userId) : null,
                ispId,
                branchId,
            },
        });

        // Push via WebSocket
        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            if (userId) {
                wsManager.sendToUser(parseInt(userId), 'notification.new', notification);
            } else {
                wsManager.emitEvent('system.notification', {
                    ispId,
                    ...notification,
                });
            }
        }

        res.status(201).json(notification);
    } catch (err) {
        next(err);
    }
}

// ==================== NOTICES ====================

/**
 * Get active notices
 */
async function getNotices(req, res, next) {
    try {
        const ispId = req.ispId;
        const branchId = req.branchId || null;
        const { page = 1, limit = 20, includeExpired } = req.query;

        const where = {
            ispId,
            isDeleted: false,
            ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
            ...(includeExpired !== 'true' ? {
                OR: [
                    { expiresAt: null },
                    { expiresAt: { gte: new Date() } },
                ]
            } : {}),
        };

        const [notices, total] = await Promise.all([
            req.prisma.notice.findMany({
                where,
                include: {
                    createdBy: { select: { id: true, name: true } },
                    branch: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: parseInt(limit),
                skip: (parseInt(page) - 1) * parseInt(limit),
            }),
            req.prisma.notice.count({ where }),
        ]);

        res.json({
            data: notices,
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
 * Create a notice
 */
async function createNotice(req, res, next) {
    try {
        const { title, content, priority, expiresAt, branchId } = req.body;
        const ispId = req.ispId;
        const createdById = req.user?.id;

        const notice = await req.prisma.notice.create({
            data: {
                title,
                content,
                priority: priority || 'normal',
                expiresAt: expiresAt ? new Date(expiresAt) : null,
                ispId,
                branchId: branchId ? parseInt(branchId) : null,
                createdById,
            },
            include: {
                createdBy: { select: { id: true, name: true } },
                branch: { select: { id: true, name: true } },
            },
        });

        // Broadcast via WebSocket
        const wsManager = req.app.get('webSocketManager');
        if (wsManager) {
            wsManager.emitEvent('system.notification', {
                ispId,
                type: 'info',
                title: 'New Notice',
                message: title,
            });
        }

        res.status(201).json(notice);
    } catch (err) {
        next(err);
    }
}

/**
 * Update a notice
 */
async function updateNotice(req, res, next) {
    try {
        const { id } = req.params;
        const { title, content, priority, isActive, expiresAt } = req.body;

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (content !== undefined) updateData.content = content;
        if (priority !== undefined) updateData.priority = priority;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

        const notice = await req.prisma.notice.update({
            where: { id: parseInt(id) },
            data: updateData,
        });
        res.json(notice);
    } catch (err) {
        next(err);
    }
}

/**
 * Delete a notice (soft delete)
 */
async function deleteNotice(req, res, next) {
    try {
        const { id } = req.params;
        await req.prisma.notice.update({
            where: { id: parseInt(id) },
            data: { isDeleted: true },
        });
        res.json({ message: 'Notice deleted' });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    getNotifications,
    markAsRead,
    markAllRead,
    createNotification,
    getNotices,
    createNotice,
    updateNotice,
    deleteNotice,
};
