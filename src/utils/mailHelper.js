const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Gets the SMTP transporter configured from ISP settings
 * @param {number} ispId 
 */
async function getTransporter(ispId, options = {}) {
    const settings = await prisma.iSPSettings.findMany({
        where: { ispId, key: { in: ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'enableMailNotifications', 'enableEmailService', 'emailNotifications'] } }
    });

    const settingsObj = settings.reduce((acc, s) => {
        acc[s.key] = s.value;
        return acc;
    }, {});

    const emailServiceEnabled = settingsObj.enableEmailService !== 'false' && settingsObj.emailNotifications !== 'false';
    const mailNotificationsEnabled = settingsObj.enableMailNotifications === 'true' || settingsObj.emailNotifications === 'true';

    if (!emailServiceEnabled) {
        console.log('[mailHelper] Email skipped because email service is disabled', { ispId });
        throw new Error("Email service is disabled in settings");
    }

    if (!options.ignoreNotificationSetting && !mailNotificationsEnabled) {
        console.log('[mailHelper] Email skipped because mail notifications are disabled', { ispId });
        throw new Error("Mail notifications are disabled in settings");
    }

    if (!settingsObj.smtpHost || !settingsObj.smtpPort || !settingsObj.smtpUser || !settingsObj.smtpPass) {
        console.log('[mailHelper] Email skipped because SMTP configuration is incomplete', {
            ispId,
            hasHost: Boolean(settingsObj.smtpHost),
            hasPort: Boolean(settingsObj.smtpPort),
            hasUser: Boolean(settingsObj.smtpUser),
            hasPass: Boolean(settingsObj.smtpPass)
        });
        throw new Error("Incomplete SMTP configuration");
    }

    console.log('[mailHelper] SMTP transporter ready', {
        ispId,
        host: settingsObj.smtpHost,
        port: settingsObj.smtpPort,
        ignoreNotificationSetting: Boolean(options.ignoreNotificationSetting)
    });

    return nodemailer.createTransport({
        host: settingsObj.smtpHost,
        port: parseInt(settingsObj.smtpPort),
        secure: parseInt(settingsObj.smtpPort) === 465, // true for 465, false for other ports
        auth: {
            user: settingsObj.smtpUser,
            pass: settingsObj.smtpPass,
        },
        tls: {
            rejectUnauthorized: false
        }
    });
}

/**
 * Sends an email using the configured SMTP settings
 * @param {number} ispId 
 * @param {object} mailOptions { to, subject, text, html }
 */
async function sendMail(ispId, mailOptions, options = {}) {
    try {
        console.log('[mailHelper] Preparing email', {
            ispId,
            to: mailOptions?.to,
            subject: mailOptions?.subject,
            ignoreNotificationSetting: Boolean(options.ignoreNotificationSetting)
        });
        const settings = await prisma.iSPSettings.findFirst({
            where: { ispId, key: 'smtpFrom' }
        });
        const fromAddress = settings ? settings.value : 'noreply@kisanisp.com';

        const transporter = await getTransporter(ispId, options);

        const info = await transporter.sendMail({
            from: fromAddress,
            ...mailOptions
        });

        console.log('[mailHelper] Email sent', {
            ispId,
            to: mailOptions?.to,
            subject: mailOptions?.subject,
            messageId: info.messageId
        });
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('[mailHelper] Error sending email:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendMail
};
