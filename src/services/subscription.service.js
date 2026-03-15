async function getCustomerPackageDetails(prisma, ispId, customerId) {
  const customer = await prisma.customer.findUnique({
    where: { 
      id: Number(customerId), 
      ispId: ispId, 
      isDeleted: false 
    },
    include: {
      subscribedPkg: {
        select: {
          id: true,
          packageName: true,
          price: true,
          packageDuration: true,
          referenceId: true,
          oneTimeCharges: {
            where: { isDeleted: false },
            select: { id: true, name: true, amount: true, referenceId: true }
          }
        }
      }
    }
  });

  if (!customer) {
    throw new Error('Customer not found');
  }

  if (!customer.subscribedPkg) {
    throw new Error('Customer has no subscribed package');
  }

  const pkg = customer.subscribedPkg;
  const isRechargeable = Boolean(customer.rechargeable);
  const packagePrice = Number(pkg.price || 0);

  const otcItems = isRechargeable
    ? []
    : (pkg.oneTimeCharges || []).map(o => ({
        id: o.id,
        name: o.name || "addon",
        referenceId: o.referenceId || null,
        amount: Number(o.amount || 0)
      }));

  const otcTotal = otcItems.reduce((s, it) => s + it.amount, 0);
  const totalAmount = packagePrice + otcTotal;

  return {
    customer: customer,
    package: pkg,
    packagePrice: packagePrice,
    otcItems: otcItems,
    otcTotal: otcTotal,
    totalAmount: totalAmount,
    isRechargeable: isRechargeable
  };
}

/**
 * Create subscription order (similar to subscribePackage with createOrder = true)
 */
async function createSubscriptionOrder(prisma, ispId, customerId) {
  // Get package details first
  const packageDetails = await getCustomerPackageDetails(prisma, ispId, customerId);
  
  const { customer, package: pkg, totalAmount, otcItems, packagePrice } = packageDetails;

  // Find active subscription
  const subscription = await prisma.customerSubscription.findFirst({
    where: {
      customerId: Number(customerId),
      isActive: true
    },
    orderBy: { createdAt: "desc" }
  });

  if (!subscription) {
    throw new Error('No active subscription found for this customer & package');
  }

  // Calculate expiry (you need to implement/compute this)
  const previousPlanEnd = subscription.planEnd ? new Date(subscription.planEnd) : new Date();
  const durationStr = String(pkg.packageDuration || "1 month");
  const expiryDateObj = computeExpiryFromBase(previousPlanEnd, durationStr); // Implement this

  const orderItemsData = [
    {
      itemName: pkg.packageName || "Base Package",
      referenceId: pkg.referenceId || null,
      itemPrice: packagePrice
    },
    ...otcItems.map(it => ({
      itemName: it.name,
      referenceId: it.referenceId,
      itemPrice: it.amount
    }))
  ];

  // Create order in transaction
  const createdOrder = await prisma.$transaction(async tx => {
    const updatedSubData = {
      planEnd: expiryDateObj,
      isTrial: false,
      isInvoicing: true
    };

    if (subscription.isTrial) {
      updatedSubData.planStart = new Date();
    }

    const updatedSubscription = await tx.customerSubscription.update({
      where: { id: subscription.id },
      data: updatedSubData
    });

    if (!customer.rechargeable) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { rechargeable: true }
      });
    }

    const created = await tx.customerOrderManagement.create({
      data: {
        customer: { connect: { id: customer.id } },
        subscription: { connect: { id: updatedSubscription.id } },
        packagePrice: { connect: { id: pkg.id } },
        packageStart: previousPlanEnd,
        packageEnd: updatedSubscription.planEnd,
        totalAmount,
        orderDate: new Date(),
        isActive: true,
        isDeleted: false,
        isPaid: true,
        paymentMethod: 'ESEWA_TOKEN',
        items: {
          create: orderItemsData.map(it => ({
            itemName: it.itemName,
            referenceId: it.referenceId,
            itemPrice: it.itemPrice
          }))
        }
      },
      include: { items: true }
    });

    return created;
  });

  // Handle Radius provisioning (if needed)
  // Handle Tshul invoice creation (if needed)
  
  return {
    order: createdOrder,
    subscription: subscription,
    customer: customer
  };
}

module.exports = {
  getCustomerPackageDetails,
  createSubscriptionOrder
};