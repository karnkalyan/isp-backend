const { Expo } = require('expo-server-sdk');
const expo = new Expo();

/**
 * Send push notifications to a list of Expo push tokens.
 * @param {string[]} tokens 
 * @param {string} title 
 * @param {string} body 
 * @param {object} data 
 */
async function sendPushNotification(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return;
    
    const messages = [];
    for (const pushToken of tokens) {
        if (!Expo.isExpoPushToken(pushToken)) {
            console.error(`Push token ${pushToken} is not a valid Expo push token`);
            continue;
        }
        messages.push({
            to: pushToken,
            sound: 'default',
            title,
            body,
            data,
        });
    }

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    
    for (const chunk of chunks) {
        try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
        } catch (error) {
            console.error('Error sending push notifications chunk:', error);
        }
    }
    return tickets;
}

/**
 * Fetch push tokens for a user and send them a push notification.
 * @param {object} prisma - Prisma Client instance
 * @param {number} userId - The recipient user ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Custom payload data
 */
async function sendToUser(prisma, userId, title, body, data = {}) {
    try {
        if (!userId) return;
        const tokens = await prisma.userPushToken.findMany({
            where: { userId: Number(userId) },
            select: { token: true }
        });
        if (tokens.length === 0) return;
        const tokenStrings = tokens.map(t => t.token);
        await sendPushNotification(tokenStrings, title, body, data);
    } catch (err) {
        console.error(`Failed to send push notification to user ${userId}:`, err);
    }
}

module.exports = {
    sendPushNotification,
    sendToUser,
};
