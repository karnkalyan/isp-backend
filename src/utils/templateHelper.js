const prisma = require('../../prisma/client');

const DEFAULT_TEMPLATES = [
  {
    channel: 'EMAIL',
    eventKey: 'customer_new_connection',
    name: 'New Connection - Customer',
    subject: 'Welcome to {ispName}',
    body: 'Dear {customerName},\n\nYour new connection has been created successfully.\n\nCustomer ID: {customerUniqueId}\nPackage: {packageName}\nPlan Start: {planStart}\nPlan End: {planEnd}\nLogin Username: {username}\nLogin Password: {password}\n\nThank you,\n{ispName}'
  },
  {
    channel: 'EMAIL',
    eventKey: 'support_ticket_customer',
    name: 'Support Ticket - Customer',
    subject: 'Support Ticket Created: {ticketNumber}',
    body: 'Dear {customerName},\n\nYour support ticket has been created successfully.\n\nTicket: {ticketNumber}\nTitle: {title}\nPriority: {priority}\n\nOur support team will review it and contact you soon.\n\nThank you,\n{ispName} Support'
  },
  {
    channel: 'EMAIL',
    eventKey: 'support_ticket_assignee',
    name: 'Support Ticket - Assigned User',
    subject: 'Ticket Assigned: {ticketNumber}',
    body: 'Hello {userName},\n\nA support ticket has been assigned to you.\n\nTicket: {ticketNumber}\nCustomer: {customerName}\nTitle: {title}\nDescription: {description}\n\nPlease review and take action.'
  },
  {
    channel: 'EMAIL',
    eventKey: 'support_ticket_branch',
    name: 'Support Ticket - Branch Support',
    subject: 'New Ticket in {branchName}: {ticketNumber}',
    body: 'Hello {userName},\n\nA new support ticket has been created in your branch.\n\nTicket: {ticketNumber}\nCustomer: {customerName}\nTitle: {title}\nDescription: {description}\n\nPlease review and take action.'
  },
  {
    channel: 'EMAIL',
    eventKey: 'task_assigned_user',
    name: 'Task Assigned - User',
    subject: 'Task Assigned: {taskTitle}',
    body: 'Hello {userName},\n\nA new task has been assigned to you.\n\nTask: {taskTitle}\nPriority: {priority}\nCustomer: {customerName}\nTicket: {ticketNumber}\nDescription: {description}\n\nPlease check your task dashboard.'
  },
  {
    channel: 'EMAIL',
    eventKey: 'lead_followup',
    name: 'Lead Follow-up',
    subject: 'Following Up On Your Internet Inquiry',
    body: 'Dear {leadName},\n\nThank you for your interest in {ispName}. We are following up regarding your inquiry and can help you choose the right package.\n\nThank you,\n{ispName}'
  },
  {
    channel: 'EMAIL',
    eventKey: 'subscription_expiring',
    name: 'Subscription Expiring Soon',
    subject: 'Your subscription expires soon',
    body: 'Dear {customerName},\n\nYour internet subscription will expire on {expiryDate}.\n\nPackage: {packageName}\nAmount Due: {amount}\n\nPlease recharge before expiry to continue uninterrupted service.\n\nThank you,\n{ispName}'
  },
  {
    channel: 'EMAIL',
    eventKey: 'recharge_success',
    name: 'Recharge Successful',
    subject: 'Recharge Successful',
    body: 'Dear {customerName},\n\nYour recharge was successful.\n\nPackage: {packageName}\nAmount: {amount}\nValid Until: {expiryDate}\n\nThank you,\n{ispName}'
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
      `SELECT id FROM message_templates WHERE ispId = ? AND channel = ? AND eventKey = ? AND isDefault = true LIMIT 1`,
      ispId,
      template.channel,
      template.eventKey
    );
    if (existing.length) continue;
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

function renderText(text = '', data = {}) {
  return String(text).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function textToHtml(text = '') {
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
  const rendered = {
    subject: renderText(template.subject || fallback.subject || '', data),
    body: renderText(template.body || fallback.body || '', data)
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
