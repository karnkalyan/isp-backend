const smsHelper = require('../utils/smsHelper');

async function runCustomerLifecycle(prisma) {
  const isps = await prisma.iSP.findMany({ select: { id: true } });
  const now = Date.now();
  for (const isp of isps) {
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
