const { sendToUser } = require('../services/pushNotification');

/**
 * Creates a system notification, sends a push notification via Expo, and broadcasts over WebSocket.
 */
async function createSystemNotification(prisma, { userId, ispId, branchId, type, title, description, link, wsManager }) {
    try {
        const notification = await prisma.notification.create({
            data: {
                type: type || 'info',
                title,
                description,
                link,
                userId: userId ? parseInt(userId) : null,
                ispId: parseInt(ispId),
                branchId: branchId ? parseInt(branchId) : null,
            },
        });

        // 1) Push via Expo
        if (userId) {
            await sendToUser(prisma, parseInt(userId), title, description || '', { link: link || '' });
        }

        // 2) Push via WebSocket
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
        return notification;
    } catch (err) {
        console.error('Failed to create system notification:', err);
    }
}

module.exports = {
    createSystemNotification,
};
