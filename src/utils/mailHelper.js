const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Gets the SMTP transporter configured from ISP settings
 * @param {number} ispId 
 */
async function getTransporter(ispId) {
    const settings = await prisma.iSPSettings.findMany({
        where: { ispId, key: { in: ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'enableMailNotifications'] } }
    });

    const settingsObj = settings.reduce((acc, s) => {
        acc[s.key] = s.value;
        return acc;
    }, {});

    if (settingsObj.enableMailNotifications !== 'true') {
        throw new Error("Mail notifications are disabled in settings");
    }

    if (!settingsObj.smtpHost || !settingsObj.smtpPort || !settingsObj.smtpUser || !settingsObj.smtpPass) {
        throw new Error("Incomplete SMTP configuration");
    }

    return nodemailer.createTransport({
        host: settingsObj.smtpHost,
        port: parseInt(settingsObj.smtpPort),
        secure: parseInt(settingsObj.smtpPort) === 465, // true for 465, false for other ports
        auth: {
            user: settingsObj.smtpUser,
            pass: settingsObj.smtpPass,
        },
    });
}

/**
 * Sends an email using the configured SMTP settings
 * @param {number} ispId 
 * @param {object} mailOptions { to, subject, text, html }
 */
async function sendMail(ispId, mailOptions) {
    try {
        const settings = await prisma.iSPSettings.findFirst({
            where: { ispId, key: 'smtpFrom' }
        });
        const fromAddress = settings ? settings.value : 'noreply@kisanisp.com';

        const transporter = await getTransporter(ispId);

        const info = await transporter.sendMail({
            from: fromAddress,
            ...mailOptions
        });

        console.log('Message sent: %s', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendMail
};
