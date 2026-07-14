const { detectAgentIntent, detectLanguage } = require('./ai-agent-router.service');

const firstNumber = text => String(text).match(/(?:customer|invoice|ticket|device|lead|id)\s*#?:?\s*(\d+)/i)?.[1];
const idFor = (text, label) => String(text).match(new RegExp(`${label}\\s*#?:?\\s*(\\d+)`, 'i'))?.[1];
const isGreeting = text => /^(hi|hello|hey|good\s+(morning|afternoon|evening)|namaste|namaskar)[!.\s]*$/i.test(String(text).trim());
const emailFrom = text => String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
const phoneFrom = text => String(text).match(/(?:\+?977[-\s]?)?(9[678]\d{8})/)?.[1];
const asksIdentity = text => /\b(who am i|what is my name|my name|logged in|profile|mero naam|mera naam|hamar naam|wie heisse)\b/i.test(String(text));

async function safeQuery(query) {
  try { return await query(); }
  catch (error) { console.error('[AI context query]', error.message); return null; }
}

const customerSelect = {
  id: true, leadId: true, customerUniqueId: true, status: true, onboardStatus: true, isRechargeable: true,
  oltId: true, splitterId: true, createdAt: true,
  lead: { select: { firstName: true, middleName: true, lastName: true, email: true, phoneNumber: true, secondaryContactNumber: true, street: true, district: true, province: true } },
  portalUser: { select: { id: true, email: true, name: true, status: true } },
  devices: { select: { id: true, deviceType: true, brand: true, model: true, serialNumber: true, macAddress: true, ponSerial: true, provisioningStatus: true } },
  connectionUsers: { select: { id: true, username: true, isActive: true } },
  serviceDetails: { select: { id: true, oltId: true, splitterId: true, oltPort: true, splitterPort: true, vlanId: true, connectionType: true, status: true } },
  olt: { select: { id: true, name: true, ipAddress: true, vendor: true, model: true, status: true, lastSeen: true, totalPorts: true, usedPorts: true, totalSubscribers: true, activeSubscribers: true } },
  splitter: { select: { id: true, splitterId: true, name: true, splitRatio: true, portCount: true, usedPorts: true, availablePorts: true, status: true } }
};

function normalizeCustomer(customer) {
  if (!customer) return null;
  const fullName = [customer.lead?.firstName, customer.lead?.middleName, customer.lead?.lastName].filter(Boolean).join(' ');
  return {
    ...customer,
    fullName: fullName || customer.portalUser?.name || null,
    firstName: customer.lead?.firstName,
    middleName: customer.lead?.middleName,
    lastName: customer.lead?.lastName,
    email: customer.lead?.email || customer.portalUser?.email,
    phoneNumber: customer.lead?.phoneNumber,
    street: customer.lead?.street,
    district: customer.lead?.district,
    state: customer.lead?.province
  };
}

async function getUserProfile(prisma, user) {
  if (!user?.id) return null;
  const profile = await safeQuery(() => prisma.user.findFirst({
    where: { id: Number(user.id), isDeleted: false },
    select: {
      id: true, name: true, email: true, status: true, yeastarExt: true, customerId: true, ispId: true, branchId: true,
      role: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      isp: { select: { id: true, companyName: true } }
    }
  }));
  if (!profile) return { id: user.id, email: user.email, role: user.role, customerId: user.customerId };
  return {
    ...profile,
    roleName: profile.role?.name || user.role || null,
    permissions: Array.isArray(user.permissions) ? user.permissions : []
  };
}

async function findCustomer(prisma, ispId, { id, email, phone, customerId }) {
  let where = null;
  if (customerId) where = { id: Number(customerId) };
  else if (id) where = { id: Number(id) };
  else if (email) where = { OR: [{ lead: { email } }, { portalUser: { email } }] };
  else if (phone) where = { lead: { phoneNumber: { contains: phone } } };
  if (!where) return null;
  return normalizeCustomer(await safeQuery(() => prisma.customer.findFirst({ where: { ...where, ispId }, select: customerSelect })));
}

async function collectAgentContext({ prisma, ispId, agent, message, currentMessage, user }) {
  const text = String(message || '');
  const currentText = String(currentMessage || message || '');
  const currentIntent = detectAgentIntent(currentText);
  const performed = [];
  const records = {
    language: detectLanguage(currentText),
    intent: currentIntent,
    user: await getUserProfile(prisma, user)
  };

  if (isGreeting(currentText)) return { kind: 'GREETING', records, performed, language: records.language };

  const customerId = idFor(currentText, 'customer') || null;
  const leadId = idFor(currentText, 'lead') || null;
  const invoiceId = idFor(currentText, 'invoice') || null;
  const ticketId = idFor(currentText, 'ticket') || null;
  const genericId = firstNumber(currentText);
  const email = emailFrom(currentText);
  const phone = phoneFrom(currentText);

  const customer = await findCustomer(prisma, ispId, {
    id: customerId || (!leadId && !invoiceId && !ticketId ? genericId : null),
    email,
    phone,
    customerId: user?.customerId || records.user?.customerId
  });

  if (customer) {
    records.customer = customer;
    performed.push('getCustomer', 'getCustomerServices');
    if (customer.olt) { records.olts = [customer.olt]; performed.push('getOLTStatus'); }
    if (customer.splitter) { records.splitters = [customer.splitter]; performed.push('getSplitterDetails'); }
  }

  if ((leadId || (agent.slug === 'sales' && genericId)) && !records.lead) {
    const id = Number(leadId || genericId);
    records.lead = await safeQuery(() => prisma.lead.findFirst({ where: { id, ispId } }));
    if (records.lead) performed.push('getLead');
  }

  if (invoiceId || (agent.slug === 'billing' && genericId)) {
    records.invoice = await safeQuery(() => prisma.invoice.findFirst({ where: { id: Number(invoiceId || genericId), ispId } }));
    if (records.invoice) performed.push('getInvoice');
  }

  if (ticketId || (agent.slug === 'support' && genericId)) {
    records.ticket = await safeQuery(() => prisma.ticket.findFirst({ where: { id: Number(ticketId || genericId), ispId } }));
    if (records.ticket) performed.push('getTicket');
  }

  if (agent.slug === 'ceo' || /company|business|kpi|summary|briefing|overview/i.test(currentText)) {
    const [total, active, open] = await Promise.all([
      safeQuery(() => prisma.customer.count({ where: { ispId } })),
      safeQuery(() => prisma.customer.count({ where: { ispId, status: 'ACTIVE' } })),
      safeQuery(() => prisma.ticket.count({ where: { ispId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }))
    ]);
    records.kpis = { totalCustomers: total, activeCustomers: active, openTickets: open };
    performed.push('getKpiDashboard');
  }

  if (agent.slug === 'noc' || /\bolt\b|splitter|fiber|network|tr-?069|acs|nas|device status|devices? (?:are )?online/i.test(currentText)) {
    const oltId = String(currentText).match(/olt\s*#?:?\s*(\d+)/i)?.[1];
    const splitterId = String(currentText).match(/splitter\s*#?:?\s*([\w-]+)/i)?.[1];
    if (!records.olts) {
      records.olts = await safeQuery(() => prisma.oLT.findMany({
        where: { ispId, isDeleted: false, ...(oltId ? { id: Number(oltId) } : {}) },
        select: { id: true, name: true, ipAddress: true, vendor: true, model: true, status: true, lastSeen: true, totalPorts: true, usedPorts: true, availablePorts: true, totalSubscribers: true, activeSubscribers: true, site: true, region: true },
        take: oltId ? 1 : 10,
        orderBy: { name: 'asc' }
      }));
      if (records.olts) performed.push('getOLTStatus');
    }
    if (!records.splitters) {
      records.splitters = await safeQuery(() => prisma.splitter.findMany({
        where: { ispId, isDeleted: false, ...(splitterId ? { OR: [{ splitterId }, { name: { contains: splitterId } }] } : {}) },
        select: { id: true, splitterId: true, name: true, splitRatio: true, portCount: true, usedPorts: true, availablePorts: true, status: true, isActive: true, oltId: true, location: true },
        take: splitterId ? 5 : 10,
        orderBy: { name: 'asc' }
      }));
      if (records.splitters) performed.push('getSplitterDetails');
    }
  }

  if (/tr-?069|acs|device status|devices? (?:are )?online|list .*devices?|show .*devices?/i.test(currentText)) {
    if (records.customer?.leadId) {
      records.tr069Devices = await safeQuery(() => prisma.tr069Device.findMany({
        where: { ispId, leadId: records.customer.leadId, isDeleted: false },
        select: { id: true, serialNumber: true, manufacturer: true, modelName: true, ipAddress: true, status: true, lastContact: true, firmwareVersion: true, macAddress: true }
      }));
    } else if (!user?.customerId) {
      const limit = Math.max(1, Math.min(Number(String(currentText).match(/\b(\d{1,2})\b/)?.[1] || 20), 25));
      const statusFilter = /\b(active|online|up|connected)\b/i.test(currentText) ? { status: 'online' } : {};
      const [total, online, offline, devices] = await Promise.all([
        safeQuery(() => prisma.tr069Device.count({ where: { ispId, isDeleted: false } })),
        safeQuery(() => prisma.tr069Device.count({ where: { ispId, isDeleted: false, status: 'online' } })),
        safeQuery(() => prisma.tr069Device.count({ where: { ispId, isDeleted: false, status: 'offline' } })),
        safeQuery(() => prisma.tr069Device.findMany({ where: { ispId, isDeleted: false, ...statusFilter }, select: { id: true, serialNumber: true, manufacturer: true, modelName: true, ipAddress: true, status: true, lastContact: true }, take: limit, orderBy: { lastContact: 'desc' } }))
      ]);
      records.tr069Summary = { total, online, offline };
      records.tr069Devices = devices;
    }
    performed.push('getTR069DeviceStatus');
  }

  if (asksIdentity(currentText) && records.user) performed.push('getSignedInUser');

  return {
    kind: performed.length || asksIdentity(currentText) ? 'RECORDS' : 'CLARIFICATION',
    records,
    performed: [...new Set(performed)],
    requestedId: genericId || null,
    language: records.language
  };
}

module.exports = { collectAgentContext, isGreeting };
