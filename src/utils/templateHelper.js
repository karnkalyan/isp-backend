const prisma = require('../../prisma/client');

function emailDetailRows(rows) {
  return rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#64748b;font-size:13px;width:38%;">${label}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#0f172a;font-size:13px;font-weight:700;">${value}</td>
      </tr>
    `)
    .join('');
}

function emailTemplate({ eyebrow, title, intro, rows = [], note = '', accent = '#2563eb' }) {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe3ef;box-shadow:0 14px 36px rgba(15,23,42,0.12);">
            <tr>
              <td style="background:${accent};padding:22px 28px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;opacity:0.9;">${eyebrow}</div>
                <div style="font-size:26px;line-height:1.2;font-weight:800;margin-top:8px;">${title}</div>
                <div style="font-size:14px;line-height:1.6;margin-top:8px;opacity:0.95;">{ispName}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="font-size:15px;line-height:1.8;color:#334155;">${intro}</div>
                ${rows.length ? `
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
                    ${emailDetailRows(rows)}
                  </table>
                ` : ''}
                ${note ? `<div style="margin-top:22px;padding:14px 16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.6;">${note}</div>` : ''}
                <div style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:18px;">
                  <div style="font-size:14px;font-weight:800;color:#0f172a;">{ispName}</div>
                  <div style="font-size:13px;color:#64748b;margin-top:4px;">{companyAddress}</div>
                  <div style="font-size:13px;color:#64748b;margin-top:4px;">Phone: {companyPhone} &nbsp; Email: {companyEmail}</div>
                  <div style="font-size:12px;color:#94a3b8;margin-top:10px;">This is an automated message from {ispName}. Please keep this email for your records.</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const DEFAULT_TEMPLATES = [
  {
    channel: 'EMAIL',
    eventKey: 'customer_new_connection',
    name: 'New Connection - Customer',
    subject: 'Welcome to {ispName}, {customerName}',
    body: emailTemplate({
      eyebrow: 'New Connection',
      title: 'Welcome, {customerName}',
      intro: 'Your new internet connection has been created successfully. Below are your customer and package details.',
      rows: [
        ['Customer ID', '{customerUniqueId}'],
        ['Package', '{packageName}'],
        ['Plan Start', '{planStart}'],
        ['Plan End', '{planEnd}'],
        ['Login Username', '{username}'],
        ['Login Password', '{password}']
      ],
      note: 'For your account security, please keep your login credentials private and contact support if you need any help.',
      accent: '#0f766e'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'support_ticket_customer',
    name: 'Support Ticket - Customer',
    subject: 'Support Ticket Created: {ticketNumber}',
    body: emailTemplate({
      eyebrow: 'Support Request',
      title: 'Ticket Created Successfully',
      intro: 'Dear {customerName}, your support ticket has been created. Our team will review it and contact you soon.',
      rows: [
        ['Ticket Number', '{ticketNumber}'],
        ['Title', '{title}'],
        ['Priority', '{priority}'],
        ['Customer Phone', '{customerPhone}'],
        ['Customer Email', '{customerEmail}']
      ],
      note: 'You can reply to this email or contact support with your ticket number for faster assistance.',
      accent: '#2563eb'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'support_ticket_assignee',
    name: 'Support Ticket - Assigned User',
    subject: 'Ticket Assigned: {ticketNumber}',
    body: emailTemplate({
      eyebrow: 'Ticket Assignment',
      title: 'A Ticket Needs Your Attention',
      intro: 'Hello {userName}, a support ticket has been assigned to you. Please review the details and take action.',
      rows: [
        ['Ticket Number', '{ticketNumber}'],
        ['Customer', '{customerName}'],
        ['Title', '{title}'],
        ['Priority', '{priority}'],
        ['Description', '{description}']
      ],
      accent: '#7c3aed'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'support_ticket_branch',
    name: 'Support Ticket - Branch Support',
    subject: 'New Ticket in {branchName}: {ticketNumber}',
    body: emailTemplate({
      eyebrow: 'Branch Support',
      title: 'New Ticket in {branchName}',
      intro: 'Hello {userName}, a new support ticket has been created in your branch.',
      rows: [
        ['Branch', '{branchName}'],
        ['Ticket Number', '{ticketNumber}'],
        ['Customer', '{customerName}'],
        ['Title', '{title}'],
        ['Priority', '{priority}'],
        ['Description', '{description}']
      ],
      accent: '#0891b2'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'task_assigned_user',
    name: 'Task Assigned - User',
    subject: 'Task Assigned: {taskTitle}',
    body: emailTemplate({
      eyebrow: 'Task Assignment',
      title: 'New Task Assigned',
      intro: 'Hello {userName}, a new task has been assigned to you. Please check your dashboard and proceed.',
      rows: [
        ['Task', '{taskTitle}'],
        ['Priority', '{priority}'],
        ['Customer', '{customerName}'],
        ['Ticket', '{ticketNumber}'],
        ['Description', '{description}']
      ],
      accent: '#ea580c'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'lead_followup',
    name: 'Lead Follow-up',
    subject: 'Following Up On Your Internet Inquiry',
    body: emailTemplate({
      eyebrow: 'Internet Inquiry',
      title: 'Thank You For Your Interest',
      intro: 'Dear {leadName}, thank you for your interest in {ispName}. Our team can help you choose the right internet package for your home or business.',
      rows: [
        ['Lead Name', '{leadName}'],
        ['Interested Package', '{packageName}'],
        ['Phone', '{phoneNumber}']
      ],
      note: 'We would be happy to answer your questions about installation, packages, billing, and support.',
      accent: '#16a34a'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'subscription_expiring',
    name: 'Subscription Expiring Soon',
    subject: 'Your subscription expires soon',
    body: emailTemplate({
      eyebrow: 'Subscription Reminder',
      title: 'Your Subscription Expires Soon',
      intro: 'Dear {customerName}, your internet subscription is close to expiry. Please recharge before the expiry date to continue uninterrupted service.',
      rows: [
        ['Customer ID', '{customerUniqueId}'],
        ['Package', '{packageName}'],
        ['Expiry Date', '{expiryDate}'],
        ['Amount Due', '{amount}']
      ],
      note: 'Recharge before expiry to avoid service interruption.',
      accent: '#ca8a04'
    })
  },
  {
    channel: 'EMAIL',
    eventKey: 'recharge_success',
    name: 'Recharge Successful',
    subject: 'Recharge Successful - {ispName}',
    body: emailTemplate({
      eyebrow: 'Payment Confirmation',
      title: 'Recharge Successful',
      intro: 'Dear {customerName}, your recharge has been completed successfully. Thank you for your payment.',
      rows: [
        ['Customer ID', '{customerUniqueId}'],
        ['Package', '{packageName}'],
        ['Amount', '{amount}'],
        ['Valid Until', '{expiryDate}']
      ],
      note: 'Your plan validity has been updated. Please contact support if your service does not resume shortly.',
      accent: '#0f766e'
    })
  },
  {
    channel: 'SMS',
    eventKey: 'ticket_creation',
    name: 'Support Ticket SMS',
    body: 'Dear {firstName}, ticket {ticketNumber} has been created for {title}. {ispName}'
  },
  {
    channel: 'SMS',
    eventKey: 'task_assigned_user',
    name: 'Task Assigned SMS',
    body: 'Task assigned: {taskTitle}. Priority: {priority}. Please check your dashboard.'
  },
  {
    channel: 'SMS',
    eventKey: 'subscription_expiring',
    name: 'Subscription Expiry SMS',
    body: 'Dear {customerName}, your {packageName} subscription expires on {expiryDate}. Please recharge soon.'
  },
  {
    channel: 'SMS',
    eventKey: 'recharge_success',
    name: 'Recharge Success SMS',
    body: 'Dear {customerName}, recharge of {amount} is successful. Valid until {expiryDate}.'
  },
  {
    channel: 'SMS',
    eventKey: 'customer_new_connection',
    name: 'New Connection SMS',
    body: 'Dear {customerName}, your new connection is created. Customer ID: {customerUniqueId}. {ispName}'
  }
];

async function ensureTemplateTable(db = prisma) {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS message_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ispId INT NOT NULL,
      channel VARCHAR(16) NOT NULL,
      eventKey VARCHAR(80) NOT NULL,
      name VARCHAR(160) NOT NULL,
      subject VARCHAR(255) NULL,
      body LONGTEXT NOT NULL,
      isActive BOOLEAN NOT NULL DEFAULT true,
      isDefault BOOLEAN NOT NULL DEFAULT false,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX message_templates_isp_channel_idx (ispId, channel),
      INDEX message_templates_event_idx (ispId, channel, eventKey)
    )
  `);
}

async function seedDefaultTemplates(ispId, db = prisma) {
  await ensureTemplateTable(db);
  for (const template of DEFAULT_TEMPLATES) {
    const existing = await db.$queryRawUnsafe(
      `SELECT id, name, subject, body FROM message_templates WHERE ispId = ? AND channel = ? AND eventKey = ? AND isDefault = true LIMIT 1`,
      ispId,
      template.channel,
      template.eventKey
    );
    if (existing.length) {
      const current = existing[0];
      const nextSubject = template.subject || null;
      if (current.name !== template.name || current.subject !== nextSubject || current.body !== template.body) {
        await db.$executeRawUnsafe(
          `UPDATE message_templates
           SET name = ?, subject = ?, body = ?, isActive = true, updatedAt = NOW()
           WHERE id = ?`,
          template.name,
          nextSubject,
          template.body,
          current.id
        );
      }
    } else {
      await db.$executeRawUnsafe(
        `INSERT INTO message_templates (ispId, channel, eventKey, name, subject, body, isActive, isDefault, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, true, true, NOW(), NOW())`,
        ispId,
        template.channel,
        template.eventKey,
        template.name,
        template.subject || null,
        template.body
      );
    }
  }
}

function looksLikeHtml(text = '') {
  return /<\/?[a-z][\s\S]*>/i.test(String(text));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderText(text = '', data = {}, options = {}) {
  return String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = data[key];
    const normalizedValue = value === undefined || value === null ? '' : String(value);
    return options.escapeValues ? escapeHtml(normalizedValue) : normalizedValue;
  });
}

function textToHtml(text = '') {
  if (looksLikeHtml(text)) return String(text);
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

async function renderTemplate(ispId, channel, eventKey, data = {}, fallback = {}, db = prisma) {
  const normalizedChannel = String(channel).toUpperCase();
  console.log('[templateHelper] Rendering notification template', {
    ispId,
    channel: normalizedChannel,
    eventKey,
    hasFallbackSubject: Boolean(fallback.subject),
    hasFallbackBody: Boolean(fallback.body)
  });
  await seedDefaultTemplates(ispId, db);
  let companyData = {};
  if (ispId) {
    const isp = await db.iSP.findUnique({
      where: { id: Number(ispId) },
      select: {
        companyName: true,
        phoneNumber: true,
        masterEmail: true,
        address: true,
        city: true,
        state: true,
        country: true,
        website: true
      }
    }).catch(() => null);
    if (isp) {
      const addressParts = [isp.address, isp.city, isp.state, isp.country].filter(Boolean);
      companyData = {
        ispName: isp.companyName,
        companyName: isp.companyName,
        companyPhone: isp.phoneNumber || '',
        companyEmail: isp.masterEmail || '',
        companyAddress: addressParts.join(', '),
        companyWebsite: isp.website || ''
      };
    }
  }
  const rows = await db.$queryRawUnsafe(
    `SELECT subject, body FROM message_templates
     WHERE ispId = ? AND channel = ? AND eventKey = ? AND isActive = true
     ORDER BY isDefault ASC, updatedAt DESC
     LIMIT 1`,
    ispId,
    normalizedChannel,
    eventKey
  );
  const template = rows[0] || fallback;
  const mergedData = { ...companyData, ...data };
  const bodyTemplate = template.body || fallback.body || '';
  const bodyIsHtml = normalizedChannel === 'EMAIL' && looksLikeHtml(bodyTemplate);
  const rendered = {
    subject: renderText(template.subject || fallback.subject || '', mergedData),
    body: renderText(bodyTemplate, mergedData, { escapeValues: bodyIsHtml })
  };
  console.log('[templateHelper] Notification template rendered', {
    ispId,
    channel: normalizedChannel,
    eventKey,
    source: rows[0] ? 'database' : 'fallback',
    subjectLength: rendered.subject.length,
    bodyLength: rendered.body.length
  });
  return rendered;
}

module.exports = {
  DEFAULT_TEMPLATES,
  ensureTemplateTable,
  seedDefaultTemplates,
  renderTemplate,
  renderText,
  textToHtml
};
