const smsHelper = require('../utils/smsHelper');
const RadiusClient = require('./radiusClient');

async function reconcilePausedRadiusUsers(prisma, ispId) {
  const pausedSubscriptions = await prisma.customerSubscription.findMany({
    where: {
      isActive: true,
      isPaused: true,
      customer: { ispId, isDeleted: false }
    },
    select: {
      customer: {
        select: {
          connectionUsers: {
            where: { isDeleted: false, isActive: true },
            select: { username: true }
          }
        }
      }
    }
  });
  const usernames = [...new Set(pausedSubscriptions.flatMap(subscription =>
    subscription.customer.connectionUsers.map(user => user.username).filter(Boolean)
  ))];
  if (!usernames.length) return;

  try {
    const radius = await RadiusClient.create(ispId);
    const pausedAt = new Date();
    for (const username of usernames) {
      await radius.updateExpiration(username, pausedAt);
      let disconnectedBySessionId = false;
      try {
        const sessionInfo = await radius.getSessionInfo(username);
        const sessions = Array.isArray(sessionInfo)
          ? sessionInfo
          : Array.isArray(sessionInfo?.sessions)
            ? sessionInfo.sessions
            : Array.isArray(sessionInfo?.data)
              ? sessionInfo.data
              : Array.isArray(sessionInfo?.data?.sessions)
                ? sessionInfo.data.sessions
                : [];
        for (const session of sessions.filter(item => !item.acctstoptime && !item.acctStopTime && !item.stop_time)) {
          const sessionId = session.acctsessionid || session.acctSessionId || session.session_id || session.sessionId;
          if (!sessionId) continue;
          await radius.disconnectBySessionId(sessionId);
          disconnectedBySessionId = true;
        }
      } catch (error) {
        console.warn(`[CUSTOMER LIFECYCLE] Session-ID disconnect failed for ${username}:`, error.message);
      }
      if (!disconnectedBySessionId) {
        await radius.disconnectAllSessions(username).catch(error =>
          console.warn(`[CUSTOMER LIFECYCLE] Username disconnect failed for ${username}:`, error.message)
        );
      }
    }
    console.log(`[CUSTOMER LIFECYCLE] Reconciled ${usernames.length} paused RADIUS user(s) for ISP ${ispId}`);
  } catch (error) {
    console.error(`[CUSTOMER LIFECYCLE] Paused RADIUS reconciliation failed for ISP ${ispId}:`, error.message);
  }
}

async function runCustomerLifecycle(prisma) {
  const isps = await prisma.iSP.findMany({ select: { id: true } });
  const now = Date.now();
  for (const isp of isps) {
    await reconcilePausedRadiusUsers(prisma, isp.id);
    const rows = await prisma.iSPSettings.findMany({ where: { ispId: isp.id, key: { in: ['expiredTerminateDays', 'expiredSoftDeleteDays'] } } });
    const values = Object.fromEntries(rows.map(row => [row.key, Math.max(0, Number(row.value) || 0)]));
    for (const [action, days] of [['terminate', values.expiredTerminateDays], ['delete', values.expiredSoftDeleteDays]]) {
      if (!days) continue;
      const cutoff = new Date(now - days * 86400000);
      const customers = await prisma.customer.findMany({
        where: { ispId: isp.id, isDeleted: false, customerSubscriptions: { some: { planEnd: { lte: cutoff } }, none: { planEnd: { gt: cutoff }, isActive: true } } },
        select: { id: true }
      });
      const ids = customers.map(customer => customer.id);
      if (!ids.length) continue;
      if (action === 'terminate') {
        await prisma.$transaction([
          prisma.customer.updateMany({ where: { id: { in: ids }, isDeleted: false }, data: { status: 'terminated' } }),
          prisma.connectionUser.updateMany({ where: { customerId: { in: ids }, isDeleted: false }, data: { isActive: false } }),
          prisma.customerServiceConnection.updateMany({ where: { customerId: { in: ids } }, data: { status: 'terminated' } })
        ]);
      } else {
        await prisma.customer.updateMany({ where: { id: { in: ids } }, data: { isDeleted: true, status: 'deleted' } });
      }
      console.log(`[CUSTOMER LIFECYCLE] ${action} applied to ${ids.length} customer(s) for ISP ${isp.id}`);
    }

    // Expiring subscriptions notification check (once a day: hour between 0 and 6)
    const currentHour = new Date().getHours();
    if (currentHour >= 0 && currentHour < 6) {
      try {
        const threeDaysFromNowStart = new Date();
        threeDaysFromNowStart.setDate(threeDaysFromNowStart.getDate() + 3);
        threeDaysFromNowStart.setHours(0, 0, 0, 0);
        const threeDaysFromNowEnd = new Date(threeDaysFromNowStart);
        threeDaysFromNowEnd.setHours(23, 59, 59, 999);

        const expiringSubs = await prisma.customerSubscription.findMany({
          where: {
            customer: { ispId: isp.id, isDeleted: false },
            isActive: true,
            planEnd: { gte: threeDaysFromNowStart, lte: threeDaysFromNowEnd }
          },
          include: {
            customer: { include: { lead: true } },
            packagePrice: { include: { packagePlanDetails: { select: { planName: true } } } }
          }
        });

        for (const sub of expiringSubs) {
          const customer = sub.customer;
          const lead = customer.lead;
          if (lead?.phoneNumber) {
            const customerTemplateData = {
              customerName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Customer',
              packageName: sub.packagePrice?.packagePlanDetails?.planName || sub.packagePrice?.packageName || 'Package',
              expiryDate: new Date(sub.planEnd).toLocaleDateString(),
              amount: sub.packagePrice?.price || 0,
              customerUniqueId: customer.customerUniqueId || `CUST-${customer.id}`,
              phoneNumber: lead.phoneNumber
            };

            await smsHelper.sendEventSms(isp.id, 'subscription_expiring', customerTemplateData)
              .catch(err => console.error('[LIFECYCLE SMS ERROR]', err.message));
          }
        }
      } catch (err) {
        console.error('[LIFECYCLE SMS PROCESS ERROR]', err.message);
      }
    }
  }
}

module.exports = { runCustomerLifecycle };
