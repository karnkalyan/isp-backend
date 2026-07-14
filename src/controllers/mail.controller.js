const mailHelper = require('../utils/mailHelper');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

async function ensureMailTables(prisma) {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS mail_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ispId INT NOT NULL,
            userId INT NOT NULL,
            folder VARCHAR(32) NOT NULL,
            imapUid INT NULL,
            fromEmail VARCHAR(255) NULL,
            toEmails TEXT NULL,
            subject VARCHAR(500) NULL,
            body LONGTEXT NULL,
            messageId VARCHAR(255) NULL,
            attachmentsJson LONGTEXT NULL,
            isRead BOOLEAN DEFAULT FALSE,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX mail_messages_isp_user_folder_idx (ispId, userId, folder)
        )
    `);
    for (const statement of [
        'ALTER TABLE mail_messages ADD COLUMN imapUid INT NULL',
        'ALTER TABLE mail_messages ADD COLUMN attachmentsJson LONGTEXT NULL',
        'ALTER TABLE mail_messages ADD INDEX mail_messages_imap_uid_idx (ispId, userId, folder, imapUid)'
    ]) {
        try {
            await prisma.$executeRawUnsafe(statement);
        } catch (error) {
            if (!/Duplicate column|Duplicate key name|already exists/i.test(error.message || '')) {
                throw error;
            }
        }
    }
}

async function getMailSettings(prisma, ispId) {
    const rows = await prisma.iSPSettings.findMany({
        where: {
            ispId,
            key: {
                in: [
                    'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpFrom',
                    'imapHost', 'imapPort', 'imapUser', 'imapPass', 'imapSecure'
                ]
            }
        }
    });
    return rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
}

function stripHtml(value = '') {
    return String(value)
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseDbMailRows(rows) {
    return rows.map(row => ({
        ...row,
        attachments: row.attachmentsJson ? JSON.parse(row.attachmentsJson) : []
    }));
}

async function getImapClient(prisma, ispId) {
    const settings = await getMailSettings(prisma, ispId);
    const imapHost = settings.imapHost || (settings.smtpHost ? settings.smtpHost.replace(/^smtp\./i, 'imap.') : '');
    const imapPort = Number(settings.imapPort || 993);
    const imapUser = settings.imapUser || settings.smtpUser;
    const imapPass = settings.imapPass || settings.smtpPass;

    if (!imapHost || !imapUser || !imapPass) {
        return {
            configured: false,
            message: 'Configure imapHost, imapPort, imapUser, and imapPass in ISP settings to load incoming mail.'
        };
    }

    return {
        configured: true,
        client: new ImapFlow({
            host: imapHost,
            port: imapPort,
            secure: String(settings.imapSecure || 'true') !== 'false',
            auth: { user: imapUser, pass: imapPass },
            logger: false
        })
    };
}

async function getRecipients(req, res, next) {
    try {
        const ispId = req.ispId;
        const search = String(req.query.search || '').trim();
        const type = String(req.query.type || 'all').toLowerCase();
        if (!search) {
            return res.json({ users: [], leads: [], customers: [] });
        }
        const contains = search ? { contains: search } : undefined;

        const [users, leads, customers] = await Promise.all([
            type === 'all' || type === 'user' ? req.prisma.user.findMany({
                where: { ispId, isDeleted: false, ...(search ? { email: contains } : {}) },
                select: { id: true, name: true, email: true },
                take: 50,
                orderBy: { name: 'asc' }
            }) : [],
            type === 'all' || type === 'lead' ? req.prisma.lead.findMany({
                where: { ispId, isDeleted: false, email: search ? contains : { not: null } },
                select: { id: true, firstName: true, lastName: true, email: true },
                take: 50,
                orderBy: { updatedAt: 'desc' }
            }) : [],
            type === 'all' || type === 'customer' ? req.prisma.customer.findMany({
                where: { ispId, isDeleted: false, lead: { email: search ? contains : { not: null } } },
                select: {
                    id: true,
                    customerUniqueId: true,
                    lead: { select: { firstName: true, lastName: true, email: true } }
                },
                take: 50,
                orderBy: { updatedAt: 'desc' }
            }) : []
        ]);

        res.json({
            users: users.map(user => ({ type: 'user', id: user.id, name: user.name || user.email, email: user.email })),
            leads: leads.filter(lead => lead.email).map(lead => ({
                type: 'lead',
                id: lead.id,
                name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.email,
                email: lead.email
            })),
            customers: customers.filter(customer => customer.lead?.email).map(customer => ({
                type: 'customer',
                id: customer.id,
                name: `${customer.lead.firstName || ''} ${customer.lead.lastName || ''}`.trim() || customer.customerUniqueId || customer.lead.email,
                email: customer.lead.email
            }))
        });
    } catch (err) {
        next(err);
    }
}

async function sendManualMail(req, res, next) {
    try {
        await ensureMailTables(req.prisma);
        const ispId = req.ispId;
        const { recipients = [], subject, message } = req.body;

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Select at least one recipient.' });
        }
        if (!subject || !message) {
            return res.status(400).json({ error: 'Subject and message are required.' });
        }

        const uniqueEmails = [...new Set(recipients.map(r => String(r.email || '').trim()).filter(Boolean))];
        if (uniqueEmails.length === 0) {
            return res.status(400).json({ error: 'Selected recipients do not have email addresses.' });
        }

        const results = await Promise.all(uniqueEmails.map(email => mailHelper.sendMail(ispId, {
            to: email,
            subject,
            html: `<p>${String(message).replace(/\n/g, '<br>')}</p>`
        }, { ignoreNotificationSetting: true })));

        const sent = results.filter(result => result.success).length;
        if (sent > 0) {
            const settings = await getMailSettings(req.prisma, ispId);
            await req.prisma.$executeRawUnsafe(
                `INSERT INTO mail_messages (ispId, userId, folder, fromEmail, toEmails, subject, body, messageId, isRead, createdAt)
                 VALUES (?, ?, 'sent', ?, ?, ?, ?, ?, true, NOW())`,
                ispId,
                req.user.id,
                settings.smtpFrom || settings.smtpUser || null,
                uniqueEmails.join(', '),
                subject,
                message,
                results.find(result => result.messageId)?.messageId || null
            );
        }

        res.json({ success: sent > 0, sent, failed: results.length - sent });
    } catch (err) {
        next(err);
    }
}

async function getSentMail(req, res, next) {
    try {
        await ensureMailTables(req.prisma);
        const rows = await req.prisma.$queryRawUnsafe(
            `SELECT id, imapUid, fromEmail, toEmails, subject, body, messageId, attachmentsJson, isRead, createdAt
             FROM mail_messages
             WHERE ispId = ? AND userId = ? AND folder = 'sent'
             ORDER BY createdAt DESC
             LIMIT 100`,
            req.ispId,
            req.user.id
        );
        res.json(parseDbMailRows(rows));
    } catch (err) {
        next(err);
    }
}

async function getInboxMail(req, res, next) {
    try {
        await ensureMailTables(req.prisma);
        const rows = await req.prisma.$queryRawUnsafe(
            `SELECT id, imapUid, fromEmail, toEmails, subject, body, messageId, attachmentsJson, isRead, createdAt
             FROM mail_messages
             WHERE ispId = ? AND userId = ? AND folder = 'inbox'
             ORDER BY createdAt DESC
             LIMIT 100`,
            req.ispId,
            req.user.id
        );
        res.json({ configured: true, data: parseDbMailRows(rows) });
    } catch (err) {
        next(err);
    }
}

async function refreshInboxMail(req, res, next) {
    let client;
    try {
        await ensureMailTables(req.prisma);
        const imap = await getImapClient(req.prisma, req.ispId);
        if (!imap.configured) {
            return res.json({
                configured: false,
                data: [],
                message: imap.message
            });
        }

        client = imap.client;
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            const total = client.mailbox.exists || 0;
            const [latest] = await req.prisma.$queryRawUnsafe(
                `SELECT MAX(imapUid) AS maxUid
                 FROM mail_messages
                 WHERE ispId = ? AND userId = ? AND folder = 'inbox'`,
                req.ispId,
                req.user.id
            );
            const maxUid = Number(latest?.maxUid || 0);
            const range = maxUid > 0 ? `${maxUid + 1}:*` : `${Math.max(1, total - 49)}:*`;
            const fetchOptions = maxUid > 0 ? { uid: true } : undefined;
            let synced = 0;

            if (total > 0) {
                for await (const msg of client.fetch(range, {
                    uid: true,
                    envelope: true,
                    flags: true,
                    source: true,
                    bodyStructure: false,
                    internalDate: true
                }, fetchOptions)) {
                    const existing = await req.prisma.$queryRawUnsafe(
                        `SELECT id FROM mail_messages WHERE ispId = ? AND userId = ? AND folder = 'inbox' AND imapUid = ? LIMIT 1`,
                        req.ispId,
                        req.user.id,
                        msg.uid
                    );
                    if (existing.length) continue;

                    const parsed = msg.source ? await simpleParser(msg.source).catch(() => null) : null;
                    const attachments = (parsed?.attachments || []).map((attachment, index) => ({
                        id: index,
                        filename: attachment.filename || `attachment-${index + 1}`,
                        contentType: attachment.contentType,
                        size: attachment.size
                    }));

                    await req.prisma.$executeRawUnsafe(
                        `INSERT INTO mail_messages (ispId, userId, folder, imapUid, fromEmail, toEmails, subject, body, messageId, attachmentsJson, isRead, createdAt)
                         VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        req.ispId,
                        req.user.id,
                        msg.uid,
                        msg.envelope?.from?.map(item => item.address).join(', ') || '',
                        msg.envelope?.to?.map(item => item.address).join(', ') || '',
                        parsed?.subject || msg.envelope?.subject || '(no subject)',
                        parsed?.text || stripHtml(parsed?.html || ''),
                        msg.envelope?.messageId || null,
                        JSON.stringify(attachments),
                        Array.from(msg.flags || []).includes('\\Seen') ? 1 : 0,
                        msg.internalDate || msg.envelope?.date || new Date()
                    );
                    synced++;
                }
            }

            const rows = await req.prisma.$queryRawUnsafe(
                `SELECT id, imapUid, fromEmail, toEmails, subject, body, messageId, attachmentsJson, isRead, createdAt
                 FROM mail_messages
                 WHERE ispId = ? AND userId = ? AND folder = 'inbox'
                 ORDER BY createdAt DESC
                 LIMIT 100`,
                req.ispId,
                req.user.id
            );
            res.json({ configured: true, synced, data: parseDbMailRows(rows) });
        } finally {
            lock.release();
        }
    } catch (err) {
        next(err);
    } finally {
        if (client) await client.logout().catch(() => {});
    }
}

async function downloadInboxAttachment(req, res, next) {
    let client;
    try {
        await ensureMailTables(req.prisma);
        const mailId = Number(req.params.id);
        const index = Number(req.params.index);
        const rows = await req.prisma.$queryRawUnsafe(
            `SELECT imapUid FROM mail_messages WHERE id = ? AND ispId = ? AND userId = ? AND folder = 'inbox' LIMIT 1`,
            mailId,
            req.ispId,
            req.user.id
        );
        const uid = Number(rows[0]?.imapUid || 0);
        const imap = await getImapClient(req.prisma, req.ispId);

        if (!imap.configured) {
            return res.status(400).json({ success: false, message: imap.message });
        }
        if (!uid || Number.isNaN(index)) {
            return res.status(400).json({ success: false, message: 'Invalid attachment request.' });
        }

        client = imap.client;
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            const message = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!message?.source) {
                return res.status(404).json({ success: false, message: 'Mail not found.' });
            }

            const parsed = await simpleParser(message.source);
            const attachment = parsed.attachments?.[index];
            if (!attachment) {
                return res.status(404).json({ success: false, message: 'Attachment not found.' });
            }

            res.setHeader('Content-Type', attachment.contentType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename || `attachment-${index + 1}`)}"`);
            return res.send(attachment.content);
        } finally {
            lock.release();
        }
    } catch (err) {
        next(err);
    } finally {
        if (client) await client.logout().catch(() => {});
    }
}

module.exports = { getRecipients, sendManualMail, getSentMail, getInboxMail, refreshInboxMail, downloadInboxAttachment };
