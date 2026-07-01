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
  }
}

module.exports = { runCustomerLifecycle };
