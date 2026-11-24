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

function parseBackupEmails(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

async function sendBackupEmail(prisma, ispId, recipientEmail) {
  const mailHelper = require('../utils/mailHelper');
  const recipients = parseBackupEmails(recipientEmail);
  if (recipients.length === 0) {
    throw new Error('At least one valid recipient email is required');
  }
  const { buffer, filename } = await createDatabaseBackupBuffer(prisma);
  await mailHelper.sendMail(ispId, {
    to: recipients.join(', '),
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
  const recipients = parseBackupEmails(email);
  if (!enabled || recipients.length === 0 || !cron.validate(cronExpression)) return;
  const task = cron.schedule(cronExpression, async () => {
    try {
      await sendBackupEmail(prisma, ispId, recipients.join(', '));
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
      messages = true,
      radius = true
    } = options;

    const summary = {};
    const ispId = Number(req.ispId);

    const safeTruncate = async (tx, label, tableName) => {
      try {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${tableName}\``);
        summary[label] = 'truncated';
      } catch (err) {
        summary[label] = `skipped (${err.message.split('\n')[0]})`;
      }
    };

    const safeExec = async (tx, label, sql) => {
      try {
        await tx.$executeRawUnsafe(sql);
        summary[label] = 'done';
      } catch (err) {
        summary[label] = `skipped (${err.message.split('\n')[0]})`;
      }
    };

    await req.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      try {
        if (billing || customers) {
          await safeTruncate(tx, 'orderDetails', 'OrderDetail');
          await safeTruncate(tx, 'eSewaPayments', 'ESewaTokenPayment');
          await safeTruncate(tx, 'externalPayments', 'ExternalPayment');
          await safeTruncate(tx, 'orders', 'CustomerOrderManagement');
          if (billing) {
            await safeTruncate(tx, 'invoiceRanges', 'branch_invoice_ranges');
          }
        }

        if (ticketsTasks) {
          await safeTruncate(tx, 'ticketComments', 'ticket_comments');
          await safeTruncate(tx, 'taskActivityLogs', 'task_activity_logs');
          await safeTruncate(tx, 'tasks', 'task');
          await safeTruncate(tx, 'tickets', 'tickets');
        }

        if (messages || customers || ticketsTasks) {
          await safeTruncate(tx, 'messages', 'messages');
        }

        if (customers) {
          await safeExec(tx, 'unlinkPortalUsers', 'UPDATE `User` SET customerId = NULL WHERE customerId IS NOT NULL');
          if (!ticketsTasks) {
            await safeExec(tx, 'unlinkTicketCustomers', 'UPDATE `tickets` SET customerId = NULL WHERE customerId IS NOT NULL');
          }
          await safeTruncate(tx, 'branchRequests', 'branch_requests');
          await safeTruncate(tx, 'customerDocuments', 'CustomerDocument');
          await safeTruncate(tx, 'customerDevices', 'CustomerDevice');
          await safeTruncate(tx, 'customerWifiCredentials', 'CustomerWiFiCredential');
          await safeTruncate(tx, 'customerReferrals', 'CustomerReferral');
          await safeTruncate(tx, 'customerSubscribedServices', 'CustomerSubscribedService');
          await safeTruncate(tx, 'customerSubscriptions', 'CustomerSubscription');
          await safeTruncate(tx, 'connectionUsers', 'ConnectionUser');
          await safeTruncate(tx, 'customerServiceConnections', 'CustomerServiceConnection');
          await safeTruncate(tx, 'customers', 'Customer');
        }

        if (leads) {
          if (!ticketsTasks) {
            await safeExec(tx, 'unlinkTicketLeads', 'UPDATE `tickets` SET leadId = NULL WHERE leadId IS NOT NULL');
          }
          await safeTruncate(tx, 'followUps', 'FollowUp');
          await safeTruncate(tx, 'leads', 'lead');
        }

        if (packages) {
          if (!leads) {
            await safeExec(tx, 'unlinkLeadPackages', 'UPDATE `lead` SET interestedPackageId = NULL WHERE interestedPackageId IS NOT NULL');
          }
          if (!customers) {
            await safeExec(tx, 'unlinkCustomerPackages', 'UPDATE `Customer` SET assignedPkg = NULL, subscribedPkgId = NULL WHERE assignedPkg IS NOT NULL OR subscribedPkgId IS NOT NULL');
          }
          await safeTruncate(tx, 'packagePlanBranches', 'package_plan_branches');
          await safeTruncate(tx, 'packageOneTimeCharges', '_packageonetimecharges');
          await safeTruncate(tx, 'packageOneTimeChargesCamel', '_PackageOneTimeCharges');
          await safeTruncate(tx, 'packagePrices', 'PackagePrice');
          await safeTruncate(tx, 'packagePlans', 'PackagePlan');
        }
      } finally {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      }
    }, { maxWait: 10000, timeout: 120000 });

    if (radius) {
      try {
        const radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
        if (radiusClient) {
          const deleteAllPages = async (fetchFn, delFn) => {
            let totalDeleted = 0;
            for (let pass = 0; pass < 200; pass++) {
              const rows = await fetchFn().catch(() => []);
              const list = Array.isArray(rows) ? rows : (Array.isArray(rows?.data) ? rows.data : []);
              if (list.length === 0) break;
              let passDeleted = 0;
              for (let i = 0; i < list.length; i += 25) {
                const chunk = list.slice(i, i + 25);
                const results = await Promise.all(
                  chunk.map(item => (item?.id != null ? delFn(item.id).then(() => 1).catch(() => 0) : Promise.resolve(0)))
                );
                passDeleted += results.reduce((a, b) => a + b, 0);
              }
              totalDeleted += passDeleted;
              if (passDeleted === 0) break;
            }
            return totalDeleted;
          };

          const [rc, rr, rug, rgc, rgr] = await Promise.all([
            deleteAllPages(() => radiusClient.getRadcheck(500, 0), id => radiusClient.deleteRadcheck(id)),
            deleteAllPages(() => radiusClient.getRadreply(), id => radiusClient.deleteRadreply(id)),
            deleteAllPages(() => radiusClient.getRadusergroup(), id => radiusClient.deleteRadusergroup(id)),
            deleteAllPages(() => radiusClient.getRadgroupcheck(), id => radiusClient.deleteRadgroupcheck(id)),
            deleteAllPages(() => radiusClient.getRadgroupreply(), id => radiusClient.deleteRadgroupreply(id)),
          ]);
          summary.radius = `cleared (radcheck=${rc}, radreply=${rr}, radusergroup=${rug}, radgroupcheck=${rgc}, radgroupreply=${rgr}; NAS & api_users preserved)`;
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
    const recipients = parseBackupEmails(email);
    if (enabled && recipients.length === 0) {
      return res.status(400).json({ error: 'At least one valid recipient email is required when schedule is enabled' });
    }
    const normalizedEmails = recipients.join(', ');

    const entries = [
      ['dbBackupCronEnabled', String(Boolean(enabled))],
      ['dbBackupCronExpression', String(cronExpression).trim()],
      ['dbBackupEmail', normalizedEmails || String(email).trim()]
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
    const recipients = parseBackupEmails(email);
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'At least one valid recipient email is required' });
    }
    await sendBackupEmail(req.prisma, req.ispId, recipients.join(', '));
    return res.json({ success: true, message: `Backup sent to ${recipients.join(', ')}` });
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
