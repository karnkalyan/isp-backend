const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cron = require('node-cron');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

const execAsync = promisify(exec);
const TRUNCATE_SECRET = 'Kasvian@123Kalyan!@#';
const activeBackupTasks = new Map();

function isSystemAdmin(req) {
  const role = String(typeof req.user?.role === 'string' ? req.user.role : req.user?.role?.name || '').toLowerCase();
  return ['admin', 'isp_admin', 'administrator', 'super_admin', 'global admin', 'global_admin', 'super admin'].includes(role);
}

function parseMysqlUrl(dbUrl) {
  try {
    const u = new URL(dbUrl);
    return {
      host: u.hostname || 'localhost',
      port: u.port || '3306',
      user: decodeURIComponent(u.username || 'root'),
      password: decodeURIComponent(u.password || ''),
      database: u.pathname.replace(/^\//, '').split('?')[0]
    };
  } catch {
    return null;
  }
}

async function createDatabaseBackupBuffer(prisma) {
  const dbInfo = parseMysqlUrl(process.env.DATABASE_URL || '');
  const tmpFile = path.join(os.tmpdir(), `isp-backup-${Date.now()}.sql`);
  if (dbInfo && dbInfo.database) {
    try {
      const passArg = dbInfo.password ? `-p"${dbInfo.password}"` : '';
      const cmd = `mysqldump -h "${dbInfo.host}" -P ${dbInfo.port} -u "${dbInfo.user}" ${passArg} --single-transaction --routines --triggers "${dbInfo.database}" > "${tmpFile}"`;
      await execAsync(cmd, { timeout: 120000 });
      if (fs.existsSync(tmpFile) && fs.statSync(tmpFile).size > 0) {
        const buf = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        return { buffer: buf, filename: `${dbInfo.database}-${new Date().toISOString().slice(0, 10)}.sql`, contentType: 'application/sql' };
      }
    } catch (e) {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }

  // Fallback logical JSON snapshot if mysqldump is unavailable
  const [isps, users, customers, plans, prices, orders] = await Promise.all([
    prisma.iSP.findMany().catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true, email: true, roleId: true, ispId: true, branchId: true } }).catch(() => []),
    prisma.customer.findMany().catch(() => []),
    prisma.packagePlan.findMany().catch(() => []),
    prisma.packagePrice.findMany().catch(() => []),
    prisma.customerOrderManagement.findMany({ include: { items: true } }).catch(() => [])
  ]);
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), isps, users, customers, plans, prices, orders }, null, 2);
  return { buffer: Buffer.from(json, 'utf8'), filename: `isp-backup-${new Date().toISOString().slice(0, 10)}.json`, contentType: 'application/json' };
}

async function sendBackupEmail(prisma, ispId, recipientEmail) {
  const mailHelper = require('../utils/mailHelper');
  const { buffer, filename } = await createDatabaseBackupBuffer(prisma);
  await mailHelper.sendMail(ispId, {
    to: recipientEmail,
    subject: `Database Backup - ${new Date().toISOString().slice(0, 10)}`,
    html: `<p>Attached is your scheduled database backup (<strong>${filename}</strong>) generated at ${new Date().toLocaleString()}.</p>`,
    attachments: [{ filename, content: buffer }]
  }, { ignoreNotificationSetting: true });
}

function scheduleBackupJob(prisma, ispId, enabled, cronExpression, email) {
  const key = String(ispId);
  if (activeBackupTasks.has(key)) {
    try { activeBackupTasks.get(key).stop(); } catch {}
    activeBackupTasks.delete(key);
  }
  if (!enabled || !email || !cron.validate(cronExpression)) return;
  const task = cron.schedule(cronExpression, async () => {
    try {
      await sendBackupEmail(prisma, ispId, email);
    } catch (err) {
      console.error(`[DB BACKUP CRON] Failed for ISP ${ispId}:`, err.message);
    }
  });
  activeBackupTasks.set(key, task);
}

async function truncateDatabase(req, res, next) {
  try {
    if (!isSystemAdmin(req)) {
      return res.status(403).json({ error: 'Only system administrators can truncate database data.' });
    }
    const { password, options = {} } = req.body || {};
    if (String(password || '') !== TRUNCATE_SECRET) {
      return res.status(403).json({ error: 'Invalid confirmation password.' });
    }

    const {
      customers = true,
      leads = true,
      packages = true,
      billing = true,
      ticketsTasks = true,
      radius = true
    } = options;

    const summary = {};
    const ispId = Number(req.ispId);

    const safeDelete = async (label, fn) => {
      try {
        const result = await fn();
        summary[label] = result?.count ?? 'done';
      } catch (err) {
        summary[label] = `skipped (${err.message.split('\n')[0]})`;
      }
    };

    if (billing) {
      await safeDelete('orderDetails', () => req.prisma.orderDetail.deleteMany({ where: { order: { customer: { ispId } } } }));
      await safeDelete('eSewaPayments', () => req.prisma.eSewaTokenPayment.deleteMany({ where: { ispId } }));
      await safeDelete('orders', () => req.prisma.customerOrderManagement.deleteMany({ where: { customer: { ispId } } }));
      await safeDelete('invoiceRanges', () => req.prisma.branchInvoiceRange.deleteMany({ where: { branch: { ispId } } }));
    }

    if (ticketsTasks) {
      await safeDelete('tickets', () => req.prisma.ticket.deleteMany({ where: { ispId } }));
      await safeDelete('tasks', () => req.prisma.task.deleteMany({ where: { ispId } }));
    }

    if (customers) {
      await safeDelete('customerSubscriptions', () => req.prisma.customerSubscription.deleteMany({ where: { customer: { ispId } } }));
      await safeDelete('connectionUsers', () => req.prisma.connectionUser.deleteMany({ where: { customer: { ispId } } }));
      await safeDelete('customerServiceConnections', () => req.prisma.customerServiceConnection.deleteMany({ where: { customer: { ispId } } }));
      await safeDelete('customers', () => req.prisma.customer.deleteMany({ where: { ispId } }));
    }

    if (leads) {
      await safeDelete('leads', () => req.prisma.lead.deleteMany({ where: { ispId } }));
    }

    if (packages) {
      await safeDelete('packagePlanBranches', () => req.prisma.packagePlanBranch.deleteMany({ where: { packagePlan: { ispId } } }));
      await safeDelete('packagePrices', () => req.prisma.packagePrice.deleteMany({ where: { ispId } }));
      await safeDelete('packagePlans', () => req.prisma.packagePlan.deleteMany({ where: { ispId } }));
    }

    if (radius) {
      try {
        const radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
        if (radiusClient) {
          // Clear subscriber/package RADIUS entries while preserving NAS
          const tables = ['radcheck', 'radreply', 'radusergroup', 'radacct', 'radgroupcheck', 'radgroupreply'];
          if (typeof radiusClient.query === 'function') {
            for (const tbl of tables) {
              await radiusClient.query(`TRUNCATE TABLE ${tbl}`).catch(() => {});
            }
            summary.radius = 'truncated (NAS preserved)';
          } else if (typeof radiusClient.listUsers === 'function' && typeof radiusClient.deleteUser === 'function') {
            const rUsers = await radiusClient.listUsers().catch(() => []);
            for (const u of (Array.isArray(rUsers) ? rUsers : [])) {
              await radiusClient.deleteUser(u.username || u).catch(() => {});
            }
            summary.radius = 'cleared subscriber entries (NAS preserved)';
          }
        }
      } catch (radErr) {
        summary.radius = `skipped (${radErr.message})`;
      }
    }

    return res.json({ success: true, message: 'Selected data truncated successfully (services, users, settings, and NAS preserved).', summary });
  } catch (err) {
    return next(err);
  }
}

async function downloadBackup(req, res, next) {
  try {
    if (!isSystemAdmin(req)) {
      return res.status(403).json({ error: 'Only system administrators can download database backups.' });
    }
    const { buffer, filename, contentType } = await createDatabaseBackupBuffer(req.prisma);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (err) {
    return next(err);
  }
}

async function getBackupSchedule(req, res, next) {
  try {
    const keys = ['dbBackupCronEnabled', 'dbBackupCronExpression', 'dbBackupEmail'];
    const rows = await req.prisma.iSPSettings.findMany({
      where: { ispId: Number(req.ispId), key: { in: keys } }
    });
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return res.json({
      enabled: map.dbBackupCronEnabled === 'true',
      cronExpression: map.dbBackupCronExpression || '0 2 * * *',
      email: map.dbBackupEmail || ''
    });
  } catch (err) {
    return next(err);
  }
}

async function saveBackupSchedule(req, res, next) {
  try {
    if (!isSystemAdmin(req)) {
      return res.status(403).json({ error: 'Only system administrators can configure backup schedules.' });
    }
    const { enabled, cronExpression = '0 2 * * *', email = '' } = req.body || {};
    if (enabled && !cron.validate(String(cronExpression))) {
      return res.status(400).json({ error: 'Invalid cron expression (e.g. 0 2 * * *)' });
    }
    if (enabled && !String(email).includes('@')) {
      return res.status(400).json({ error: 'Valid recipient email is required when schedule is enabled' });
    }

    const entries = [
      ['dbBackupCronEnabled', String(Boolean(enabled))],
      ['dbBackupCronExpression', String(cronExpression).trim()],
      ['dbBackupEmail', String(email).trim()]
    ];
    for (const [key, value] of entries) {
      const existing = await req.prisma.iSPSettings.findFirst({
        where: { ispId: Number(req.ispId), key }
      });
      if (existing) {
        await req.prisma.iSPSettings.update({ where: { id: existing.id }, data: { value } });
      } else {
        await req.prisma.iSPSettings.create({ data: { ispId: Number(req.ispId), key, value } });
      }
    }

    scheduleBackupJob(req.prisma, req.ispId, Boolean(enabled), String(cronExpression).trim(), String(email).trim());
    return res.json({ success: true, message: 'Backup schedule saved' });
  } catch (err) {
    return next(err);
  }
}

async function sendBackupNow(req, res, next) {
  try {
    if (!isSystemAdmin(req)) {
      return res.status(403).json({ error: 'Only system administrators can send database backups.' });
    }
    const { email } = req.body || {};
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'Valid recipient email is required' });
    }
    await sendBackupEmail(req.prisma, req.ispId, String(email).trim());
    return res.json({ success: true, message: `Backup sent to ${email}` });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  truncateDatabase,
  downloadBackup,
  getBackupSchedule,
  saveBackupSchedule,
  sendBackupNow
};
