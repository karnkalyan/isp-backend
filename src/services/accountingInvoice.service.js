const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const { convertToNepaliDate } = require('../utils/dateHelper');

const number = value => Number(value || 0);
const round = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const dateOnly = value => new Date(value || Date.now()).toISOString().slice(0, 10);
const paymentMode = value => {
  const normalized = String(value || '').toUpperCase();
  if (normalized.includes('ESEWA')) return 'eSewa';
  if (normalized.includes('EPAY')) return 'ePay';
  if (normalized.includes('KHALTI')) return 'Khalti';
  return normalized === 'CREDIT' ? 'Credit' : 'Cash';
};

async function getEnabledAccountingClient(prisma, ispId) {
  const enabled = await prisma.iSPService.findFirst({
    where: {
      ispId: Number(ispId),
      isActive: true,
      isEnabled: true,
      isDeleted: false,
      service: { code: { in: [SERVICE_CODES.TSHUL, SERVICE_CODES.NEPURIX] } }
    }
  });
  if (!enabled) return null;
  const [service] = await ServiceFactory.getActiveBillingClients(Number(ispId), prisma);
  return service || null;
}

function taxName(isTaxable, isTscApplicable) {
  if (isTaxable && isTscApplicable) return 'TSC + VAT';
  if (isTaxable) return 'VAT';
  return null;
}

async function loadOrder(prisma, ispId, orderId) {
  const order = await prisma.customerOrderManagement.findFirst({
    where: { id: Number(orderId), isDeleted: false, customer: { ispId: Number(ispId) } },
    include: {
      items: true,
      customer: {
        include: {
          lead: true,
          connectionUsers: { where: { isDeleted: false } },
          branch: true,
          subBranch: true
        }
      },
      packagePrice: {
        include: {
          packagePlanDetails: true,
          oneTimeCharges: { where: { isDeleted: false } }
        }
      }
    }
  });
  if (!order?.package) return order;

  // Package item links are stored in the explicit legacy join table. Load
  // those definitions so each historical order line keeps its VAT/TSC rule.
  const links = await prisma.packageonetimecharges.findMany({ where: { A: order.package } });
  if (links.length) {
    const charges = await prisma.OneTimeCharge.findMany({
      where: { id: { in: links.map(link => link.B) }, isDeleted: false },
      orderBy: { id: 'asc' }
    });
    order.packagePrice = { ...order.packagePrice, oneTimeCharges: charges };
  }
  return order;
}

async function buildNepurixPayload(prisma, ispId, order) {
  const tscSetting = await prisma.iSPSettings.findFirst({ where: { ispId: Number(ispId), key: 'tscPercentage' } });
  const tscRate = number(tscSetting?.value || 10) / 100;

  const isTrial = Number(order.totalAmount || 0) === 0;

  let itemsToUse = [];
  if (isTrial) {
    itemsToUse = [{
      itemName: order.packagePrice?.packagePlanDetails?.planName || order.packagePrice?.packageName || 'Trial Package',
      itemPrice: 0,
      isTaxable: false,
      isTscApplicable: false
    }];
  } else if (order.packagePrice?.oneTimeCharges && order.packagePrice.oneTimeCharges.length > 0) {
    const customPrices = order.packagePrice.addonPricesJson ? JSON.parse(order.packagePrice.addonPricesJson) : {};
    itemsToUse = order.packagePrice.oneTimeCharges.map(charge => ({
      itemName: charge.name || 'Package Item',
      itemPrice: customPrices[String(charge.id)] !== undefined ? customPrices[String(charge.id)] : Number(charge.amount || 0),
      isTaxable: charge.isTaxable !== false,
      isTscApplicable: charge.isTscApplicable === true
    }));
  } else {
    itemsToUse = order.items.map(item => ({
      itemName: item.itemName,
      itemPrice: Number(item.itemPrice || 0),
      isTaxable: true,
      isTscApplicable: order.packagePrice?.isTscApplicable === true
    }));
  }

  let taxableAmount = 0;
  let calculatedNet = 0;
  let subTotal = 0;

  const detail = itemsToUse.map(item => {
    const isTaxable = item.isTaxable !== false;
    const isTscApplicable = item.isTscApplicable === true;
    const basicAmount = round(item.itemPrice);
    
    const tsc = isTscApplicable ? round(basicAmount * tscRate) : 0;
    const vatBase = isTaxable ? basicAmount + tsc : 0;
    const vat = isTaxable ? round(vatBase * 0.13) : 0;
    
    taxableAmount += vatBase;
    calculatedNet += basicAmount + tsc + vat;
    subTotal += basicAmount;

    return {
      item: item.itemName,
      quantity: 1,
      rate: basicAmount,
      basicAmount,
      discountAmount: null,
      amount: basicAmount,
      tax: taxName(isTaxable, isTscApplicable)
    };
  }).filter(d => d.rate > 0);

  const lead = order.customer?.lead || {};
  const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || order.customer?.customerUniqueId;
  const packageName = order.packagePrice?.packagePlanDetails?.planName || order.packagePrice?.packageName || null;
  const radiusUsername = order.customer?.connectionUsers?.[0]?.username || null;

  const finTagDetail = [];
  if (order.customer?.branch?.name) {
    finTagDetail.push({
      category: "Organization",
      finTag: order.customer.branch.name
    });
  }
  if (order.customer?.subBranch?.name) {
    finTagDetail.push({
      category: "Branch",
      finTag: order.customer.subBranch.name
    });
  }

  const payload = {
    invoiceType: 'Cash',
    paymentMode: paymentMode(order.paymentId),
    customer: customerName,
    UserName: radiusUsername,
    date: convertToNepaliDate(order.orderDate),
    remarks: `ISP invoice ${order.invoiceId || order.id}`,
    subTotal: round(subTotal),
    taxableAmount: round(taxableAmount),
    discount: null,
    netAmount: round(order.totalAmount || calculatedNet),
    package: packageName,
    packageAmount: round(order.totalAmount || calculatedNet),
    activationDate: convertToNepaliDate(order.packageStart),
    deActivationDate: convertToNepaliDate(order.packageEnd),
    detail,
    finTagDetail
  };

  console.log('[NEPURIX PAYLOAD DEBUG]:', JSON.stringify(payload, null, 2));

  return payload;
}

function buildTshulPayload(order) {
  const lead = order.customer?.lead || {};
  const customerReferenceId = order.customer?.customerUniqueId || `CUST-${order.customerId}`;
  return {
    InvoiceType: 'Cash',
    PaymentMode: paymentMode(order.paymentId),
    Date: dateOnly(order.orderDate),
    SubTotal: round(order.items.reduce((sum, item) => sum + number(item.itemPrice), 0)),
    TaxableAmount: round(order.totalAmount),
    NetAmount: round(order.totalAmount),
    CustomerReferenceId: customerReferenceId,
    OtherCustomerName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
    OtherCustomerMobile: lead.phoneNumber || '',
    Detail: order.items.map(item => ({
      ItemReferenceId: item.referenceId,
      Quantity: 1,
      Rate: round(item.itemPrice),
      BasicAmount: round(item.itemPrice),
      Amount: round(item.itemPrice),
      DiscountAmount: 0
    }))
  };
}

async function syncOrderToAccounting(prisma, ispId, orderId) {
  const order = await loadOrder(prisma, ispId, orderId);
  if (!order || !order.isPaid || !order.items.length) return null;
  if (order.accountingInvoiceId) return { provider: order.accountingProvider, id: order.accountingInvoiceId, url: order.accountingInvoiceUrl };

  const service = await getEnabledAccountingClient(prisma, ispId);
  if (!service) return null;

  if (service.code === SERVICE_CODES.NEPURIX) {
    try {
      const invoices = await service.client.sales.list();
      const remarkToMatch = `ISP invoice ${order.invoiceId || order.id}`.toLowerCase().trim();
      const existing = Array.isArray(invoices)
        ? invoices.find(inv => (inv.Remarks || inv.remarks || '').toLowerCase().trim() === remarkToMatch)
        : null;
      if (existing) {
        const id = existing.Id ?? existing.id ?? existing.ReferenceId ?? existing.referenceId;
        const url = existing.InvoicePrintUrl ?? existing.invoicePrintUrl ?? existing.PrintUrl ?? null;
        if (id) {
          console.log('[NEPURIX] Found existing invoice for order, reusing:', id);
          await prisma.customerOrderManagement.update({
            where: { id: order.id },
            data: { accountingProvider: service.code, accountingInvoiceId: String(id), accountingInvoiceUrl: url, accountingSyncError: null }
          });
          return { provider: service.code, id: String(id), url };
        }
      }
    } catch (err) {
      console.error('[NEPURIX] Failed to check existing invoices list:', err.message);
    }
  }

  try {
    const payload = service.code === SERVICE_CODES.NEPURIX
      ? await buildNepurixPayload(prisma, ispId, order)
      : buildTshulPayload(order);
    const result = await service.client.sales.create(payload);
    if (result && result.Error) {
      throw new Error(`Nepurix API Error: ${result.Error}`);
    }
    const data = result?.Data || result?.data || result || {};
    const id = data.Id ?? data.id ?? data.ReferenceId ?? data.referenceId;
    const url = data.InvoicePrintUrl ?? data.invoicePrintUrl ?? data.PrintUrl ?? null;
    if (!id) throw new Error(result?.Message || 'Accounting service did not return a sales invoice ID');
    await prisma.customerOrderManagement.update({
      where: { id: order.id },
      data: { accountingProvider: service.code, accountingInvoiceId: String(id), accountingInvoiceUrl: url, accountingSyncError: null }
    });
    return { provider: service.code, id: String(id), url, data };
  } catch (error) {
    await prisma.customerOrderManagement.update({
      where: { id: order.id },
      data: { accountingProvider: service.code, accountingSyncError: String(error.message || error).slice(0, 2000) }
    }).catch(() => {});
    throw error;
  }
}

async function fetchAccountingInvoices(prisma, ispId, orders) {
  const eligible = orders.filter(order => order.accountingInvoiceId);
  if (!eligible.length) return new Map();
  const service = await getEnabledAccountingClient(prisma, ispId);
  if (!service) return new Map();
  const pairs = await Promise.all(eligible.map(async order => {
    if (order.accountingProvider && order.accountingProvider !== service.code) return [order.id, null];
    try {
      const invoice = await service.client.sales.get(order.accountingInvoiceId);
      return [order.id, invoice?.Data || invoice?.data || invoice];
    } catch (error) {
      return [order.id, { id: order.accountingInvoiceId, invoicePrintUrl: order.accountingInvoiceUrl, fetchError: error.message }];
    }
  }));
  return new Map(pairs);
}

module.exports = { taxName, buildNepurixPayload, syncOrderToAccounting, fetchAccountingInvoices };
