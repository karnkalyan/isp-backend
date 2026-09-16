const crypto = require('crypto');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const { syncOrderToAccounting } = require('../services/accountingInvoice.service');
const { logAudit } = require('../utils/auditLogger');
const { atPlanBoundary, getDeductibleRenewalBase } = require('../utils/dateHelper');

async function syncExternalPaymentAccounting(prisma, ispId, orderId) {
  try {
    return await syncOrderToAccounting(prisma, ispId, orderId);
  } catch (error) {
    console.error('[EXTERNAL PAYMENT ACCOUNTING] Sales invoice sync failed:', { ispId, orderId, error: error.message });
    return null;
  }
}

function buildPackageOrderItems(pkg, charges, isFree = false) {
  const resolvedCharges = (charges || []).map(item => ({
    itemName: item.name || 'Package item',
    referenceId: item.referenceId || null,
    itemPrice: isFree ? 0 : Number(item.amount || 0)
  }));
  const itemTotal = resolvedCharges.reduce((sum, item) => sum + item.itemPrice, 0);
  const packageSubtotal = isFree ? 0 : Number(pkg.price || 0);
  const remainder = Math.max(0, packageSubtotal - itemTotal);
  return [
    ...(remainder > 0 || resolvedCharges.length === 0 ? [{
      itemName: pkg.packageName || 'Base Package',
      referenceId: pkg.referenceId || null,
      itemPrice: remainder
    }] : []),
    ...resolvedCharges
  ];
}

function generateExternalReferenceCode(orderId) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(6).toString('hex').toUpperCase();
  const orderNumber = String(orderId || 0).padStart(2, '0');
  return `EXT-${date}-${random}-${orderNumber}`;
}

function getRenewalBase(subscription, now = new Date()) {
  return getDeductibleRenewalBase(subscription, now);
}

async function getRenewalWindow(prisma, ispId, subscription) {
  const now = atPlanBoundary();
  if (Number(subscription?.graceDaysBalance || 0) + Number(subscription?.adminExtensionDays || 0) > 0) {
    return { planStart: getRenewalBase(subscription, now), trialDeductionDays: 0 };
  }
  if (!subscription?.isTrial) return { planStart: getRenewalBase(subscription, now), trialDeductionDays: 0 };
  const setting = await prisma.iSPSettings.findFirst({ where: { ispId: Number(ispId), key: 'trialDeductionOnSubscriptionActivation' } });
  const trialMs = Math.max(0, new Date(subscription.planEnd) - new Date(subscription.planStart));
  return { planStart: now, trialDeductionDays: setting?.value === 'true' ? Math.ceil(trialMs / 86400000) : 0 };
}

function computeExpiryFromBase(baseDateOrDuration, maybeDuration) {
  let baseDate;
  let durationString;

  const isProbablyDate = (v) => {
    if (v instanceof Date) return true;
    if (typeof v === 'number') return true;
    if (typeof v === 'string') {
      return /^\d{4}-\d{2}-\d{2}/.test(v);
    }
    return false;
  };

  if (baseDateOrDuration === undefined || baseDateOrDuration === null) {
    baseDate = new Date();
    durationString = maybeDuration;
  } else if (isProbablyDate(baseDateOrDuration) && maybeDuration !== undefined) {
    baseDate = new Date(baseDateOrDuration);
    durationString = maybeDuration;
  } else if (isProbablyDate(baseDateOrDuration) && maybeDuration === undefined) {
    baseDate = new Date(baseDateOrDuration);
    durationString = undefined;
  } else {
    baseDate = new Date();
    durationString = String(baseDateOrDuration);
  }

  if (!(baseDate instanceof Date) || isNaN(baseDate.getTime())) {
    baseDate = new Date();
  }

  const date = new Date(baseDate);

  if (!durationString && durationString !== 0) {
    date.setMonth(date.getMonth() + 1);
    return date;
  }

  let s = String(durationString).trim().toLowerCase()
    .replace(/\u00A0/g, ' ')
    .replace(/–|—/g, '-')
    .replace(/\s+/g, ' ');

  const isoMatch = s.match(/^p\s*(\d+)\s*([dmy])$/i);
  if (isoMatch) {
    const v = parseInt(isoMatch[1], 10);
    const u = isoMatch[2].toLowerCase();
    if (u === 'd') { date.setDate(date.getDate() + v); return date; }
    if (u === 'm') { date.setMonth(date.getMonth() + v); return date; }
    if (u === 'y') { date.setFullYear(date.getFullYear() + v); return date; }
  }

  const re = /(\d+)\s*(?:-?\s*)?(d(?:ays?)?|day|m(?:o(?:nths?)?)?|mo|month(?:s)?|months?|y(?:ears?|r)?|yr|year(?:s)?)/i;
  const m = s.match(re);

  if (!m) {
    const anyNum = s.match(/(\d+)/);
    if (anyNum) {
      date.setMonth(date.getMonth() + parseInt(anyNum[1], 10));
      return date;
    }
    date.setMonth(date.getMonth() + 1);
    return date;
  }

  const value = parseInt(m[1], 10);
  let unit = m[2].toLowerCase();

  if (unit.startsWith('d')) unit = 'day';
  else if (unit.startsWith('m')) unit = 'month';
  else if (unit.startsWith('y') || unit === 'yr') unit = 'year';

  if (unit === 'day') date.setDate(date.getDate() + value);
  else if (unit === 'month') date.setMonth(date.getMonth() + value);
  else if (unit === 'year') date.setFullYear(date.getFullYear() + value);

  return date;
}

const getCustomerContext = async (req, lookupValue, packageId = null, desiredDuration = null, desiredPackageName = null) => {
  if (!lookupValue) {
    const error = new Error("Customer identifier (username / customer ID / phone / email) is required");
    error.code = "01";
    error.statusCode = 400;
    throw error;
  }

  const prisma = req.prisma || require('../../../backend/prisma/client');
  const cleanLookup = String(lookupValue).trim();

  // Build OR conditions matching eSewa logic + connection username priority
  const orConditions = [];
  const parsedId = Number(cleanLookup);
  if (!Number.isNaN(parsedId)) {
    orConditions.push({ id: parsedId });
  }
  orConditions.push({ customerUniqueId: cleanLookup });
  orConditions.push({ lead: { phoneNumber: cleanLookup } });
  orConditions.push({ lead: { secondaryContactNumber: cleanLookup } });
  orConditions.push({ lead: { email: cleanLookup } });
  orConditions.push({ portalUser: { email: cleanLookup } });
  orConditions.push({ connectionUsers: { some: { username: cleanLookup, isDeleted: false } } });

  const customer = await prisma.customer.findFirst({
    where: {
      ispId: req.ispId,
      isDeleted: false,
      OR: orConditions
    },
    include: {
      lead: {
        select: {
          firstName: true,
          middleName: true,
          lastName: true,
          phoneNumber: true,
          email: true,
          status: true
        }
      },
      portalUser: {
        select: { email: true }
      },
      connectionUsers: {
        where: { isDeleted: false },
        select: { id: true, username: true, isActive: true }
      },
      customerSubscriptions: {
        where: { isActive: true },
        orderBy: { planEnd: "desc" },
        take: 1,
        select: { id: true, planStart: true, planEnd: true, isTrial: true, package: true, graceDaysBalance: true, adminExtensionDays: true }
      },
      subscribedPkg: {
        select: {
          id: true,
          packageName: true,
          price: true,
          initialTotalWithTax: true,
          renewAmountWithTax: true,
          packageDuration: true,
          referenceId: true,
          planId: true,
          oneTimeCharges: {
            where: { isDeleted: false },
            select: { id: true, name: true, amount: true, referenceId: true, isRenewal: true }
          }
        }
      }
    }
  });

  if (!customer) {
    const error = new Error(`Customer not found for identifier: '${cleanLookup}'`);
    error.code = "02";
    error.statusCode = 404;
    throw error;
  }

  let pkg = customer.subscribedPkg;
  if (!pkg) {
    const error = new Error("Customer has no subscribed package configured");
    error.code = "03";
    error.statusCode = 404;
    throw error;
  }

  // If specific packageId or packageName requested, resolve matching package under same plan
  if (packageId && Number(packageId) !== pkg.id) {
    const selectedPkg = await prisma.packagePrice.findFirst({
      where: {
        id: Number(packageId),
        planId: pkg.planId,
        isDeleted: false,
        isActive: true
      },
      select: {
        id: true,
        packageName: true,
        price: true,
        initialTotalWithTax: true,
        renewAmountWithTax: true,
        packageDuration: true,
        referenceId: true,
        planId: true,
        oneTimeCharges: {
          where: { isDeleted: false },
          select: { id: true, name: true, amount: true, referenceId: true, isRenewal: true }
        }
      }
    });

    if (selectedPkg) {
      pkg = selectedPkg;
    }
  } else if (desiredPackageName && String(desiredPackageName).trim() !== '') {
    // If specific packageName provided (e.g. "75Mbps - 12 Months", "75mb")
    const cleanPkgName = String(desiredPackageName).trim();
    const matchingPkg = await prisma.packagePrice.findFirst({
      where: {
        planId: pkg.planId,
        packageName: { contains: cleanPkgName },
        isDeleted: false,
        isActive: true
      },
      select: {
        id: true,
        packageName: true,
        price: true,
        initialTotalWithTax: true,
        renewAmountWithTax: true,
        packageDuration: true,
        referenceId: true,
        planId: true,
        oneTimeCharges: {
          where: { isDeleted: false },
          select: { id: true, name: true, amount: true, referenceId: true, isRenewal: true }
        }
      }
    });

    if (matchingPkg) {
      pkg = matchingPkg;
    }
  } else if (desiredDuration && String(desiredDuration).toLowerCase() !== String(pkg.packageDuration).toLowerCase()) {
    // If a duration was provided (e.g. "3 months", "1 year") search for a matching price under same speed plan
    const cleanDur = String(desiredDuration).trim().toLowerCase();
    const allPlanPrices = await prisma.packagePrice.findMany({
      where: {
        planId: pkg.planId,
        isDeleted: false,
        isActive: true
      },
      select: {
        id: true,
        packageName: true,
        price: true,
        initialTotalWithTax: true,
        renewAmountWithTax: true,
        packageDuration: true,
        referenceId: true,
        planId: true,
        oneTimeCharges: {
          where: { isDeleted: false },
          select: { id: true, name: true, amount: true, referenceId: true, isRenewal: true }
        }
      }
    });

    const matchingDurationPkg = allPlanPrices.find(p => {
      const pDur = String(p.packageDuration || '').trim().toLowerCase();
      return pDur === cleanDur || pDur.replace(/\s+/g, '') === cleanDur.replace(/\s+/g, '');
    });

    if (matchingDurationPkg) {
      pkg = matchingDurationPkg;
    }
  }
  // Otherwise, if no duration or package is supplied, defaults exactly to active subscribed package!

  // Calculate Financials
  const isRechargeable = Boolean(customer.isRechargeable);
  const newPackageAmount = pkg.initialTotalWithTax !== null && pkg.initialTotalWithTax !== undefined
    ? Number(pkg.initialTotalWithTax)
    : Number(pkg.price || 0);
  const renewalAmount = pkg.renewAmountWithTax !== null && pkg.renewAmountWithTax !== undefined
    ? Number(pkg.renewAmountWithTax)
    : Number(pkg.price || 0);

  let packagePrice = isRechargeable ? renewalAmount : newPackageAmount;
  if (customer.isFree) packagePrice = 0;

  let otcItems = (pkg.oneTimeCharges || [])
    .filter(o => !isRechargeable || o.isRenewal)
    .map(o => ({
      id: o.id,
      name: o.name || "addon",
      referenceId: o.referenceId || null,
      amount: Number(o.amount || 0)
    }));

  if (customer.isFree) {
    otcItems = otcItems.map(it => ({ ...it, amount: 0 }));
  }

  const otcTotal = otcItems.reduce((s, it) => s + it.amount, 0);
  const totalAmount = packagePrice;

  const aggregatedItems = [
    {
      type: "package",
      name: pkg.packageName || "Base Package",
      amount: Math.max(0, packagePrice - otcTotal),
    },
    ...otcItems.map(it => ({
      type: "oneTime",
      name: it.name,
      amount: it.amount,
      referenceId: it.referenceId || null
    }))
  ];

  const fullName = [customer.lead?.firstName, customer.lead?.middleName, customer.lead?.lastName]
    .filter(Boolean)
    .join(" ");

  const primaryConnectionUsername = customer.connectionUsers?.[0]?.username || cleanLookup;

  return {
    customer,
    pkg,
    isRechargeable,
    packagePrice,
    otcItems,
    totalAmount,
    aggregatedItems,
    fullName,
    primaryConnectionUsername
  };
};

/**
 * Public Inquiry Handler (GET /inquiry/:request_id, POST /inquiry, GET /user/:username)
 */
const paymentInquiry = async (req, res) => {
  const requestId = req.params?.request_id || req.params?.username || req.body?.username || req.body?.customerId || req.body?.request_id;
  const prisma = req.prisma || require('../../../backend/prisma/client');

  try {
    const context = await getCustomerContext(req, requestId);
    const { customer, pkg, totalAmount, fullName, primaryConnectionUsername } = context;

    // Fetch all online-enabled packages under same Speed Plan
    const dbPrices = await prisma.packagePrice.findMany({
      where: {
        planId: pkg.planId,
        isDeleted: false,
        isActive: true
      },
      include: {
        oneTimeCharges: { where: { isDeleted: false } }
      }
    });

    const pricesMap = new Map();
    pricesMap.set(pkg.id, pkg);
    dbPrices.forEach(p => pricesMap.set(p.id, p));

    const isRechargeable = Boolean(customer.isRechargeable);
    const packagesList = Array.from(pricesMap.values()).map(p => {
      const newPackageAmount = p.initialTotalWithTax !== null && p.initialTotalWithTax !== undefined
        ? Number(p.initialTotalWithTax)
        : Number(p.price || 0);
      const renewalAmount = p.renewAmountWithTax !== null && p.renewAmountWithTax !== undefined
        ? Number(p.renewAmountWithTax)
        : Number(p.price || 0);

      const priceToUse = isRechargeable ? renewalAmount : newPackageAmount;
      const finalPrice = customer.isFree ? 0 : priceToUse;

      return {
        id: p.id,
        name: p.packageName,
        duration: p.packageDuration,
        display: `${p.packageName} [ ${p.packageDuration} @ Rs. ${finalPrice} ]`,
        amount: finalPrice,
        initial_amount: newPackageAmount,
        renewal_amount: renewalAmount
      };
    });

    // Get available payment methods
    const paymentMethods = await prisma.billingPaymentMethod.findMany({
      where: { ispId: req.ispId, isEnabled: true },
      select: { code: true, name: true, isDefault: true }
    });

    return res.status(200).json({
      response_code: 0,
      response_message: "success",
      request_id: String(requestId),
      customer: {
        id: customer.id,
        customer_unique_id: customer.customerUniqueId,
        customer_name: fullName,
        username: primaryConnectionUsername,
        phone: customer.lead?.phoneNumber || null,
        email: customer.lead?.email || customer.portalUser?.email || null,
        status: customer.status,
        expiry_date: customer.customerSubscriptions?.[0]?.planEnd
          ? new Date(customer.customerSubscriptions[0].planEnd).toISOString().slice(0, 10)
          : null,
        is_rechargeable: isRechargeable
      },
      current_package: {
        id: pkg.id,
        name: pkg.packageName,
        duration: pkg.packageDuration,
        amount: totalAmount
      },
      packages: packagesList,
      payment_modes: paymentMethods.map(m => ({ code: m.code, name: m.name, default: m.isDefault }))
    });

  } catch (err) {
    console.error("External payment inquiry error:", err);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      request_id: String(requestId || ""),
      response_code: err.code || "99",
      response_message: "FAILED",
      error: err.message || "An unexpected error occurred"
    });
  }
};

/**
 * Public Payment & Direct Recharge Handler (POST /payment, POST /recharge, POST /push)
 */
const processPayment = async (req, res) => {
  const prisma = req.prisma || require('../../../backend/prisma/client');

  // Accept user identifiers flexibly (username, customer_username, request_id, customerId, etc.)
  const lookupValue = req.body.username || req.body.customer_username || req.body.request_id || req.body.customerId || req.body.customer_id;
  const paymentMode = String(req.body.payment_mode || req.body.paymentMode || req.externalPaymentConfig?.defaultPaymentMode || 'EXTERNAL').toUpperCase();
  const duration = req.body.duration || req.body.package_duration || req.body.packageDuration;
  const packageId = req.body.package_id || req.body.packageId;
  const packageName = req.body.package_name || req.body.packageName || req.body.package;
  const inputAmount = req.body.amount !== undefined && req.body.amount !== null ? Number(req.body.amount) : null;
  const transactionCode = req.body.transaction_code || req.body.transactionCode || `EXT-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  try {
    if (!lookupValue) {
      return res.status(400).json({
        response_code: 1,
        response_message: "username (or request_id / customerId) is required"
      });
    }

    // 1. Get Customer Context (resolving customer, target package, duration, pricing)
    const context = await getCustomerContext(req, lookupValue, packageId, duration, packageName);
    const {
      customer, pkg, totalAmount, aggregatedItems,
      fullName, otcItems, primaryConnectionUsername
    } = context;

    // Use input amount if provided, otherwise default to calculated totalAmount
    const finalAmount = inputAmount !== null ? inputAmount : totalAmount;

    // 2. Active Subscription
    let subscription = await prisma.customerSubscription.findFirst({
      where: { customerId: Number(customer.id), isActive: true },
      orderBy: { createdAt: "desc" }
    });

    if (!subscription) {
      // Create subscription if not present
      const now = new Date();
      const planEnd = computeExpiryFromBase(now, pkg.packageDuration || "1 month");
      subscription = await prisma.customerSubscription.create({
        data: {
          customerId: customer.id,
          package: pkg.id,
          planStart: now,
          planEnd: planEnd,
          isActive: true,
          isTrial: false,
          isInvoicing: true
        }
      });
    }

    // 3. Check for existing completed payment with this transaction code to prevent duplicate charges
    const existingPayment = await prisma.externalPayment.findFirst({
      where: { transactionCode }
    });

    if (existingPayment && existingPayment.status === 'COMPLETED') {
      return res.status(200).json({
        response_code: 0,
        response_message: "Payment already processed",
        data: {
          transaction_code: existingPayment.transactionCode,
          reference_code: existingPayment.referenceCode,
          amount: existingPayment.amount,
          status: existingPayment.status
        }
      });
    }

    // 4. Calculate Dates
    const renewalWindow = await getRenewalWindow(prisma, req.ispId, subscription);
    const renewalBase = renewalWindow.planStart;
    const durationStr = String(pkg.packageDuration || duration || "1 month");
    const expiryDateObj = computeExpiryFromBase(renewalBase, durationStr);
    if (renewalWindow.trialDeductionDays > 0) {
      expiryDateObj.setDate(expiryDateObj.getDate() - renewalWindow.trialDeductionDays);
    }
    expiryDateObj.setHours(0, 0, 0, 0);

    const orderItemsData = buildPackageOrderItems(pkg, otcItems, customer.isFree);

    // 5. Billing Payment Method
    let billingMethod = await prisma.billingPaymentMethod.findFirst({
      where: {
        ispId: req.ispId,
        code: paymentMode,
        isEnabled: true
      }
    });

    if (!billingMethod) {
      // Fallback to EXTERNAL or first active payment method
      billingMethod = await prisma.billingPaymentMethod.findFirst({
        where: { ispId: req.ispId, code: 'EXTERNAL' }
      }) || await prisma.billingPaymentMethod.findFirst({
        where: { ispId: req.ispId, isEnabled: true }
      });
    }

    // 6. Execute atomic database transaction
    const result = await prisma.$transaction(async (tx) => {
      // A. Create/Record External Payment
      const paymentRecord = await tx.externalPayment.create({
        data: {
          ispId: req.ispId,
          customerId: customer.id,
          customerUniqueId: customer.customerUniqueId || `CUST-${customer.id}`,
          username: primaryConnectionUsername,
          requestId: String(lookupValue),
          amount: finalAmount,
          paymentMode: paymentMode,
          status: 'COMPLETED',
          transactionCode: transactionCode,
          packageDuration: durationStr,
          packageDetails: {
            packageId: pkg.id,
            packageName: pkg.packageName,
            items: aggregatedItems
          },
          paidAt: new Date(),
          branchId: customer.branchId || null
        }
      });

      // B. Update Subscription
      const updatedSubData = {
        planEnd: expiryDateObj,
        isTrial: false,
        isInvoicing: true,
        extensionCount: 0,
        graceDaysBalance: 0,
        compensationDays: 0,
        adminExtensionDays: 0
      };
      if (subscription.isTrial) updatedSubData.planStart = renewalBase;
      if (pkg.id !== subscription.package) {
        updatedSubData.package = pkg.id;
      }

      const updatedSubscription = await tx.customerSubscription.update({
        where: { id: subscription.id },
        data: updatedSubData
      });

      // C. Update Customer Status & Connections
      const customerUpdateData = {
        isRechargeable: true,
        status: 'active',
        onboardStatus: 'fully_onboarded'
      };
      if (pkg.id !== customer.subscribedPkgId) {
        customerUpdateData.subscribedPkgId = pkg.id;
      }

      await tx.customer.update({
        where: { id: customer.id },
        data: customerUpdateData
      });

      await tx.customerServiceConnection.updateMany({
        where: { customerId: customer.id },
        data: { status: 'active' }
      });

      await tx.connectionUser.updateMany({
        where: { customerId: customer.id, isDeleted: false },
        data: { isActive: true }
      });

      // D. Create Customer Order Management Record
      const newOrder = await tx.customerOrderManagement.create({
        data: {
          customer: { connect: { id: customer.id } },
          subscription: { connect: { id: updatedSubscription.id } },
          packagePrice: { connect: { id: pkg.id } },
          packageStart: renewalBase,
          packageEnd: updatedSubscription.planEnd,
          totalAmount: finalAmount,
          orderDate: new Date(),
          isActive: true,
          isDeleted: false,
          isPaid: true,
          paymentId: `EXTERNAL_${paymentMode}`,
          paymentMethodId: billingMethod?.id || null,
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

      const referenceCode = generateExternalReferenceCode(newOrder.id);

      // Link order and reference code to External Payment
      const completedPayment = await tx.externalPayment.update({
        where: { id: paymentRecord.id },
        data: {
          orderId: String(newOrder.id),
          referenceCode: referenceCode
        }
      });

      // E. Audit Log
      await logAudit(tx, null, 'CUSTOMER_PACKAGE_RENEW', {
        id: customer.id,
        packageId: pkg.id,
        packageName: pkg.packageName,
        totalAmount: finalAmount,
        paymentMethod: `External Payment (${paymentMode})`,
        transactionCode
      }, req);

      return { order: newOrder, payment: completedPayment, subscription: updatedSubscription };
    });

    const { order: createdOrder, payment: completedPayment, subscription: updatedSub } = result;

    // 7. RADIUS Provisioning & Session Disconnection
    const radiusProvisioned = [];
    try {
      const connUsers = await prisma.connectionUser.findMany({
        where: { customerId: customer.id, isDeleted: false },
        select: { username: true }
      });
      const usernames = connUsers.map(u => u.username).filter(Boolean);

      if (usernames.length > 0) {
        try {
          const radius = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
          if (radius) {
            const packageEndDate = createdOrder.packageEnd ? new Date(createdOrder.packageEnd) : expiryDateObj;
            for (const username of usernames) {
              try {
                await radius.updateExpiration(username, packageEndDate);
                radiusProvisioned.push({ username, action: "updated", value: packageEndDate });

                if (typeof radius.disconnectUserSession === 'function') {
                  await radius.disconnectUserSession(username);
                } else if (typeof radius.disconnectAllSessions === 'function') {
                  await radius.disconnectAllSessions(username).catch(err => {
                    console.warn(`[RADIUS] Disconnect failed for ${username}:`, err.message);
                  });
                }
              } catch (rErr) {
                radiusProvisioned.push({ username, action: "error", error: rErr.message });
              }
            }
          }
        } catch (rErr) {
          console.warn('[External Payment] Radius service unavailable or disabled:', rErr.message);
        }
      }
    } catch (rAllErr) {
      console.warn('[External Payment] Radius provisioning overall failed:', rAllErr.message);
    }

    // 8. Accounting Sync (Tshul / Nepurix)
    await syncExternalPaymentAccounting(prisma, req.ispId, createdOrder.id);

    // 9. Success Response
    return res.status(200).json({
      response_code: 0,
      response_message: "Payment and recharge successful",
      data: {
        transaction_code: transactionCode,
        reference_code: completedPayment.referenceCode,
        order_id: createdOrder.id,
        customer_id: customer.customerUniqueId || String(customer.id),
        customer_name: fullName,
        username: primaryConnectionUsername,
        payment_mode: paymentMode,
        amount: finalAmount,
        package_name: pkg.packageName,
        package_duration: durationStr,
        new_expiry_date: updatedSub.planEnd ? new Date(updatedSub.planEnd).toISOString() : null,
        radius_provisioned: radiusProvisioned.length > 0
      }
    });

  } catch (err) {
    console.error("External processPayment error:", err);
    try {
      if (lookupValue) {
        let resolvedCust = null;
        try {
          resolvedCust = await prisma.customer.findFirst({
            where: {
              ispId: req.ispId || 1,
              isDeleted: false,
              OR: [
                { customerUniqueId: String(lookupValue) },
                { connectionUsers: { some: { username: String(lookupValue), isDeleted: false } } },
                { lead: { phoneNumber: String(lookupValue) } }
              ]
            },
            select: { id: true, customerUniqueId: true, branchId: true }
          });
        } catch (_) {}

        if (resolvedCust) {
          await prisma.externalPayment.create({
            data: {
              ispId: req.ispId || 1,
              customerId: resolvedCust.id,
              customerUniqueId: resolvedCust.customerUniqueId,
              username: String(lookupValue),
              requestId: String(lookupValue),
              amount: Number(inputAmount || 0),
              paymentMode: paymentMode,
              status: 'FAILED',
              transactionCode: transactionCode,
              packageDuration: String(duration || '1 month'),
              packageDetails: {
                error: err.message || 'Payment processing failed',
                code: err.code || 'UNKNOWN',
                payload: req.body
              },
              branchId: resolvedCust.branchId || null
            }
          }).catch(e => console.warn('[ExternalPayment] Failed to save failed payment log:', e.message));
        }
      }
    } catch (_) {}

    return res.status(err.statusCode || 500).json({
      response_code: err.code || 1,
      response_message: "Failed to process payment: " + (err.message || "Unknown error")
    });
  }
};

/**
 * Status Check Handler (POST /status, GET /status/:transaction_code)
 */
const checkStatus = async (req, res) => {
  const prisma = req.prisma || require('../../../backend/prisma/client');
  const transactionCode = req.params?.transaction_code || req.body?.transaction_code || req.body?.transactionCode;
  const requestId = req.body?.request_id || req.body?.username || req.body?.customerId;

  if (!transactionCode && !requestId) {
    return res.status(400).json({
      response_code: 1,
      status: "FAILED",
      response_message: "transaction_code or request_id is required"
    });
  }

  const scope = req.ispId ? { ispId: Number(req.ispId) } : {};
  let payment = null;

  if (transactionCode) {
    payment = await prisma.externalPayment.findFirst({
      where: { ...scope, transactionCode: String(transactionCode) },
      orderBy: { createdAt: 'desc' }
    });
  }

  if (!payment && requestId) {
    payment = await prisma.externalPayment.findFirst({
      where: {
        ...scope,
        OR: [
          { requestId: String(requestId) },
          { username: String(requestId) },
          { customerUniqueId: String(requestId) }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  if (!payment) {
    return res.status(404).json({
      response_code: 3,
      status: "NOT_FOUND",
      response_message: "Payment transaction not found",
      transaction_code: transactionCode || null
    });
  }

  return res.json({
    response_code: 0,
    status: payment.status,
    response_message: "success",
    data: {
      id: payment.id,
      transaction_code: payment.transactionCode,
      reference_code: payment.referenceCode,
      request_id: payment.requestId,
      username: payment.username,
      customer_id: payment.customerUniqueId,
      amount: payment.amount,
      payment_mode: payment.paymentMode,
      package_duration: payment.packageDuration,
      status: payment.status,
      paid_at: payment.paidAt || payment.createdAt
    }
  });
};

/**
 * List Transactions (GET /transactions)
 */
const listTransactions = async (req, res) => {
  const prisma = req.prisma || require('../../../backend/prisma/client');
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '25', 10)));
  const status = String(req.query.status || 'ALL').toUpperCase();
  const search = String(req.query.search || '').trim();

  const where = {
    ispId: Number(req.ispId || 1)
  };

  if (status !== 'ALL') {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { requestId: { contains: search } },
      { username: { contains: search } },
      { customerUniqueId: { contains: search } },
      { transactionCode: { contains: search } },
      { referenceCode: { contains: search } },
      { paymentMode: { contains: search } }
    ];
  }

  const [total, transactions] = await Promise.all([
    prisma.externalPayment.count({ where }),
    prisma.externalPayment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customer: {
          select: {
            id: true,
            customerUniqueId: true,
            lead: {
              select: { firstName: true, middleName: true, lastName: true, phoneNumber: true, email: true }
            }
          }
        }
      }
    })
  ]);

  const formattedTransactions = transactions.map(t => {
    const custName = [t.customer?.lead?.firstName, t.customer?.lead?.middleName, t.customer?.lead?.lastName].filter(Boolean).join(' ') || 'Customer';
    return {
      id: t.id,
      requestId: t.requestId,
      username: t.username,
      customerUniqueId: t.customerUniqueId,
      customerName: custName,
      customerPhone: t.customer?.lead?.phoneNumber || null,
      customerEmail: t.customer?.lead?.email || null,
      amount: t.amount,
      paymentMode: t.paymentMode,
      status: t.status,
      transactionCode: t.transactionCode,
      referenceCode: t.referenceCode,
      packageDuration: t.packageDuration,
      packageDetails: t.packageDetails,
      orderId: t.orderId || null,
      createdAt: t.createdAt,
      paidAt: t.paidAt
    };
  });

  return res.json({
    transactions: formattedTransactions,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  });
};

/**
 * Get Available Payment Modes
 */
const getPaymentModes = async (req, res) => {
  const prisma = req.prisma || require('../../../backend/prisma/client');
  const methods = await prisma.billingPaymentMethod.findMany({
    where: { ispId: Number(req.ispId || 1), isEnabled: true },
    select: { id: true, name: true, code: true, isDefault: true, description: true }
  });
  return res.json({ payment_modes: methods });
};

module.exports = {
  paymentInquiry,
  processPayment,
  checkStatus,
  listTransactions,
  getPaymentModes,
  getCustomerContext,
  buildPackageOrderItems
};
