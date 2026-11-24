const axios = require('axios');
const { getDeductibleRenewalBase, computeExpiryFromBase } = require('../services/subscription.service');
const { syncOrderToAccounting } = require('../services/accountingInvoice.service');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

async function getKhaltiConfig(prisma, ispId) {
  let secretKey = process.env.KHALTI_SECRET_KEY || '';
  let env = process.env.KHALTI_ENV || 'production';
  let websiteUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000';

  try {
    const service = await prisma.iSPService.findFirst({
      where: {
        ispId: Number(ispId),
        isDeleted: false,
        isEnabled: true,
        service: { code: 'KHALTI' }
      },
      include: { credentials: true }
    });
    if (service?.credentials?.length) {
      for (const cred of service.credentials) {
        const k = String(cred.key || '').toLowerCase();
        if (k.includes('secret') && cred.value) secretKey = cred.value;
        if ((k === 'env' || k === 'environment' || k === 'mode') && cred.value) env = cred.value;
        if (k.includes('website') && cred.value) websiteUrl = cred.value;
      }
    }
  } catch {}

  const isSandbox = ['sandbox', 'test', 'dev', 'uat'].includes(String(env).toLowerCase());
  const baseUrl = isSandbox ? 'https://dev.khalti.com/api/v2' : 'https://khalti.com/api/v2';
  return { secretKey, baseUrl, websiteUrl, isSandbox };
}

async function resolveCustomerPackageForKhalti(prisma, req, customerId, packageId) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: Number(customerId || req.user?.customerId),
      ispId: Number(req.ispId),
      isDeleted: false
    },
    include: {
      lead: true,
      portalUser: { select: { email: true } },
      customerSubscriptions: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 1
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
          packagePlanDetails: {
            select: { id: true, planName: true, upgradePlanIds: true }
          },
          oneTimeCharges: {
            where: { isDeleted: false },
            select: { id: true, name: true, amount: true, referenceId: true, isRenewal: true }
          }
        }
      }
    }
  });

  if (!customer) throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
  let pkg = customer.subscribedPkg;
  if (!pkg) throw Object.assign(new Error('Customer has no subscribed package'), { statusCode: 404 });

  const originalPkg = pkg;
  const rawUpgradePlanIds = originalPkg.packagePlanDetails?.upgradePlanIds;
  const upgradePlanIds = Array.isArray(rawUpgradePlanIds)
    ? rawUpgradePlanIds.map(Number).filter(id => Number.isInteger(id) && id > 0 && id !== originalPkg.planId)
    : [];

  if (packageId && Number(packageId) !== pkg.id) {
    const selected = await prisma.packagePrice.findFirst({
      where: {
        id: Number(packageId),
        planId: { in: Array.from(new Set([originalPkg.planId, ...upgradePlanIds].filter(Boolean))) },
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
    if (!selected) throw Object.assign(new Error('Selected package is invalid'), { statusCode: 400 });
    pkg = selected;
  } else if (customer.isRechargeable && upgradePlanIds.length > 0) {
    const upgraded = await prisma.packagePrice.findMany({
      where: { planId: { in: upgradePlanIds }, isDeleted: false, isActive: true },
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
    if (upgraded.length > 0) {
      const durNorm = String(originalPkg.packageDuration || '').trim().toLowerCase();
      pkg = upgraded.find(c => String(c.packageDuration || '').trim().toLowerCase() === durNorm) || upgraded[0];
    }
  }

  const isRechargeable = Boolean(customer.isRechargeable);
  const newPkgAmt = pkg.initialTotalWithTax ?? pkg.price ?? 0;
  const renewAmt = pkg.renewAmountWithTax ?? pkg.price ?? 0;
  const totalAmount = customer.isFree ? 0 : Number(isRechargeable ? renewAmt : newPkgAmt);

  return { customer, pkg, totalAmount, isRechargeable };
}

async function initiateKhaltiPayment(req, res, next) {
  try {
    const { customerId, packageId, returnUrl, websiteUrl } = req.body || {};
    const { secretKey, baseUrl, websiteUrl: defaultWebsite } = await getKhaltiConfig(req.prisma, req.ispId);
    if (!secretKey) {
      return res.status(400).json({ error: 'Khalti Secret Key is not configured for this ISP' });
    }

    const { customer, pkg, totalAmount } = await resolveCustomerPackageForKhalti(req.prisma, req, customerId, packageId);
    if (totalAmount < 10) {
      return res.status(400).json({ error: 'Minimum Khalti payment amount is NPR 10' });
    }

    const purchaseOrderId = `KHL-${customer.id}-${pkg.id}-${Date.now()}`;
    const customerName = [customer.lead?.firstName, customer.lead?.lastName].filter(Boolean).join(' ') || customer.customerUniqueId || `Customer-${customer.id}`;
    const resolvedWebsite = websiteUrl || defaultWebsite;
    const resolvedReturnUrl = returnUrl || `${resolvedWebsite.replace(/\/+$/, '')}/payment/khalti/callback`;

    const payload = {
      return_url: resolvedReturnUrl,
      website_url: resolvedWebsite,
      amount: Math.round(totalAmount * 100),
      purchase_order_id: purchaseOrderId,
      purchase_order_name: pkg.packageName || 'Internet Renewal',
      customer_info: {
        name: customerName,
        email: customer.lead?.email || customer.portalUser?.email || 'customer@isp.local',
        phone: customer.lead?.phoneNumber || '9800000000'
      },
      merchant_customer_id: String(customer.id),
      merchant_package_id: String(pkg.id)
    };

    const response = await axios.post(`${baseUrl}/epayment/initiate/`, payload, {
      headers: {
        Authorization: `Key ${secretKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    return res.json({
      success: true,
      pidx: response.data?.pidx,
      payment_url: response.data?.payment_url,
      expires_at: response.data?.expires_at,
      expires_in: response.data?.expires_in,
      amount: totalAmount,
      purchase_order_id: purchaseOrderId,
      package_id: pkg.id
    });
  } catch (err) {
    console.error('[KHALTI INITIATE ERROR]:', err.response?.data || err.message);
    return res.status(err.statusCode || err.response?.status || 500).json({
      error: err.response?.data?.detail || err.message || 'Failed to initiate Khalti payment'
    });
  }
}

async function completeKhaltiPayment(req, res, next) {
  try {
    const { pidx, customerId, packageId } = req.body || req.query || {};
    if (!pidx) return res.status(400).json({ error: 'pidx is required' });

    const { secretKey, baseUrl } = await getKhaltiConfig(req.prisma, req.ispId);
    if (!secretKey) {
      return res.status(400).json({ error: 'Khalti Secret Key is not configured for this ISP' });
    }

    const lookupRes = await axios.post(
      `${baseUrl}/epayment/lookup/`,
      { pidx },
      {
        headers: {
          Authorization: `Key ${secretKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const lookup = lookupRes.data || {};
    if (lookup.status !== 'Completed') {
      return res.status(400).json({
        success: false,
        status: lookup.status,
        error: `Khalti payment is not completed (status: ${lookup.status || 'Unknown'})`
      });
    }

    const { customer, pkg, totalAmount } = await resolveCustomerPackageForKhalti(req.prisma, req, customerId, packageId);
    const paidNpr = Number(lookup.total_amount || 0) / 100;
    if (Math.abs(paidNpr - totalAmount) > 1) {
      return res.status(400).json({ error: `Payment amount mismatch. Expected NPR ${totalAmount}, got NPR ${paidNpr}` });
    }

    const existingOrder = await req.prisma.customerOrderManagement.findFirst({
      where: { paymentId: `KHALTI-${pidx}`, customerId: customer.id }
    });
    if (existingOrder) {
      return res.json({ success: true, alreadyProcessed: true, orderId: existingOrder.id, transactionId: lookup.transaction_id });
    }

    const subscription = customer.customerSubscriptions?.[0];
    if (!subscription) {
      return res.status(404).json({ error: 'Active subscription not found' });
    }

    const planStart = getDeductibleRenewalBase(subscription, new Date());
    const planEnd = computeExpiryFromBase(planStart, String(pkg.packageDuration || '1 month'));
    planEnd.setHours(0, 0, 0, 0);

    const khaltiMethod = await req.prisma.billingPaymentMethod.findFirst({
      where: { ispId: Number(req.ispId), code: 'KHALTI', isEnabled: true }
    });

    const createdOrder = await req.prisma.$transaction(async (tx) => {
      const updatedSubData = {
        planEnd,
        isTrial: false,
        isInvoicing: true,
        extensionCount: 0,
        graceDaysBalance: 0,
        compensationDays: 0,
        adminExtensionDays: 0
      };
      if (subscription.isTrial) updatedSubData.planStart = planStart;
      if (pkg.id !== subscription.package) updatedSubData.package = pkg.id;

      const updatedSub = await tx.customerSubscription.update({
        where: { id: subscription.id },
        data: updatedSubData
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          isRechargeable: true,
          status: 'active',
          onboardStatus: 'fully_onboarded',
          ...(pkg.id !== customer.subscribedPkgId ? { subscribedPkgId: pkg.id, assignedPkg: pkg.id } : {})
        }
      });

      await tx.customerServiceConnection.updateMany({ where: { customerId: customer.id }, data: { status: 'active' } });
      await tx.connectionUser.updateMany({ where: { customerId: customer.id, isDeleted: false }, data: { isActive: true } });

      return tx.customerOrderManagement.create({
        data: {
          customerId: customer.id,
          subscriptionId: updatedSub.id,
          package: pkg.id,
          orderDate: new Date(),
          packageStart: planStart,
          packageEnd: planEnd,
          totalAmount: paidNpr,
          isPaid: true,
          isActive: true,
          paymentId: `KHALTI-${pidx}`,
          paymentMethodId: khaltiMethod?.id || null,
          updatedAt: new Date(),
          items: {
            create: [{
              itemName: pkg.packageName || 'Internet Renewal',
              referenceId: pkg.referenceId || null,
              itemPrice: paidNpr
            }]
          }
        }
      });
    });

    try {
      await syncOrderToAccounting(req.prisma, req.ispId, createdOrder.id);
    } catch (accErr) {
      console.warn('[KHALTI ACCOUNTING SYNC WARNING]:', accErr.message);
    }

    try {
      const radiusClient = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
      const pppUsers = await req.prisma.connectionUser.findMany({
        where: { customerId: customer.id, isDeleted: false, isActive: true },
        select: { username: true }
      });
      if (radiusClient && pppUsers.length > 0) {
        const expDateStr = new Date(planEnd).toISOString().split('T')[0];
        for (const u of pppUsers) {
          await radiusClient.setExpiration(u.username, expDateStr).catch(() => {});
        }
      }
    } catch {}

    return res.json({
      success: true,
      orderId: createdOrder.id,
      transactionId: lookup.transaction_id,
      pidx,
      amount: paidNpr,
      planEnd
    });
  } catch (err) {
    console.error('[KHALTI COMPLETE ERROR]:', err.response?.data || err.message);
    return res.status(err.statusCode || err.response?.status || 500).json({
      error: err.response?.data?.detail || err.message || 'Failed to verify Khalti payment'
    });
  }
}

module.exports = {
  initiateKhaltiPayment,
  completeKhaltiPayment
};
