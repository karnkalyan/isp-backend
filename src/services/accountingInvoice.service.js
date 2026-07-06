const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

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
  if (isTscApplicable) return 'TSC';
  return 'Non Taxable';
}

async function loadOrder(prisma, ispId, orderId) {
  return prisma.customerOrderManagement.findFirst({
    where: { id: Number(orderId), isDeleted: false, customer: { ispId: Number(ispId) } },
    include: {
      items: true,
      customer: { include: { lead: true } },
      packagePrice: {
        include: {
          packagePlanDetails: true,
          oneTimeCharges: { where: { isDeleted: false } }
        }
      }
    }
  });
}

async function buildNepurixPayload(prisma, ispId, order) {
  const tscSetting = await prisma.iSPSettings.findFirst({ where: { ispId: Number(ispId), key: 'tscPercentage' } });
  const tscRate = number(tscSetting?.value || 10) / 100;
  const charges = order.packagePrice?.oneTimeCharges || [];
  const chargeByReference = new Map(charges.filter(item => item.referenceId).map(item => [item.referenceId, item]));
  const packageReference = order.packagePrice?.referenceId;

  let taxableAmount = 0;
  let calculatedNet = 0;
  const detail = order.items.map(item => {
    const charge = item.referenceId ? chargeByReference.get(item.referenceId) : null;
    const isPackage = Boolean(packageReference && item.referenceId === packageReference);
    const isTaxable = charge ? charge.isTaxable !== false : true;
    const isTscApplicable = charge ? charge.isTscApplicable === true : (isPackage && order.packagePrice?.isTscApplicable === true);
    const basicAmount = round(item.itemPrice);
    const tsc = isTscApplicable ? round(basicAmount * tscRate) : 0;
    const vatBase = isTaxable ? basicAmount + tsc : 0;
    const vat = isTaxable ? round(vatBase * 0.13) : 0;
    taxableAmount += vatBase;
    calculatedNet += basicAmount + tsc + vat;
    return {
      item: item.itemName,
      quantity: 1,
      rate: basicAmount,
      basicAmount,
      discountAmount: null,
      amount: basicAmount,
      tax: taxName(isTaxable, isTscApplicable)
    };
  });

  const lead = order.customer?.lead || {};
  const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || order.customer?.customerUniqueId;
  const packageName = order.packagePrice?.packagePlanDetails?.planName || order.packagePrice?.packageName || null;
  return {
    invoiceType: 'Cash',
    paymentMode: paymentMode(order.paymentId),
    customer: customerName,
    date: dateOnly(order.orderDate),
    remarks: `ISP invoice ${order.invoiceId || order.id}`,
    subTotal: round(order.items.reduce((sum, item) => sum + number(item.itemPrice), 0)),
    taxableAmount: round(taxableAmount),
    discount: null,
    netAmount: round(order.totalAmount || calculatedNet),
    package: packageName,
    packageAmount: round(order.totalAmount || calculatedNet),
    activationDate: dateOnly(order.packageStart),
    deactivationDate: dateOnly(order.packageEnd),
    detail,
    finTagDetail: []
  };
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
  try {
    const payload = service.code === SERVICE_CODES.NEPURIX
      ? await buildNepurixPayload(prisma, ispId, order)
      : buildTshulPayload(order);
    const result = await service.client.sales.create(payload);
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
