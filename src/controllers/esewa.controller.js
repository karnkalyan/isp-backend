const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const crypto = require('crypto');
const axios = require('axios');

function getRenewalBase(subscription, now = new Date()) {
  const planEnd = subscription?.planEnd ? new Date(subscription.planEnd) : now;
  const graceDays = Math.max(0, Number(subscription?.graceDaysBalance || 0));
  const adminDays = Math.max(0, Number(subscription?.adminExtensionDays || 0));
  const deductibleDays = graceDays + adminDays;
  const expiryBeforeExtension = new Date(planEnd);
  expiryBeforeExtension.setDate(expiryBeforeExtension.getDate() - deductibleDays);
  if (deductibleDays > 0) return expiryBeforeExtension;
  return planEnd >= now ? planEnd : now;
}

async function getRenewalWindow(prisma, ispId, subscription) {
  const now = new Date();
  if (!subscription?.isTrial) return { planStart: getRenewalBase(subscription, now), trialDeductionDays: 0 };
  const setting = await prisma.iSPSettings.findFirst({ where: { ispId: Number(ispId), key: 'trialDeductionOnSubscriptionActivation' } });
  const trialMs = Math.max(0, new Date(subscription.planEnd) - new Date(subscription.planStart));
  return { planStart: now, trialDeductionDays: setting?.value === 'true' ? Math.ceil(trialMs / 86400000) : 0 };
}

/**
 * Compute expiry date from a base date + duration string.
 */
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

/**
 * Format date for RADIUS Expiration attribute
 */
function formatRadiusExpiration(date) {
  const expirationDate = date instanceof Date ? date : new Date(date);
  const pad = value => String(value).padStart(2, '0');
  const day = pad(expirationDate.getDate());
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[expirationDate.getMonth()];
  const year = expirationDate.getFullYear();
  return `${day} ${month} ${year} ${pad(expirationDate.getHours())}:${pad(expirationDate.getMinutes())}:${pad(expirationDate.getSeconds())}`;
}



// const inquiry = async (req, res, next) => {
//   try {
//     const requestId =
//       req.params.request_id ??
//       req.body.customerId ??
//       req.body.request_id;

//     const { createOrder } = req.body;

//     if (!requestId) {
//       return res.status(400).json({
//         request_id: null,
//         response_code: "01",
//         response_message: "BAD_REQUEST",
//         error: "request_id (customer id / phone / unique id) required"
//       });
//     }

//     // Build OR conditions
//     const orConditions = [];
//     const parsedId = Number(requestId);

//     if (!Number.isNaN(parsedId)) {
//       orConditions.push({ id: parsedId });
//     }

//     orConditions.push({ customerUniqueId: String(requestId) });
//     orConditions.push({ phoneNumber: String(requestId) });

//     const customer = await req.prisma.customer.findFirst({
//       where: {
//         ispId: req.ispId,
//         isDeleted: false,
//         OR: orConditions
//       },
//       include: {
//         subscribedPkg: {
//           select: {
//             id: true,
//             packageName: true,
//             price: true,
//             packageDuration: true,
//             referenceId: true,
//             oneTimeCharges: {
//               where: { isDeleted: false },
//               select: { id: true, name: true, amount: true, referenceId: true }
//             }
//           }
//         }
//       }
//     });

//     if (!customer) {
//       return res.status(404).json({
//         request_id: String(requestId),
//         response_code: "02",
//         response_message: "CUSTOMER_NOT_FOUND",
//         error: "Customer not found"
//       });
//     }

//     const pkg = customer.subscribedPkg;
//     if (!pkg) {
//       return res.status(404).json({
//         request_id: String(requestId),
//         response_code: "03",
//         response_message: "NO_SUBSCRIBED_PACKAGE",
//         error: "Customer has no subscribed package"
//       });
//     }

//     const isRechargeable = Boolean(customer.rechargeable);
//     const packagePrice = Number(pkg.price || 0);

//     const otcItems = isRechargeable
//       ? []
//       : (pkg.oneTimeCharges || []).map(o => ({
//           id: o.id,
//           name: o.name || "addon",
//           referenceId: o.referenceId || null,
//           amount: Number(o.amount || 0)
//         }));

//     const otcTotal = otcItems.reduce((s, it) => s + it.amount, 0);
//     const totalAmount = packagePrice + otcTotal;

//     // Compose aggregated items array (package + one-time charges)
//     const aggregatedItems = [
//       {
//         type: "package",
//         name: pkg.packageName || "Base Package",
//         amount: packagePrice,
//       },
//       ...otcItems.map(it => ({
//         type: "oneTime",
//         name: it.name,
//         amount: it.amount,
//         referenceId: it.referenceId || null
//       }))
//     ];

//     // Build customer summary fields
//     const fullName = [customer.firstName, customer.middleName, customer.lastName]
//       .filter(Boolean)
//       .join(" ");
//     const phone = customer.phoneNumber || null;
//     const email = customer.email || null;

//     // When createOrder is false or not provided
//     if (!createOrder) {
//       return res.status(200).json({
//         request_id: String(requestId),
//         response_code: "00",
//         response_message: "SUCCESS",
//         amount: totalAmount,
//         properties: {
//           customer: {
//             id: customer.id,
//             customerUniqueId: customer.customerUniqueId || null,
//             name: fullName,
//           },
//           package: {
//             name: pkg.packageName,
//             duration: pkg.packageDuration,
//           },
//           items: aggregatedItems,
//         }
//       });
//     }

//     // createOrder flow: find active subscription
//     const subscription = await req.prisma.customerSubscription.findFirst({
//       where: {
//         customerId: Number(customer.id),
//         isActive: true
//       },
//       orderBy: { createdAt: "desc" }
//     });

//     if (!subscription) {
//       return res.status(404).json({
//         request_id: String(requestId),
//         response_code: "04",
//         response_message: "NO_ACTIVE_SUBSCRIPTION",
//         error: "No active subscription found for this customer & package. Create subscription first or set subscription active."
//       });
//     }

//     const previousPlanEnd = subscription.planEnd ? new Date(subscription.planEnd) : new Date();
//     const durationStr = String(pkg.packageDuration || "1 month");
//     const expiryDateObj = computeExpiryFromBase(previousPlanEnd, durationStr);

//     const orderItemsData = [
//       {
//         itemName: pkg.packageName || "Base Package",
//         referenceId: pkg.referenceId || null,
//         itemPrice: packagePrice
//       },
//       ...otcItems.map(it => ({
//         itemName: it.name,
//         referenceId: it.referenceId,
//         itemPrice: it.amount
//       }))
//     ];

//     const createdOrder = await req.prisma.$transaction(async tx => {
//       const updatedSubData = {
//         planEnd: expiryDateObj,
//         isTrial: false,
//         isInvoicing: true
//       };

//       if (subscription.isTrial) {
//         updatedSubData.planStart = new Date();
//       }

//       const updatedSubscription = await tx.customerSubscription.update({
//         where: { id: subscription.id },
//         data: updatedSubData
//       });

//       if (!customer.rechargeable) {
//         await tx.customer.update({
//           where: { id: customer.id },
//           data: { rechargeable: true }
//         });
//       }

//       const created = await tx.customerOrderManagement.create({
//         data: {
//           customer: { connect: { id: customer.id } },
//           subscription: { connect: { id: updatedSubscription.id } },
//           packagePrice: { connect: { id: pkg.id } },
//           packageStart: previousPlanEnd,
//           packageEnd: updatedSubscription.planEnd,
//           totalAmount,
//           orderDate: new Date(),
//           isActive: true,
//           isDeleted: false,
//           isPaid: true,
//           items: {
//             create: orderItemsData.map(it => ({
//               itemName: it.itemName,
//               referenceId: it.referenceId,
//               itemPrice: it.itemPrice
//             }))
//           }
//         },
//         include: { items: true }
//       });

//       return created;
//     });

//     // Radius provisioning
//     const radiusProvisioned = [];
//     try {
//       const connUsers = await req.prisma.connectionUser.findMany({
//         where: { customerId: customer.id, isDeleted: false },
//         select: { username: true }
//       });

//       const usernames = connUsers.map(u => u.username).filter(Boolean);

//       if (usernames.length > 0) {
//         const isRadiusEnabled = await isServiceEnabled(req.ispId, SERVICES.RADIUS);
//         if (isRadiusEnabled) {
//           const radius = await RadiusClient.create(req.ispId);
//           const packageEndDate = createdOrder.packageEnd
//             ? new Date(createdOrder.packageEnd)
//             : expiryDateObj;

//           const radiusExpiryStr = formatRadiusExpiration(packageEndDate);

//           let radReplies = [];
//           try {
//             radReplies = await radius.radreply.list();
//           } catch (e) {
//             console.warn("[RADIUS] Failed to list radreply:", e.message || e);
//           }

//           for (const username of usernames) {
//             try {
//               const existing = radReplies.find(
//                 r =>
//                   r.username === username &&
//                   String(r.attribute).toLowerCase() === "expiration"
//               );

//               if (existing && existing.id) {
//                 await radius.radreply.update(existing.id, { value: radiusExpiryStr });
//                 radiusProvisioned.push({
//                   username,
//                   action: "updated",
//                   value: radiusExpiryStr,
//                   id: existing.id
//                 });
//               } else {
//                 await radius.radreply.create({
//                   username,
//                   attribute: "Expiration",
//                   op: ":=",
//                   value: radiusExpiryStr
//                 });
//                 radiusProvisioned.push({
//                   username,
//                   action: "created",
//                   value: radiusExpiryStr
//                 });
//               }
//             } catch (rErr) {
//               radiusProvisioned.push({
//                 username,
//                 action: "error",
//                 error: rErr.message || String(rErr)
//               });
//             }
//           }
//         }
//       }
//     } catch (rAllErr) {
//       console.warn("Radius provisioning overall failed:", rAllErr.message || rAllErr);
//     }

//     // TSHUL SALES INVOICE CREATION
//     let tshulInvoice = null;
//     try {
//       const TSHUL_SERVICE_ID = 1;
//       const isTshulEnabled = await isServiceEnabled(req.ispId, TSHUL_SERVICE_ID);

//       if (isTshulEnabled) {
//         const tshul = await TshulClient.create(req.ispId);

//         const customerReferenceId = customer.customerUniqueId || `CUST-${customer.id}`;
//         let tshulCustomer = null;

//         try {
//           tshulCustomer = await tshul.customer.get(customerReferenceId);
//         } catch (customerErr) {
//           const customerPayload = {
//             Name: `${customer.firstName} ${customer.lastName}`,
//             ReferenceId: customerReferenceId,
//             PanNo: customer.idNumber || customer.id.toString().padStart(9, '0'),
//             Address: `${customer.streetAddress}, ${customer.city}, ${customer.state}, ${customer.zipCode}`,
//             City: customer.city,
//             Province: customer.state,
//             PostalCode: customer.zipCode,
//             Country: 'Nepal',
//             Phone: customer.phoneNumber,
//             Email: customer.email,
//             Website: '',
//             ContactPerson: `${customer.firstName} ${customer.lastName}`,
//             ContactPersonPhone: customer.phoneNumber,
//             Bank: '',
//             AcNo: '',
//             AcName: '',
//             CustomerId: customer.idNumber || customer.id.toString(),
//             Notes: `Customer created via ISP system. ISP Customer ID: ${customer.id}`
//           };

//           tshulCustomer = await tshul.customer.create(customerPayload);
//         }

//         let branchReferenceId = "MAIN";
//         try {
//           const branches = await tshul.branch.list();
//           if (branches && branches.length > 0) {
//             branchReferenceId = branches[0].ReferenceId || "MAIN";
//           }
//         } catch (branchErr) {
//           console.warn('Could not fetch branches, using default:', branchReferenceId);
//         }

//         const details = [];

//         // Check and create package item
//         const packageItemRefId = pkg.referenceId || `PKG_${pkg.id}`;
//         try {
//           await tshul.item.get(packageItemRefId);
//         } catch (itemErr) {
//           const itemPayload = {
//             ReferenceId: packageItemRefId,
//             Name: pkg.packageName,
//             Unit: "PCS",
//             Rate: packagePrice,
//             Tax: 0,
//             Description: `Internet package: ${pkg.packageName} for ${pkg.packageDuration}`
//           };
//           await tshul.item.create(itemPayload);
//         }

//         details.push({
//           ItemReferenceId: packageItemRefId,
//           Quantity: 1,
//           Rate: packagePrice,
//           Amount: packagePrice,
//           BasicAmount: packagePrice,
//           DiscountPercent: 0,
//           DiscountAmount: 0
//         });

//         // Add one-time charges as items
//         for (const otcItem of otcItems) {
//           const otcRefId = otcItem.referenceId || `OTC_${otcItem.id}`;

//           try {
//             await tshul.item.get(otcRefId);
//           } catch (otcItemErr) {
//             const otcPayload = {
//               ReferenceId: otcRefId,
//               Name: otcItem.name,
//               Unit: "PCS",
//               Rate: otcItem.amount,
//               Tax: 0,
//               Description: `One-time charge: ${otcItem.name}`
//             };
//             await tshul.item.create(otcPayload);
//           }

//           details.push({
//             ItemReferenceId: otcRefId,
//             Quantity: 1,
//             Rate: otcItem.amount,
//             Amount: otcItem.amount,
//             BasicAmount: otcItem.amount,
//             DiscountPercent: 0,
//             DiscountAmount: 0
//           });
//         }

//         const salesInvoicePayload = {
//           FiscalYear: '2081/2082',
//           InvoiceType: "Cash",
//           Date: '2081-05-01',
//           PaymentMode: "Cash",
//           TaxableAmount: totalAmount,
//           Vat: 0,
//           Tsc: 0,
//           SubTotal: totalAmount,
//           NetAmount: totalAmount,
//           ExcisableAmount: 0,
//           ExciseDuty: 0,
//           DiscountRate: 0,
//           Discount: 0,
//           CustomerReferenceId: customerReferenceId,
//           OtherCustomerName: `${customer.firstName} ${customer.lastName}`,
//           OtherCustomerMobile: customer.phoneNumber,
//           BranchReferenceId: branchReferenceId,
//           Detail: details
//         };

//         tshulInvoice = await tshul.sales.create(salesInvoicePayload);

//         if (tshulInvoice && !tshulInvoice.Error) {
//           await req.prisma.customerOrderManagement.update({
//             where: { id: createdOrder.id },
//             data: {
//               tshulInvoiceId: tshulInvoice.Data?.Id || tshulInvoice.Id || null,
//               tshulReferenceId: tshulInvoice.Data?.ReferenceId || tshulInvoice.ReferenceId || null
//             }
//           });
//         }
//       }
//     } catch (tshulError) {
//       console.error("Tshul sales invoice creation error:", tshulError);
//       tshulInvoice = {
//         error: tshulError.message || "Failed to create Tshul sales invoice",
//         details: tshulError
//       };
//     }

//     return res.status(201).json({
//       request_id: String(requestId),
//       response_code: "00",
//       response_message: "SUCCESS",
//       amount: totalAmount,
//       properties: {
//         customerId: customer.id,
//         customerUniqueId: customer.customerUniqueId || null,
//         fullName,
//         phone,
//         email,
//         order: {
//           id: createdOrder.id,
//           packageStart: createdOrder.packageStart,
//           packageEnd: createdOrder.packageEnd,
//           totalAmount: createdOrder.totalAmount,
//           items: createdOrder.items,
//           tshulInvoiceId: tshulInvoice?.Data?.Id || tshulInvoice?.Id || null
//         },
//         items: aggregatedItems,
//         radiusProvisioned: radiusProvisioned,
//         tshulInvoice: tshulInvoice
//       }
//     });
//   } catch (err) {
//     console.error("subscribePackage error:", err);

//     // Handle unexpected errors with the same format
//     return res.status(500).json({
//       request_id: req.params.request_id ?? req.body.request_id ?? null,
//       response_code: "99",
//       response_message: "INTERNAL_SERVER_ERROR",
//       error: err.message || "An unexpected error occurred"
//     });
//   }
// };

const getCustomerContext = async (req, requestId) => {
  // 1. Validation
  if (!requestId) {
    const error = new Error("request_id (customer id / phone / unique id) required");
    error.code = "01"; // BAD_REQUEST
    error.statusCode = 400;
    throw error;
  }

  // 2. Build Query
  const orConditions = [];
  const parsedId = Number(requestId);
  if (!Number.isNaN(parsedId)) {
    orConditions.push({ id: parsedId });
  }
  orConditions.push({ customerUniqueId: String(requestId) });
  orConditions.push({ lead: { phoneNumber: String(requestId) } });
  orConditions.push({ lead: { secondaryContactNumber: String(requestId) } });
  orConditions.push({ lead: { email: String(requestId) } });
  orConditions.push({ portalUser: { email: String(requestId) } });
  orConditions.push({ connectionUsers: { some: { username: String(requestId), isDeleted: false } } });

  // 3. Fetch Customer
  const customer = await req.prisma.customer.findFirst({
    where: {
      ispId: req.ispId,
      isDeleted: false,
      OR: orConditions
    },
    include: {
      subscribedPkg: {
        select: {
          id: true,
          packageName: true,
          price: true,
          initialTotalWithTax: true,
          renewAmountWithTax: true,
          packageDuration: true,
          referenceId: true,
          oneTimeCharges: {
            where: { isDeleted: false },
            select: { id: true, name: true, amount: true, referenceId: true, isRenewal: true }
          }
        }
      }
    }
  });

  if (!customer) {
    const error = new Error("Customer not found");
    error.code = "02"; // CUSTOMER_NOT_FOUND
    error.statusCode = 404;
    throw error;
  }

  const pkg = customer.subscribedPkg;
  if (!pkg) {
    const error = new Error("Customer has no subscribed package");
    error.code = "03"; // NO_SUBSCRIBED_PACKAGE
    error.statusCode = 404;
    throw error;
  }

  // 4. Calculate Financials
  const isRechargeable = Boolean(customer.isRechargeable);
  const newPackageAmount = pkg.initialTotalWithTax !== null && pkg.initialTotalWithTax !== undefined
    ? Number(pkg.initialTotalWithTax)
    : Number(pkg.price || 0);
  const renewalAmount = pkg.renewAmountWithTax !== null && pkg.renewAmountWithTax !== undefined
    ? Number(pkg.renewAmountWithTax)
    : Number(pkg.price || 0);
  let packagePrice = isRechargeable ? renewalAmount : newPackageAmount;
  if (customer.isFree) {
    packagePrice = 0;
  }

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
  // The configured initial/renewal totals already include tax and applicable
  // invoice items. Never add the item breakdown a second time.
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

  const fullName = [customer.firstName, customer.middleName, customer.lastName]
    .filter(Boolean)
    .join(" ");

  return {
    customer,
    pkg,
    isRechargeable,
    packagePrice,
    otcItems,
    totalAmount,
    aggregatedItems,
    fullName
  };
};


const paymentInquiry = async (req, res, next) => {
  const requestId = req.params.request_id ?? req.body.customerId ?? req.body.request_id;

  try {
    // Use shared helper to get data
    const context = await getCustomerContext(req, requestId);
    const { customer, pkg, totalAmount, aggregatedItems, fullName } = context;

    return res.status(200).json({
      request_id: String(requestId),
      response_code: "00",
      response_message: "SUCCESS",
      amount: totalAmount,
      properties: {
        customer: {
          id: customer.id,
          customerUniqueId: customer.customerUniqueId || null,
          name: fullName,
          // phone: customer.phoneNumber || null,
          // email: customer.email || null,
        },
        package: {
          name: pkg.packageName,
          duration: pkg.packageDuration,
        },
        items: aggregatedItems,
      }
    });

  } catch (err) {
    console.error("paymentInquiry error:", err);
    const statusCode = err.statusCode || 500;
    const responseCode = err.code || "99";

    return res.status(statusCode).json({
      request_id: String(requestId || ""),
      response_code: responseCode,
      response_message: responseCode === "99" ? "INTERNAL_SERVER_ERROR" : "FAILED",
      error: err.message || "An unexpected error occurred"
    });
  }
};


const processPayment = async (req, res, next) => {
  const requestId = req.params.request_id ?? req.body.customerId ?? req.body.request_id;
  const transactionCode = req.body.transaction_code || null;

  try {
    // 1. Get Context
    const context = await getCustomerContext(req, requestId);
    const {
      customer, pkg, totalAmount, aggregatedItems,
      fullName, otcItems, packagePrice
    } = context;

    if (req.body.amount !== undefined && Number(req.body.amount) !== Number(totalAmount)) {
      return res.status(400).json({
        request_id: String(requestId),
        response_code: 1,
        response_message: "AMOUNT_MISMATCH",
        amount: totalAmount
      });
    }

    // 2. Find Active Subscription
    const subscription = await req.prisma.customerSubscription.findFirst({
      where: { customerId: Number(customer.id), isActive: true },
      orderBy: { createdAt: "desc" }
    });

    if (!subscription) {
      return res.status(404).json({
        request_id: String(requestId),
        response_code: "04",
        response_message: "NO_ACTIVE_SUBSCRIPTION",
        error: "No active subscription found."
      });
    }

    // 3. Check if payment already exists
    const existingPayment = await req.prisma.eSewaTokenPayment.findUnique({
      where: { requestId: String(requestId) }
    });

    // If payment exists and is completed, check if we should reprocess
    if (existingPayment && existingPayment.status === 'COMPLETED') {
      // Option 1: Return already processed response
      return res.status(200).json({
        request_id: String(requestId),
        response_code: "01",
        response_message: "ALREADY_PROCESSED",
        amount: existingPayment.amount,
        properties: {
          customerId: customer.id,
          orderId: existingPayment.orderId,
          payment_reference: existingPayment.referenceCode,
          note: "This payment was already processed successfully."
        }
      });

      // Option 2: If you want to allow reprocessing for same requestId, 
      // you can continue below instead of returning
    }

    // 4. Prepare Order Data
    const renewalWindow = await getRenewalWindow(req.prisma, req.ispId, subscription);
    const renewalBase = renewalWindow.planStart;
    const durationStr = String(pkg.packageDuration || "1 month");
    const expiryDateObj = computeExpiryFromBase(renewalBase, durationStr);
    if (renewalWindow.trialDeductionDays > 0) expiryDateObj.setDate(expiryDateObj.getDate() - renewalWindow.trialDeductionDays);

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

    const esewaPaymentMethod = await req.prisma.billingPaymentMethod.findFirst({
      where: {
        ispId: req.ispId,
        code: 'ESEWA',
        isEnabled: true
      }
    });

    // 5. Database Transaction - Handle everything in one transaction
    const result = await req.prisma.$transaction(async tx => {
      // A. Upsert payment record (create or update if exists)
      let paymentRecord;
      if (existingPayment) {
        // Update existing pending payment
        paymentRecord = await tx.eSewaTokenPayment.update({
          where: { id: existingPayment.id },
          data: {
            amount: totalAmount,
            eSewaTransactionCode: transactionCode,
            packageDetails: {
              packageId: pkg.id,
              packageName: pkg.packageName,
              items: aggregatedItems
            },
            updatedAt: new Date()
          }
        });
      } else {
        // Create new payment record
        paymentRecord = await tx.eSewaTokenPayment.create({
          data: {
            ispId: req.ispId,
            customerId: customer.id,
            customerUniqueId: customer.customerUniqueId || `CUST-${customer.id}`,
            requestId: String(requestId),
            amount: totalAmount,
            status: 'PENDING',
            eSewaTransactionCode: transactionCode,
            packageDetails: {
              packageId: pkg.id,
              packageName: pkg.packageName,
              items: aggregatedItems
            }
          }
        });
      }

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

      const updatedSubscription = await tx.customerSubscription.update({
        where: { id: subscription.id },
        data: updatedSubData
      });

      // C. Update Customer Status
      if (!customer.isRechargeable) {
        await tx.customer.update({
          where: { id: customer.id },
          data: { isRechargeable: true }
        });
      }

      // D. Create Order Management Record
      const newOrder = await tx.customerOrderManagement.create({
        data: {
          customer: { connect: { id: customer.id } },
          subscription: { connect: { id: updatedSubscription.id } },
          packagePrice: { connect: { id: pkg.id } },
          packageStart: renewalBase,
          packageEnd: updatedSubscription.planEnd,
          totalAmount,
          orderDate: new Date(),
          isActive: true,
          isDeleted: false,
          isPaid: true,
          paymentId: esewaPaymentMethod?.code || 'ESEWA',
          paymentMethodId: esewaPaymentMethod?.id || null,
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

      // E. Update eSewa Payment to COMPLETED & Link Order
      const updatedPayment = await tx.eSewaTokenPayment.update({
        where: { id: paymentRecord.id },
        data: {
          status: 'COMPLETED',
          paidAt: new Date(),
          orderId: String(newOrder.id),  // Convert to string here
          referenceCode: `ORD-${newOrder.id}`,
          ...(transactionCode ? { eSewaTransactionCode: transactionCode } : {})
        }
      });

      return { order: newOrder, payment: updatedPayment };
    });

    const { order: createdOrder } = result;

    // 6. Radius Provisioning
    const radiusProvisioned = [];
    try {
      const connUsers = await req.prisma.connectionUser.findMany({
        where: { customerId: customer.id, isDeleted: false },
        select: { username: true }
      });
      const usernames = connUsers.map(u => u.username).filter(Boolean);

      if (usernames.length > 0) {
        try {
          const radius = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
          if (radius) {
            const packageEndDate = createdOrder.packageEnd ? new Date(createdOrder.packageEnd) : expiryDateObj;
            const radiusExpiryStr = formatRadiusExpiration(packageEndDate);

            let radReplies = [];
            try {
              radReplies = await radius.getRadreply();
              if (!Array.isArray(radReplies)) radReplies = [];
            } catch (e) {
              console.warn("Radius list fail", e.message || e);
            }

            for (const username of usernames) {
              try {
                const existing = radReplies.find(r => r.username === username && String(r.attribute).toLowerCase() === "expiration");
                if (existing && existing.id) {
                  await radius.updateRadreply(existing.id, { value: radiusExpiryStr });
                  radiusProvisioned.push({ username, action: "updated", value: radiusExpiryStr, id: existing.id });
                } else {
                  await radius.createRadreply({ username, attribute: "Expiration", op: ":=", value: radiusExpiryStr });
                  radiusProvisioned.push({ username, action: "created", value: radiusExpiryStr });
                }
                await radius.disconnectAllSessions(username).catch((disconnectError) => {
                  console.warn(`[RADIUS] Session disconnect failed for ${username}:`, disconnectError.message);
                });
              } catch (rErr) {
                radiusProvisioned.push({ username, action: "error", error: rErr.message });
              }
            }
          }
        } catch (rErr) {
          console.warn('[WARNING] Radius service not available or enabled:', rErr.message);
        }
      }
    } catch (rAllErr) {
      console.warn("Radius provisioning overall failed:", rAllErr.message);
    }

    // 7. Accounting integration. Tshul and Nepurix are mutually exclusive:
    // initialize only the active/default provider selected by ServiceFactory.
    let tshulInvoice = null;
    let nepurixInvoice = null;
    let accountingProvider = null;
    try {
      const [billingService] = await ServiceFactory.getActiveBillingClients(req.ispId, req.prisma);
      if (billingService) {
        accountingProvider = billingService.code;
        const customerReferenceId = customer.customerUniqueId || `CUST-${customer.id}`;
        // Invoice synchronization is provider-specific and can be added here.
        // Do not initialize the other accounting provider in this payment flow.
        console.log(`[DEBUG] ${billingService.code} client obtained for customer:`, customerReferenceId);
      }
    } catch (billingErr) {
      console.warn('[WARNING] Accounting sync failed or skipped:', billingErr.message);
    }

    // 8. Success Response
    return res.status(201).json({
      request_id: String(requestId),
      response_code: "00",
      response_message: "SUCCESS",
      amount: totalAmount,
      properties: {
        customerId: customer.id,
        order: {
          id: createdOrder.id,
          totalAmount: createdOrder.totalAmount,
          packageEnd: createdOrder.packageEnd,
        },
        payment_reference: `ORD-${createdOrder.id}`,
        radiusProvisioned,
        accountingProvider,
        tshulInvoice,
        nepurixInvoice
      }
    });

  } catch (err) {
    console.error("processPayment error:", err);

    // Mark pending payment as FAILED if it exists
    try {
      await req.prisma.eSewaTokenPayment.updateMany({
        where: {
          requestId: String(requestId),
          status: 'PENDING'
        },
        data: {
          status: 'FAILED',
          updatedAt: new Date()
        }
      });
    } catch (updateError) {
      console.error("Failed to update payment status:", updateError);
    }

    return res.status(err.statusCode || 500).json({
      request_id: String(requestId || ""),
      response_code: err.code || "99",
      response_message: "FAILED",
      error: err.message
    });
  }
};

/**
 * 3. PAYMENT CONFIRMATION (The main logic block)
 */
const confirmPayment = async (req, res) => {
  const { prisma, ispId } = req;
  const { request_id, amount, transaction_code } = req.body;

  try {
    // Validate eSewa Token
    const payment = await prisma.eSewaTokenPayment.findFirst({
      where: { requestId: request_id, status: 'PENDING' },
      include: {
        customer: {
          include: {
            subscribedPkg: { include: { oneTimeCharges: { where: { isDeleted: false } } } }
          }
        }
      }
    });

    if (!payment) return res.json({ response_code: 1, response_message: "Payment request not found" });

    const customer = payment.customer;
    const pkg = customer.subscribedPkg;
    const isRechargeable = Boolean(customer.isRechargeable);
    const newPackageAmount = pkg.initialTotalWithTax !== null && pkg.initialTotalWithTax !== undefined
      ? Number(pkg.initialTotalWithTax)
      : Number(pkg.price || 0);
    const renewalAmount = pkg.renewAmountWithTax !== null && pkg.renewAmountWithTax !== undefined
      ? Number(pkg.renewAmountWithTax)
      : Number(pkg.price || 0);
    const packagePrice = isRechargeable ? renewalAmount : newPackageAmount;

    const otcItems = pkg.oneTimeCharges.filter(o => !isRechargeable || o.isRenewal).map(o => ({
      id: o.id, name: o.name, referenceId: o.referenceId, amount: Number(o.amount || 0)
    }));

    const esewaPaymentMethod = await prisma.billingPaymentMethod.findFirst({
      where: { ispId, code: 'ESEWA', isEnabled: true }
    });

    // Start DB Transaction for Subscription Update and Order Creation
    const createdOrder = await prisma.$transaction(async (tx) => {
      const subscription = await tx.customerSubscription.findFirst({
        where: { customerId: customer.id, isActive: true },
        orderBy: { createdAt: "desc" }
      });

      if (!subscription) throw new Error("No active subscription found");

      const renewalWindow = await getRenewalWindow(tx, ispId, subscription);
      const renewalBase = renewalWindow.planStart;
      const expiryDateObj = computeExpiryFromBase(renewalBase, String(pkg.packageDuration || "1 month"));
      if (renewalWindow.trialDeductionDays > 0) expiryDateObj.setDate(expiryDateObj.getDate() - renewalWindow.trialDeductionDays);

      // Update Subscription
      const updatedSubscription = await tx.customerSubscription.update({
        where: { id: subscription.id },
        data: {
          planEnd: expiryDateObj,
          isTrial: false,
          isInvoicing: true,
          extensionCount: 0,
          graceDaysBalance: 0,
          compensationDays: 0,
          adminExtensionDays: 0,
          ...(subscription.isTrial ? { planStart: renewalBase } : {})
        }
      });

      // Update Customer Status
      if (!customer.isRechargeable) {
        await tx.customer.update({ where: { id: customer.id }, data: { isRechargeable: true } });
      }

      // Mark eSewa Token as Completed
      await tx.eSewaTokenPayment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED', eSewaTransactionCode: transaction_code, paidAt: new Date() }
      });

      // Create Order Management Record
      return await tx.customerOrderManagement.create({
        data: {
          customerId: customer.id,
          subscriptionId: updatedSubscription.id,
          packagePriceId: pkg.id,
          packageStart: renewalBase,
          packageEnd: updatedSubscription.planEnd,
          totalAmount: Number(amount),
          orderDate: new Date(),
          isPaid: true,
          paymentId: esewaPaymentMethod?.code || 'ESEWA',
          paymentMethodId: esewaPaymentMethod?.id || null,
          transactionCode: transaction_code,
          items: {
            create: [
              { itemName: pkg.packageName, referenceId: pkg.referenceId, itemPrice: packagePrice },
              ...otcItems.map(it => ({ itemName: it.name, referenceId: it.referenceId, itemPrice: it.amount }))
            ]
          }
        }
      });
    });

    // --- Post-Transaction: Radius Provisioning ---
    try {
      const radius = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, ispId);
      if (radius) {
        const users = await prisma.connectionUser.findMany({ where: { customerId: customer.id, isDeleted: false } });
        const expiryStr = formatRadiusExpiration(createdOrder.packageEnd);
        const replyResult = await radius.getRadreply();
        const radReplies = Array.isArray(replyResult) ? replyResult : [];

        for (const user of users) {
          // Logic for updating/creating Radius Expiration
          const existing = radReplies.find(r => r.username === user.username && String(r.attribute).toLowerCase() === "expiration");
          if (existing) {
            await radius.updateRadreply(existing.id, { value: expiryStr });
          } else {
            await radius.createRadreply({ username: user.username, attribute: "Expiration", op: ":=", value: expiryStr });
          }
          await radius.disconnectAllSessions(user.username).catch((disconnectError) => {
            console.warn(`[RADIUS] Session disconnect failed for ${user.username}:`, disconnectError.message);
          });
        }
      }
    } catch (re) { console.error("Radius Fail:", re.message); }

    // --- Post-Transaction: Selected Accounting Provider ---
    try {
      const [billingService] = await ServiceFactory.getActiveBillingClients(ispId, prisma);
      if (billingService) {
        console.log(`[DEBUG] ${billingService.code} client obtained for confirmation`);
      }
    } catch (billingError) { console.error("Accounting provider fail:", billingError.message); }

    // Return Success to eSewa
    res.json({
      request_id,
      response_code: 0,
      response_message: "Payment successful",
      amount,
      reference_code: `ORD-${createdOrder.id}`
    });

  } catch (error) {
    console.error("Payment Failure:", error);
    res.json({ response_code: 1, response_message: error.message });
  }
};

/**
 * 4. STATUS CHECK
 */
const checkStatus = async (req, res) => {
  const { request_id, transaction_code } = req.body;
  const payment = await req.prisma.eSewaTokenPayment.findFirst({
    where: { requestId: request_id, eSewaTransactionCode: transaction_code }
  });

  if (!payment) return res.json({ response_code: 3, status: "NOT FOUND" });

  res.json({
    request_id,
    response_code: payment.status === 'COMPLETED' ? 0 : 2,
    status: payment.status === 'COMPLETED' ? "SUCCESS" : "PENDING",
    amount: payment.amount
  });
};

const getEpayConfig = async (prisma, ispId) => {
  const service = await prisma.iSPService.findFirst({
    where: { ispId, service: { code: SERVICE_CODES.ESEWA }, isActive: true, isEnabled: true, isDeleted: false },
    include: { credentials: { where: { isActive: true, isDeleted: false } } }
  });
  if (!service) throw new Error('eSewa service is not enabled');
  const credentials = Object.fromEntries(service.credentials.map(item => [item.key, item.value]));
  const config = service.config && typeof service.config === 'object' ? service.config : {};
  if (config.epayEnabled === false) throw new Error('eSewa ePay v2 is disabled');
  const production = String(config.environment || '').toLowerCase() === 'production';
  return {
    productCode: credentials.merchant_code || config.productCode || 'EPAYTEST',
    secretKey: credentials.epay_secret_key || config.epaySecretKey || (production ? '' : '8gBm/:&EnhH.1/q'),
    formUrl: production
      ? 'https://epay.esewa.com.np/api/epay/main/v2/form'
      : 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    statusUrl: production
      ? 'https://esewa.com.np/api/epay/transaction/status/'
      : 'https://rc.esewa.com.np/api/epay/transaction/status/'
  };
};

const signEpayFields = (payload, signedFieldNames, secretKey) => {
  const message = signedFieldNames.split(',').map(field => `${field}=${payload[field]}`).join(',');
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
};

const initiateEpayRenewal = async (req, res, next) => {
  try {
    const customerId = Number(req.user?.customerId);
    if (!customerId) return res.status(403).json({ error: 'This login is not linked to a customer' });

    const customer = await req.prisma.customer.findFirst({
      where: { id: customerId, ispId: req.ispId, isDeleted: false },
      include: {
        subscribedPkg: { include: { oneTimeCharges: { where: { isDeleted: false, isRenewal: true } } } },
        customerSubscriptions: { where: { isActive: true }, orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
    if (!customer?.subscribedPkg || !customer.customerSubscriptions[0]) {
      return res.status(400).json({ error: 'Customer has no active renewable package' });
    }

    const pkg = customer.subscribedPkg;
    const amount = customer.isFree ? 0 : Number(pkg.renewAmountWithTax ?? pkg.price ?? 0);
    if (amount <= 0) return res.status(400).json({ error: 'Renewal amount must be greater than zero' });
    const epay = await getEpayConfig(req.prisma, req.ispId);
    if (!epay.secretKey) return res.status(400).json({ error: 'Configure the eSewa ePay secret key for production' });

    const transactionUuid = `ISP-${customer.id}-${Date.now()}`;
    const requestedReturnUrl = String(req.body?.returnUrl || '').trim();
    const allowedOrigin = String(process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:3000').replace(/\/$/, '');
    const returnUrl = requestedReturnUrl.startsWith(`${allowedOrigin}/`)
      ? requestedReturnUrl.replace(/[?#].*$/, '')
      : `${allowedOrigin}/customer/billing`;
    const signedFieldNames = 'total_amount,transaction_uuid,product_code';
    const fields = {
      amount: amount.toFixed(2), tax_amount: '0', total_amount: amount.toFixed(2),
      transaction_uuid: transactionUuid, product_code: epay.productCode,
      product_service_charge: '0', product_delivery_charge: '0',
      success_url: returnUrl, failure_url: `${returnUrl}?esewa=failure`,
      signed_field_names: signedFieldNames
    };
    fields.signature = signEpayFields(fields, signedFieldNames, epay.secretKey);

    await req.prisma.eSewaTokenPayment.create({
      data: {
        ispId: req.ispId, customerId: customer.id,
        customerUniqueId: customer.customerUniqueId || `CUST-${customer.id}`,
        requestId: transactionUuid, amount, status: 'PENDING',
        packageDetails: { packageId: pkg.id, packageName: pkg.packageName, source: 'EPAY_V2' }
      }
    });
    res.json({ success: true, formUrl: epay.formUrl, fields, testCredentials: { ids: ['9711111111', '9711111112', '9711111113', '9711111114'], password: 'Nepal@123', token: '123456' } });
  } catch (error) { next(error); }
};

const completeEpayRenewal = async (req, res, next) => {
  try {
    const customerId = Number(req.user?.customerId);
    if (!customerId) return res.status(403).json({ error: 'This login is not linked to a customer' });
    const encoded = String(req.body?.data || '').replace(/ /g, '+');
    if (!encoded) return res.status(400).json({ error: 'eSewa response data is required' });
    let response;
    try { response = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
    catch { return res.status(400).json({ error: 'Invalid eSewa response data' }); }

    const payment = await req.prisma.eSewaTokenPayment.findFirst({
      where: { requestId: response.transaction_uuid, customerId, ispId: req.ispId },
      include: { customer: { include: { subscribedPkg: { include: { oneTimeCharges: { where: { isDeleted: false, isRenewal: true } } } } } } }
    });
    if (!payment) return res.status(404).json({ error: 'Payment request not found' });
    if (payment.status === 'COMPLETED') return res.json({ success: true, alreadyCompleted: true, referenceCode: payment.referenceCode });

    const epay = await getEpayConfig(req.prisma, req.ispId);
    const expectedSignature = signEpayFields(response, response.signed_field_names, epay.secretKey);
    const signatureValid = expectedSignature.length === String(response.signature || '').length && crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(String(response.signature || '')));
    if (!signatureValid) return res.status(400).json({ error: 'Invalid eSewa response signature' });

    const statusResponse = await axios.get(epay.statusUrl, { params: { product_code: epay.productCode, total_amount: payment.amount, transaction_uuid: payment.requestId }, timeout: 15000 });
    if (statusResponse.data?.status !== 'COMPLETE' || Number(statusResponse.data?.total_amount) !== Number(payment.amount)) {
      return res.status(409).json({ error: `Payment is not complete (${statusResponse.data?.status || 'UNKNOWN'})` });
    }

    const pkg = payment.customer.subscribedPkg;
    const subscription = await req.prisma.customerSubscription.findFirst({ where: { customerId, isActive: true }, orderBy: { createdAt: 'desc' } });
    if (!pkg || !subscription) return res.status(400).json({ error: 'Active subscription or package not found' });
    const renewalWindow = await getRenewalWindow(req.prisma, req.ispId, subscription);
    const planStart = renewalWindow.planStart;
    const planEnd = computeExpiryFromBase(planStart, pkg.packageDuration);
    if (renewalWindow.trialDeductionDays > 0) planEnd.setDate(planEnd.getDate() - renewalWindow.trialDeductionDays);
    const renewalItems = pkg.oneTimeCharges.map(item => ({ itemName: item.name || 'Renewal Item', referenceId: item.referenceId, itemPrice: Number(item.amount || 0) }));
    const itemTotal = renewalItems.reduce((sum, item) => sum + item.itemPrice, 0);

    const order = await req.prisma.$transaction(async tx => {
      await tx.customerSubscription.update({ where: { id: subscription.id }, data: { isActive: false } });
      const newSubscription = await tx.customerSubscription.create({ data: { customerId, package: pkg.id, planStart, planEnd, isTrial: false, isActive: true, isInvoicing: true, extensionCount: 0, graceDaysBalance: 0, compensationDays: 0, adminExtensionDays: 0 } });
      const esewaPaymentMethod = await tx.billingPaymentMethod.findFirst({
        where: { ispId: req.ispId, code: 'ESEWA', isEnabled: true }
      });
      const createdOrder = await tx.customerOrderManagement.create({
        data: {
          customerId, subscriptionId: newSubscription.id, package: pkg.id,
          orderDate: new Date(), packageStart: planStart, packageEnd: planEnd,
          totalAmount: payment.amount, isPaid: true, isActive: true,
          paymentId: esewaPaymentMethod?.code || 'ESEWA',
          paymentMethodId: esewaPaymentMethod?.id || null,
          items: { create: [{ itemName: pkg.packageName || 'Package Renewal', referenceId: pkg.referenceId, itemPrice: Math.max(0, payment.amount - itemTotal) }, ...renewalItems] }
        }
      });
      await tx.customer.update({ where: { id: customerId }, data: { isRechargeable: true, status: 'active', onboardStatus: 'fully_onboarded' } });
      await tx.eSewaTokenPayment.update({ where: { id: payment.id }, data: { status: 'COMPLETED', paidAt: new Date(), eSewaTransactionCode: response.transaction_code, referenceCode: statusResponse.data.ref_id || response.transaction_code, orderId: String(createdOrder.id) } });
      return createdOrder;
    });
    try {
      const radius = await ServiceFactory.getClient(SERVICE_CODES.RADIUS, req.ispId);
      const users = await req.prisma.connectionUser.findMany({ where: { customerId, isDeleted: false, isActive: true }, select: { username: true } });
      for (const user of users) {
        await radius.updateExpiration(user.username, planEnd);
        await radius.disconnectAllSessions(user.username).catch((disconnectError) => {
          console.warn(`[RADIUS] Session disconnect failed for ${user.username}:`, disconnectError.message);
        });
      }
    } catch (radiusError) {
      console.warn('[eSewa ePay] Renewal completed but RADIUS expiration sync failed:', radiusError.message);
    }
    res.json({ success: true, orderId: order.id, referenceCode: statusResponse.data.ref_id || response.transaction_code, planEnd });
  } catch (error) { next(error); }
};

module.exports = { confirmPayment, checkStatus, processPayment, paymentInquiry, initiateEpayRenewal, completeEpayRenewal };
