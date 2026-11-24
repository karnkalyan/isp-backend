async function getUnpaidCreditOrders(prisma, customerId) {
  if (!customerId) return [];
  return prisma.customerOrderManagement.findMany({
    where: {
      customerId: Number(customerId),
      isPaid: false,
      isDeleted: false,
      isActive: true
    },
    orderBy: { createdAt: 'asc' },
    include: {
      items: true
    }
  });
}

async function resolveGatewayDueContext({
  prisma,
  customer,
  subscription,
  packagePrice,
  aggregatedItems,
  requestedPackageId
}) {
  const unpaidOrders = await getUnpaidCreditOrders(prisma, customer?.id);
  if (unpaidOrders.length === 0) {
    return {
      totalAmount: packagePrice,
      aggregatedItems,
      unpaidOrderIds: [],
      payOnlyInvoices: false
    };
  }

  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  const unpaidItems = unpaidOrders.flatMap(o => {
    if (Array.isArray(o.items) && o.items.length > 0) {
      return o.items.map(it => ({
        type: 'oneTime',
        name: `${it.itemName} (Inv #${o.invoiceId || o.id})`,
        amount: Number(it.itemPrice || 0),
        referenceId: it.referenceId || null
      }));
    }
    return [{
      type: 'oneTime',
      name: `Unpaid Invoice #${o.invoiceId || o.id}`,
      amount: Number(o.totalAmount || 0),
      referenceId: null
    }];
  });

  const subActiveAndNotExpired = Boolean(subscription?.planEnd && new Date(subscription.planEnd) > new Date());
  const onlyStandaloneInvoices = unpaidOrders.every(o => !o.package);
  const payOnlyInvoices = subActiveAndNotExpired && !requestedPackageId && onlyStandaloneInvoices;

  if (payOnlyInvoices) {
    return {
      totalAmount: Math.round(unpaidTotal * 100) / 100,
      aggregatedItems: unpaidItems,
      unpaidOrderIds: unpaidOrders.map(o => o.id),
      payOnlyInvoices: true
    };
  }

  return {
    totalAmount: Math.round((Number(packagePrice || 0) + unpaidTotal) * 100) / 100,
    aggregatedItems: [...aggregatedItems, ...unpaidItems],
    unpaidOrderIds: unpaidOrders.map(o => o.id),
    payOnlyInvoices: false
  };
}

async function markUnpaidCreditOrdersPaid(tx, unpaidOrderIds, paymentCode, paymentMethodId = null) {
  if (!Array.isArray(unpaidOrderIds) || unpaidOrderIds.length === 0) return;
  await tx.customerOrderManagement.updateMany({
    where: { id: { in: unpaidOrderIds.map(Number) }, isPaid: false },
    data: {
      isPaid: true,
      paymentId: paymentCode,
      ...(paymentMethodId ? { paymentMethodId: Number(paymentMethodId) } : {}),
      updatedAt: new Date()
    }
  });
}

module.exports = {
  getUnpaidCreditOrders,
  resolveGatewayDueContext,
  markUnpaidCreditOrdersPaid
};
