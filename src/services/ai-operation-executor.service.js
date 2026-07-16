const { syncDevices } = require('../controllers/tr069device.controller');
const nasController = require('../controllers/nas.controller');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');

const allowed = (user, permission) => Array.isArray(user?.permissions) && user.permissions.includes(permission);
const canAny = (user, permissions) => permissions.some(permission => allowed(user, permission));

const invoke = (handler, req) => new Promise((resolve, reject) => {
  let code = 200;
  const res = {
    status(value) { code = value; return this; },
    json(body) { code >= 400 ? reject(new Error(body?.error || body?.message || 'Operation failed')) : resolve(body); return this; },
    send(body) { resolve(body); return this; }
  };
  Promise.resolve(handler(req, res, reject)).catch(reject);
});

function pickDomain(source, domains) {
  let best = null;
  for (const domain of domains) {
    for (const pattern of domain.patterns) {
      for (const match of source.matchAll(pattern)) {
        if (!best || match.index > best.index) best = { index: match.index, operation: domain.operation };
      }
    }
  }
  return best;
}

function extractSerialFromNumberedList(contextMessage, number) {
  const ordinal = Number(number);
  if (!ordinal) return null;
  const source = String(contextMessage || '');
  const serialPattern = '[A-Z0-9][A-Z0-9:-]{5,}[A-Z0-9]';
  const linePattern = new RegExp(`(?:^|\\n)\\s*(?:assistant:\\s*)?${ordinal}\\s*[.)-]\\s*(${serialPattern})\\b`, 'ig');
  let found = null;
  for (const match of source.matchAll(linePattern)) found = match[1];
  if (found) return found;

  const inlinePattern = new RegExp(`\\b${ordinal}\\s*[.)-]\\s*(${serialPattern})\\b`, 'ig');
  for (const match of source.matchAll(inlinePattern)) found = match[1];
  return found;
}

function extractOrdinalDeviceNumber(message) {
  const raw = String(message || '');
  const patterns = [
    /\b(?:number|no\.?|#)\s*(\d{1,2})\s+(?:number\s+)?(?:tr-?069\s+)?device\b/i,
    /\b(?:tr-?069\s+)?device\s+(?:number|no\.?|#)\s*(\d{1,2})\b/i,
    /\b(?:tr-?069\s+)?device\s+(\d{1,2})\b/i,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:number\s+)?(?:tr-?069\s+)?device\b/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractTr069Lookup(message, contextMessage = '') {
  const raw = String(message || '');
  const serialMatch = raw.match(/\b(?=[A-Z0-9:-]*[A-Z])(?=[A-Z0-9:-]*\d)[A-Z0-9][A-Z0-9:-]{5,}[A-Z0-9]\b/i);
  if (serialMatch && !/^tr-?069$/i.test(serialMatch[0]) && !/^(?:K-)?CUST-/i.test(serialMatch[0])) return { serial: serialMatch[0].trim() };
  const ordinal = extractOrdinalDeviceNumber(raw);
  if (ordinal) {
    const serial = extractSerialFromNumberedList(contextMessage, ordinal);
    if (serial) return { serial, ordinal };
  }
  const deviceIdMatch = raw.match(/\b(?:tr-?069\s+)?device\s+(?:id|#)\s*:?\s*(\d+)\b/i);
  if (deviceIdMatch) return { id: Number(deviceIdMatch[1]) };
  return null;
}

const cleanSsidName = value => String(value || '').trim().replace(/^["'`]+|["'`.,;]+$/g, '').trim();
const emailFrom = text => String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
const customerRefFrom = text => String(text || '').match(/\bK-CUST-\d+\b/i)?.[0]?.toUpperCase() || String(text || '').match(/\bcustomer\s*(?:id|#)?\s*:?\s*([A-Z0-9-]+)\b/i)?.[1] || null;

function extractWifiSsidUpdate(message, contextMessage = '') {
  const raw = String(message || '');
  const lower = raw.toLowerCase();
  const isWifiUpdate = /\b(wifi|wi-fi|wireless|ssid|wlan)\b/.test(lower) && /\b(update|change|set|rename|modify|configure)\b/.test(lower);
  if (!isWifiUpdate) return null;

  const lookup = extractTr069Lookup(raw, contextMessage) || extractTr069Lookup(contextMessage, contextMessage);
  const indexMatch =
    raw.match(/\b(?:ssid|wifi|wi-fi|wlan)\s*(?:index|number|no\.?|#)?\s*(\d{1,2})\b/i) ||
    raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:ssid|wifi|wi-fi|wlan)\b/i);
  const ssidIndex = indexMatch ? Math.max(1, Math.min(Number(indexMatch[1]), 16)) : 1;

  const oldName = cleanSsidName(raw.match(/\b(?:from|of)\s+["']?(.+?)["']?\s+\bto\b/i)?.[1]);
  const newNamePatterns = [
    /\bto\s+["']?(.+?)["']?\s+\b(?:of|for|on)\s+(?:the\s+)?(?:device|tr-?069|serial|onu|ont)\b/i,
    /\b(?:wifi|wi-fi|wireless|ssid|wlan)(?:\s+name)?\s*(?:to|as|=|:)\s*["']?([A-Za-z0-9 _.-]{1,64})["']?/i,
    /\b(?:rename|change|update|set|modify|configure)\b.*?\bto\s+["']?([A-Za-z0-9 _.-]{1,64})["']?\s*$/i
  ];
  let ssidName = '';
  for (const pattern of newNamePatterns) {
    const match = raw.match(pattern);
    if (match) {
      ssidName = cleanSsidName(match[1]);
      break;
    }
  }

  return { lookup, ssidIndex, oldName: oldName || null, ssidName: ssidName || null };
}

function extractTicketCreateRequest(message) {
  const raw = String(message || '');
  const lower = raw.toLowerCase();
  const wantsCreate = /\b(create|open|raise|log|make|generate|new)\b.{0,40}\btickets?\b|\btickets?\b.{0,40}\b(create|open|raise|log|make|generate|new)\b/.test(lower);
  if (!wantsCreate) return null;

  const customerMatch = raw.match(/\bcustomer\s*(?:id|#)?\s*:?\s*([A-Z0-9-]+)\b/i);
  const leadMatch = raw.match(/\blead\s*(?:id|#)?\s*:?\s*(\d+)\b/i);
  const titleMatch =
    raw.match(/\btickets?\s+for\s+(.+?)(?:\s+for\s+customer|\s+customer\s*(?:id|#)|\s+for\s+lead|\s+lead\s*(?:id|#)|\s+(?:assign|assing|assigned|allocate)\b|$)/i) ||
    raw.match(/\b(?:issue|problem|complaint)\s+(?:is|for|about)\s+(.+?)(?:\s+for\s+customer|\s+customer\s*(?:id|#)|\s+(?:assign|assing|assigned|allocate)\b|$)/i);
  const title = cleanSsidName(titleMatch?.[1] || raw.replace(/\bplease\b/i, '').replace(/\b(create|open|raise|log|make|generate|new)\b/i, '').replace(/\btickets?\b/i, '').trim()) || 'Support ticket';
  const priority = /\b(critical|emergency|urgent|down|no internet|not working)\b/i.test(raw)
    ? 'CRITICAL'
    : /\b(high|important|slow internet|internet slow|slow)\b/i.test(raw)
      ? 'HIGH'
      : /\b(low|minor)\b/i.test(raw)
        ? 'LOW'
        : 'MEDIUM';
  const category = /\b(internet|wifi|wi-fi|network|speed|slow|router|tr-?069|olt|ont|onu)\b/i.test(raw) ? 'NETWORK' : 'SUPPORT';

  return {
    title: title.slice(0, 190),
    description: raw,
    priority,
    category,
    customerRef: customerMatch?.[1] || null,
    leadId: leadMatch ? Number(leadMatch[1]) : null,
    assigneeEmail: emailFrom(raw)
  };
}

const parseDeviceNotes = notes => {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

function inferOperation(message, contextMessage = message) {
  const current = String(message || '').toLowerCase();
  const context = String(contextMessage || message || '').toLowerCase();
  const conversationalOnly = /^(?:hi|hello|hey|namaste|good\s+(?:morning|afternoon|evening))[!?.\s]*$/i.test(String(message || '').trim())
    || /\b(?:who am i|what(?:'s| is) my (?:actual |real )?name|do you know my (?:actual |real )?name|my (?:actual |real )?name|logged in as|my profile)\b/i.test(String(message || ''))
    || /\b(?:how are you|how's it going|thank you|thanks)\b/i.test(String(message || ''));
  if (conversationalOnly) return null;
  const mutation = /\b(re-?sync|sync|refresh|run again|test again|retry|recheck|scan again)\b/.test(current);
  const listRequest = /\b(list|show|give|display|which|details?|names?)\b/.test(current);
  const countRequest = /\b(how many|count|total|summary|number of)\b/.test(current);
  const openOnly = /\b(open|pending|unresolved|active)\b/.test(current);
  const followUpRequest = mutation || listRequest || /\b(them|those|it|again|same)\b/.test(current);
  const activeOnly = /\b(active|online|up|connected)\b/.test(current) || /\b(active|online|up|connected)\b/.test(context);
  const ticketCreate = extractTicketCreateRequest(message);
  if (ticketCreate) return 'createTicket';
  const updateNasRequest=/\b(?:update|edit|change|modify)\b.{0,100}\b(?:nas|network access server)\b|\b(?:nas|network access server)\b.{0,100}\b(?:update|edit|change|modify)\b/i.test(String(message||''));
  if(updateNasRequest)return'prepareUpdateNasApproval';
  const createNasRequest = /\b(?:create|add|connect|configure|provision|register|setup|set up)\b.{0,100}\b(?:nas|network access server)\b|\b(?:nas|network access server)\b.{0,100}\b(?:create|add|connect|configure|provision|register|setup|set up)\b/i.test(String(message||''))
    || (/^(?:add new one|create new one|do it|proceed)[.!?\s]*$/i.test(String(message||'').trim()) && /\b(?:create|add|connect|provision)\b.{0,100}\bnas\b/i.test(String(contextMessage||'')));
  if (createNasRequest) return 'prepareCreateNasApproval';
  const wifiSsidUpdate = extractWifiSsidUpdate(message, contextMessage);
  if (wifiSsidUpdate) return 'updateTr069WifiSsid';
  const tr069Lookup = extractTr069Lookup(message, contextMessage) || extractTr069Lookup(contextMessage, contextMessage);
  if (/\b(wifi|wi-fi|wireless|ssid|wlan)\b/.test(current) && /\b(details?|status|check|confirm|show|get|current)\b/.test(current) && tr069Lookup) return 'getTr069WifiDetails';
  if (customerRefFrom(message) && /\b(internet|wifi|wi-fi|network|connection)\b/.test(context) && /\b(slow|issue|problem|down|offline|not working|unstable|diagnos|check)\b/.test(context)) return 'diagnoseCustomerInternet';
  if (customerRefFrom(message) && !/\b(summary|total|count|how many)\b/.test(current)) return 'getCustomerDetail';
  if (/\b(internet|wifi|wi-fi|network|connection)\b/.test(current) && /\b(slow|issue|problem|down|offline|not working|unstable|diagnos|check)\b/.test(current)) return 'diagnoseCustomerInternet';
  if (/\b(?:linked|associated|customer(?:'s)?)\b.{0,30}\btr-?069\b|\btr-?069\b.{0,30}\b(?:linked|associated|details?|info)\b/.test(current) && customerRefFrom(contextMessage)) return 'getTr069DeviceDetail';
  const wantsTr069Detail = tr069Lookup && /\b(tr-?069|acs|device|serial|onu|ont)\b/.test(current) && /\b(details?|info|information|profile|status|check|lookup|find|get)\b/.test(current);
  if (wantsTr069Detail) return 'getTr069DeviceDetail';

  const domains = [
    { operation: mutation ? 'syncTr069' : listRequest ? 'listTr069Devices' : 'getTr069Summary', patterns: [/tr-?069/g, /genieacs/g, /acs device/g, /customer device status/g] },
    { operation: mutation ? 'resyncNas' : 'getNasSummary', patterns: [/\bnas\b/g, /network access server/g] },
    { operation: listRequest ? 'listServices' : 'getServiceSummary', patterns: [/\bservices?\b/g, /\bintegrations?\b/g, /\bservice catalog\b/g] },
    { operation: listRequest ? 'listInvoices' : 'getInvoiceSummary', patterns: [/\binvoices?\b/g, /\bbills?\b/g, /\bbilling\b/g] },
    { operation: 'getOltSummary', patterns: [/\bolt\b/g] },
    { operation: 'getSplitterSummary', patterns: [/splitter/g] },
    { operation: listRequest ? (openOnly ? 'listOpenTickets' : 'listTickets') : 'getTicketSummary', patterns: [/tickets?/g, /complaints?/g] },
    { operation: 'getLeadSummary', patterns: [/\bleads?\b/g, /prospects?/g] },
    { operation: listRequest && !countRequest ? 'listCustomers' : 'getCustomerSummary', patterns: [/customers?/g, /subscribers?/g, /users?/g] }
  ];

  if (/\b(?:check|show|list|get)\b.{0,40}\b(?:support\s+)?tickets?\b|\b(?:support\s+)?tickets?\b.{0,40}\b(?:check|show|list|get)\b/.test(current)) return openOnly ? 'listOpenTickets' : 'listTickets';

  let best = pickDomain(current, domains);
  if (!best && followUpRequest) best = pickDomain(context, domains);
  if (!best && countRequest && /\bactive\b/.test(current) && /\bservices?\b/.test(current)) best = { operation: 'getServiceSummary' };
  if (!best && countRequest && /\binvoices?\b|\bbills?\b/.test(current)) best = { operation: 'getInvoiceSummary' };

  if (best?.operation === 'listTr069Devices') return activeOnly ? 'listTr069OnlineDevices' : 'listTr069Devices';
  if (best?.operation === 'listServices' && activeOnly) return 'listActiveServices';
  return best?.operation || null;
}

function safeNas(device) {
  const { password, secret, sharedSecret, apiSecret, authSecret, ...safe } = device;
  return safe;
}

async function getServiceOperation(prisma, ispId, user, operation) {
  if (!canAny(user, ['services_read', 'services_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot read services.' };
  const serviceWhere = { ispId, isDeleted: false, ...(operation === 'listActiveServices' ? { isActive: true } : {}) };
  const [catalogTotal, catalogActive, configured, active, enabled, services] = await Promise.all([
    prisma.service.count({ where: { isDeleted: false } }),
    prisma.service.count({ where: { isDeleted: false, isActive: true } }),
    prisma.iSPService.count({ where: { ispId, isDeleted: false } }),
    prisma.iSPService.count({ where: { ispId, isDeleted: false, isActive: true } }),
    prisma.iSPService.count({ where: { ispId, isDeleted: false, isEnabled: true } }),
    prisma.iSPService.findMany({
      where: serviceWhere,
      select: {
        id: true, isActive: true, isEnabled: true, baseUrl: true, apiVersion: true, updatedAt: true,
        service: { select: { name: true, code: true, category: true, isActive: true } }
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      take: operation === 'getServiceSummary' ? 8 : 25
    })
  ]);
  return { operation, performed: ['getServiceSummary'], data: { catalogTotal, catalogActive, configured, active, enabled, services } };
}

async function getInvoiceOperation(prisma, ispId, user, operation) {
  if (!canAny(user, ['billing_read', 'billing_read_self', 'dashboard_view'])) return { operation, approvalRequired: true, error: 'Your role cannot read invoices.' };
  const baseWhere = { isDeleted: false, customer: { ispId } };
  const now = new Date();
  const [total, paid, pending, overdue, amount, invoices] = await Promise.all([
    prisma.customerOrderManagement.count({ where: baseWhere }),
    prisma.customerOrderManagement.count({ where: { ...baseWhere, isPaid: true } }),
    prisma.customerOrderManagement.count({ where: { ...baseWhere, isPaid: false, packageEnd: { gte: now } } }),
    prisma.customerOrderManagement.count({ where: { ...baseWhere, isPaid: false, packageEnd: { lt: now } } }),
    prisma.customerOrderManagement.aggregate({ where: baseWhere, _sum: { totalAmount: true } }),
    prisma.customerOrderManagement.findMany({
      where: baseWhere,
      select: {
        id: true, invoiceId: true, orderDate: true, packageEnd: true, totalAmount: true, isPaid: true,
        customer: { select: { id: true, customerUniqueId: true, lead: { select: { firstName: true, lastName: true, email: true, phoneNumber: true } } } },
        packagePrice: { select: { packageName: true } }
      },
      orderBy: { orderDate: 'desc' },
      take: operation === 'listInvoices' ? 15 : 5
    })
  ]);
  return { operation, performed: ['getInvoiceSummary'], data: { total, paid, pending, overdue, amount: amount._sum.totalAmount || 0, invoices } };
}

async function nextTicketNumber(prisma, ispId) {
  const count = await prisma.ticket.count({ where: { ispId } });
  for (let offset = 1; offset <= 100; offset += 1) {
    const candidate = `TKT-${String(count + offset).padStart(5, '0')}`;
    const exists = await prisma.ticket.findUnique({ where: { ticketNumber: candidate }, select: { id: true } }).catch(() => null);
    if (!exists) return candidate;
  }
  return `TKT-${Date.now()}`;
}

async function findTicketCustomer(prisma, ispId, customerRef) {
  if (!customerRef) return null;
  const ref = String(customerRef).trim();
  const numeric = /^\d+$/.test(ref) ? Number(ref) : null;
  const padded = numeric ? `K-CUST-${String(numeric).padStart(3, '0')}` : ref;
  return prisma.customer.findFirst({
    where: {
      ispId,
      isDeleted: false,
      OR: [
        ...(numeric ? [{ id: numeric }] : []),
        { customerUniqueId: ref },
        { customerUniqueId: padded }
      ]
    },
    select: {
      id: true,
      customerUniqueId: true,
      leadId: true,
      branchId: true,
      subBranchId: true,
      status: true,
      lead: { select: { firstName: true, middleName: true, lastName: true, email: true, phoneNumber: true } },
      connectionUsers: { where: { isDeleted: false }, select: { username: true, isActive: true } },
      devices: { select: { id: true, deviceType: true, brand: true, model: true, serialNumber: true, ponSerial: true, macAddress: true, provisioningStatus: true } },
      serviceDetails: { select: { status: true, connectionType: true, oltId: true, splitterId: true, oltPort: true, vlanId: true } },
      olt: { select: { id: true, name: true, ipAddress: true, status: true, lastSeen: true } },
      splitter: { select: { id: true, name: true, splitterId: true, status: true, usedPorts: true, availablePorts: true } }
    }
  });
}

async function resolveLinkedTr069Lookup(prisma, ispId, message, contextMessage) {
  const direct = extractTr069Lookup(message, contextMessage);
  if (direct) return direct;
  const contextual = extractTr069Lookup(contextMessage, contextMessage);
  if (contextual) return contextual;
  const customerRef = customerRefFrom(message) || customerRefFrom(contextMessage);
  if (!customerRef) return null;
  const resolved = await resolveCustomerTr069Devices({prisma,ispId,customerUniqueId:customerRef});
  const device = resolved.tr069Devices[0] || null;
  return device ? { id: device.id, serial: device.serialNumber, customerRef, linked: true, device } : null;
}

async function resolveCustomerTr069Devices({prisma,ispId,customerId,customerUniqueId}) {
  const reference=customerUniqueId||customerId;
  const customer = await findTicketCustomer(prisma, ispId, reference);
  if (!customer) return { found:false, customer:null, services:[], cpeDevices:[], devices:[],tr069Devices:[],count:0,sourceLinks:[] };
  const serials = [...new Set((customer.devices || []).flatMap(item => [item.serialNumber, item.ponSerial]).filter(Boolean))];
  const links = [...(customer.leadId ? [{ leadId:customer.leadId }] : []),...serials.flatMap(serial => [{ serialNumber:serial },{ serialNumber:{ contains:serial } }])];
  const sourceLinks=[{type:'CUSTOMER_ID',value:String(customer.id)},{type:'CUSTOMER_REF',value:customer.customerUniqueId},...(customer.leadId?[{type:'LEAD_ID',value:String(customer.leadId)}]:[]),...serials.map(value=>({type:'DEVICE_SERIAL',value})),...(customer.connectionUsers||[]).map(item=>({type:'CONNECTION_USERNAME',value:item.username})),...(customer.serviceDetails||[]).map((item,index)=>({type:'SERVICE_ASSIGNMENT',value:String(index+1),status:item.status}))];
  let tr069Devices = [];
  if (links.length) {
    const query = {
      where:{ ispId,isDeleted:false,OR:links },
      select:{ id:true,serialNumber:true,oui:true,productClass:true,manufacturer:true,modelName:true,ipAddress:true,status:true,lastContact:true,firmwareVersion:true,macAddress:true,notes:true,leadId:true,isActive:true,createdAt:true,updatedAt:true }
    };
    if (typeof prisma.tr069Device.findMany === 'function') tr069Devices = await prisma.tr069Device.findMany(query).catch(()=>[]);
    else if (typeof prisma.tr069Device.findFirst === 'function') {
      const first = await prisma.tr069Device.findFirst(query).catch(()=>null);
      tr069Devices = first ? [first] : [];
    }
  }
  return { found:true,customer,services:customer.serviceDetails || [],cpeDevices:customer.devices || [],devices:tr069Devices,tr069Devices,count:tr069Devices.length,sourceLinks };
}

const resolveCustomerDevices=(prisma,ispId,reference)=>resolveCustomerTr069Devices({prisma,ispId,customerUniqueId:reference});

async function createTicketOperation(prisma, ispId, user, message) {
  const operation = 'createTicket';
  if (!canAny(user, ['tickets_create', 'tickets_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot create tickets.' };

  const request = extractTicketCreateRequest(message);
  if (!request) return { operation, error: 'Tell me the ticket title/issue and customer or lead before I create it.' };

  const [customer, lead, assignee] = await Promise.all([
    findTicketCustomer(prisma, ispId, request.customerRef),
    request.leadId ? prisma.lead.findFirst({
      where: { id: request.leadId, ispId, isDeleted: false },
      select: { id: true, branchId: true, subBranchId: true, firstName: true, lastName: true, email: true, phoneNumber: true }
    }) : null,
    request.assigneeEmail ? prisma.user.findFirst({
      where: { ispId, email: request.assigneeEmail, isDeleted: false },
      select: { id: true, name: true, email: true, branchId: true, userBranches: { select: { branchId: true } } }
    }) : null
  ]);

  if (request.customerRef && !customer) return { operation, error: `I could not find customer ${request.customerRef} in this ISP.` };
  if (request.leadId && !lead) return { operation, error: `I could not find lead ${request.leadId} in this ISP.` };
  if (request.assigneeEmail && !assignee) return { operation, error: `I could not find active user ${request.assigneeEmail} in this ISP.` };
  if (!customer && !lead) return { operation, error: 'Please include a valid customer ID or lead ID before I create the ticket.' };

  const branchId = customer?.subBranchId || customer?.branchId || lead?.subBranchId || lead?.branchId || user?.selectedBranchId || user?.branchId || null;
  if (assignee && branchId) {
    const assigneeBranches = new Set([assignee.branchId, ...(assignee.userBranches || []).map(item => item.branchId)].filter(Boolean).map(Number));
    if (!assigneeBranches.has(Number(branchId))) return { operation, error: `${assignee.email} does not belong to the ticket branch.` };
  }

  const sla = await prisma.ticketSlaPolicy.findFirst({
    where: { ispId, priority: request.priority, ticketTypeId: null, isActive: true },
    select: { responseHours: true, resolutionHours: true, closeHours: true }
  }).catch(() => null);
  const now = new Date();
  const dueAt = hours => sla && hours != null ? new Date(now.getTime() + Number(hours) * 3600000) : null;
  const ticketNumber = await nextTicketNumber(prisma, ispId);

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      title: request.title,
      description: request.description,
      priority: request.priority,
      category: request.category,
      customerId: customer?.id || null,
      leadId: lead?.id || null,
      assignedToId: assignee?.id || null,
      createdById: user?.id ? Number(user.id) : null,
      ispId,
      branchId,
      responseDueAt: dueAt(sla?.responseHours),
      resolutionDueAt: dueAt(sla?.resolutionHours),
      closeDueAt: dueAt(sla?.closeHours),
      updatedAt: new Date()
    },
    include: {
      customer: { select: { id: true, customerUniqueId: true, lead: { select: { firstName: true, lastName: true, email: true, phoneNumber: true } } } },
      lead: { select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true } },
      assignedTo: { select: { id: true, name: true, email: true } }
    }
  });

  return { operation, performed: ['createTicket'], data: { success: true, ticket } };
}

async function executeOperation({ prisma, ispId, user, message, contextMessage }) {
  const operation = inferOperation(message, contextMessage);
  if (!operation) return null;

  if (operation === 'prepareCreateNasApproval') {
    if (!canAny(user, ['nas_create', 'nas_update'])) return { operation, approvalRequired:true, error:'Your role does not have permission to create a NAS.' };
    const source=String(message||contextMessage||'');
    const ips=[...source.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)].map(match=>match[0]);
    return { operation,performed:['prepareCreateNasApproval'],approvalRequired:true,data:{intent:'CREATE_NAS',nasIp:ips[0]||null,radiusServerIp:ips[1]||null,secretProvided:/\b(?:secret|password|shared secret)\b/i.test(source),pendingConfirmation:true} };
  }
  if(operation==='prepareUpdateNasApproval'){
    if(!canAny(user,['nas_update']))return{operation,approvalRequired:true,error:'Your role does not have permission to update a NAS.'};
    const source=String(message||contextMessage||''),ips=[...source.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)].map(match=>match[0]);
    return{operation,performed:['prepareUpdateNasApproval'],approvalRequired:true,data:{intent:'UPDATE_NAS',nasIp:ips[0]||null,radiusServerIp:ips[1]||null,secretProvided:/\b(?:secret|password|shared secret)\b/i.test(source),pendingConfirmation:true}};
  }

  if (operation === 'createTicket') return createTicketOperation(prisma, ispId, user, message);
  if (operation === 'getServiceSummary' || operation === 'listServices' || operation === 'listActiveServices') return getServiceOperation(prisma, ispId, user, operation);
  if (operation === 'getInvoiceSummary' || operation === 'listInvoices') return getInvoiceOperation(prisma, ispId, user, operation);

  if (operation === 'getCustomerDetail' || operation === 'diagnoseCustomerInternet') {
    if (!canAny(user, ['customer_read', 'dashboard_view'])) return { operation, approvalRequired: true, error: 'Your role cannot read customer details.' };
    const ref = customerRefFrom(message) || customerRefFrom(contextMessage);
    const resolvedDevices = await resolveCustomerDevices(prisma, ispId, ref);
    const customer = resolvedDevices.customer;
    if (!customer) return { operation, performed: ['getCustomer'], data: { found: false, customerRef: ref, reason: ref ? 'Customer not found.' : 'Please provide the customer ID.' } };
    const tr069Devices = resolvedDevices.tr069Devices;
    const fullName = [customer.lead?.firstName, customer.lead?.middleName, customer.lead?.lastName].filter(Boolean).join(' ');
    const diagnostic = operation === 'diagnoseCustomerInternet' ? {
      accountActive: String(customer.status || '').toLowerCase() === 'active',
      radiusActive: customer.connectionUsers.some(item => item.isActive),
      tr069Online: tr069Devices.some(item => String(item.status).toLowerCase() === 'online'),
      oltOnline: ['active', 'online', 'up'].includes(String(customer.olt?.status || '').toLowerCase()),
      splitterOnline: !customer.splitter || ['active', 'online', 'up'].includes(String(customer.splitter.status || '').toLowerCase()),
      recommendation: 'Run Radius session, signal, bandwidth, and CPE diagnostics; create a NOC ticket if any check fails.'
    } : null;
    return { operation, performed: ['getCustomer', ...(diagnostic ? ['getCustomerServices', 'getTR069DeviceDetails', 'getOLTStatus', 'getSplitterDetails'] : [])], data: { found: true, customer: { ...customer, fullName }, tr069Devices, diagnostic } };
  }

  if (operation === 'getTr069WifiDetails') {
    if (!canAny(user, ['services_read', 'services_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot read TR-069 Wi-Fi details.' };
    const lookup = await resolveLinkedTr069Lookup(prisma, ispId, message, contextMessage);
    if (!lookup) return { operation, performed: ['getTR069WifiDetails'], data: { found: false, reason: 'No device serial number was found in the active conversation.' } };
    const serial = String(lookup.serial || '').trim();
    const device = lookup.device || await prisma.tr069Device.findFirst({ where: lookup.id ? { id: lookup.id, ispId, isDeleted: false } : { ispId, isDeleted: false, OR: [{ serialNumber: serial }, { serialNumber: { contains: serial } }] }, select: { id: true, serialNumber: true, modelName: true, status: true, lastContact: true, leadId: true } });
    if (!device) return { operation, performed: ['getTR069WifiDetails'], data: { found: false, serialNumber: serial } };
    const customer = await prisma.customer.findFirst({ where: { ispId, isDeleted: false, ...(device.leadId ? { leadId: device.leadId } : {}) }, select: { id: true, customerUniqueId: true } }).catch(() => null);
    const wifi = customer ? await prisma.customerWiFiCredential.findMany({ where: { customerId: customer.id, serialNumber: device.serialNumber }, select: { ssidIndex: true, instance: true, ssidName: true, password: true, source: true, lastSyncedAt: true }, orderBy: { ssidIndex: 'asc' } }).catch(() => []) : [];
    return { operation, performed: ['getTR069WifiDetails'], data: { found: true, device, customer, wifi: wifi.map(item => ({ ...item, passwordConfigured: Boolean(item.password), password: undefined })) } };
  }

  if (operation === 'updateTr069WifiSsid') {
    if (!canAny(user, ['services_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot update TR-069 Wi-Fi settings.' };
    const request = extractWifiSsidUpdate(message, contextMessage);
    if (!request?.lookup) return { operation, performed: ['updateTR069WifiSSID'], error: 'Please include the TR-069 device serial number before I update the Wi-Fi name.' };
    if (!request?.ssidName) return { operation, performed: ['updateTR069WifiSSID'], error: 'Please include the new Wi-Fi name.' };

    const serial = request.lookup.serial ? String(request.lookup.serial).trim() : '';
    const serialVariants = serial ? [...new Set([serial, serial.toUpperCase(), serial.toLowerCase()])] : [];
    const device = request.lookup.device || await prisma.tr069Device.findFirst({
      where: request.lookup.id
        ? { ispId, isDeleted: false, id: request.lookup.id }
        : {
            ispId,
            isDeleted: false,
            OR: [
              ...serialVariants.map(value => ({ serialNumber: value })),
              ...serialVariants.map(value => ({ macAddress: value })),
              ...serialVariants.map(value => ({ serialNumber: { contains: value } }))
            ]
          },
      select: { id: true, serialNumber: true, manufacturer: true, modelName: true, ipAddress: true, status: true, leadId: true }
    });
    if (!device) return { operation, performed: ['updateTR069WifiSSID'], error: `I could not find TR-069 device ${serial || request.lookup.id}.` };

    try {
      const client = await ServiceFactory.getClient(SERVICE_CODES.GENIEACS, ispId, prisma);
      const task = await client.updateSpecificSSID(device.serialNumber, Number(request.ssidIndex || 1), null, request.ssidName);

      const customer = await prisma.customer.findFirst({
        where: {
          ispId,
          isDeleted: false,
          OR: [
            { devices: { some: { serialNumber: device.serialNumber } } },
            { devices: { some: { ponSerial: device.serialNumber } } },
            ...(device.leadId ? [{ leadId: device.leadId }] : [])
          ]
        },
        select: { id: true, ispId: true }
      }).catch(() => null);
      if (customer) {
        await prisma.customerWiFiCredential.upsert({
          where: {
            customerId_serialNumber_ssidIndex: {
              customerId: customer.id,
              serialNumber: device.serialNumber,
              ssidIndex: Number(request.ssidIndex || 1)
            }
          },
          update: {
            ssidName: request.ssidName,
            ispId: customer.ispId,
            source: 'ai-agent',
            lastSyncedAt: new Date()
          },
          create: {
            customerId: customer.id,
            ispId: customer.ispId,
            serialNumber: device.serialNumber,
            ssidIndex: Number(request.ssidIndex || 1),
            ssidName: request.ssidName,
            password: null,
            source: 'ai-agent',
            lastSyncedAt: new Date()
          }
        }).catch(() => null);
      }

      return {
        operation,
        performed: ['updateTR069WifiSSID'],
        data: {
          success: true,
          serialNumber: device.serialNumber,
          ssidIndex: Number(request.ssidIndex || 1),
          oldSsidName: request.oldName,
          ssidName: request.ssidName,
          device,
          task,
          customerId: customer?.id || null
        }
      };
    } catch (error) {
      return {
        operation,
        performed: ['updateTR069WifiSSID'],
        error: `Failed to update Wi-Fi name for ${device.serialNumber}: ${error.message}`,
        data: {
          success: false,
          serialNumber: device.serialNumber,
          ssidIndex: Number(request.ssidIndex || 1),
          oldSsidName: request.oldName,
          ssidName: request.ssidName
        }
      };
    }
  }

  if (operation === 'getTr069DeviceDetail') {
    if (!canAny(user, ['services_read', 'services_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot read TR-069 device details.' };
    const lookup = await resolveLinkedTr069Lookup(prisma, ispId, message, contextMessage);
    if (!lookup) return { operation, performed: ['getTR069DeviceDetails'], data: { found: false, reason: 'No TR-069 serial number or device ID was detected.' } };

    const serial = lookup.serial ? String(lookup.serial).trim() : '';
    const serialVariants = serial ? [...new Set([serial, serial.toUpperCase(), serial.toLowerCase()])] : [];
    const where = lookup.id
      ? { ispId, isDeleted: false, id: lookup.id }
      : {
          ispId,
          isDeleted: false,
          OR: [
            ...serialVariants.map(value => ({ serialNumber: value })),
            ...serialVariants.map(value => ({ macAddress: value })),
            ...serialVariants.map(value => ({ serialNumber: { contains: value } }))
          ]
        };
    const device = lookup.device || await prisma.tr069Device.findFirst({
      where,
      select: {
        id: true,
        serialNumber: true,
        oui: true,
        productClass: true,
        manufacturer: true,
        modelName: true,
        ipAddress: true,
        status: true,
        lastContact: true,
        firmwareVersion: true,
        macAddress: true,
        notes: true,
        leadId: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });
    if (!device) return { operation, performed: ['getTR069DeviceDetails'], data: { found: false, lookup } };
    const [lead, customer] = await Promise.all([
      device.leadId ? prisma.lead.findFirst({
        where: { id: device.leadId, ispId, isDeleted: false },
        select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true, status: true }
      }) : null,
      prisma.customer.findFirst({
        where: {
          ispId,
          isDeleted: false,
          OR: [
            { devices: { some: { OR: [{ serialNumber: device.serialNumber }, { ponSerial: device.serialNumber }] } } },
            ...(device.leadId ? [{ leadId: device.leadId }] : [])
          ]
        },
        select: { id: true, customerUniqueId: true, status: true, lead: { select: { firstName: true, middleName: true, lastName: true, email: true, phoneNumber: true } } }
      }).catch(() => null)
    ]);
    const notes = parseDeviceNotes(device.notes);
    const { notes: _notes, ...safeDevice } = device;
    return {
      operation,
      performed: ['getTR069DeviceDetails'],
      data: {
        found: true,
        lookup,
        device: { ...safeDevice, username: notes.username || null },
        lead,
        customer: customer ? {
          id: customer.id,
          customerUniqueId: customer.customerUniqueId,
          status: customer.status,
          fullName: [customer.lead?.firstName, customer.lead?.middleName, customer.lead?.lastName].filter(Boolean).join(' ') || null,
          email: customer.lead?.email || null,
          phoneNumber: customer.lead?.phoneNumber || null
        } : null
      }
    };
  }

  if (operation === 'listTr069Devices' || operation === 'listTr069OnlineDevices') {
    if (!canAny(user, ['services_read', 'services_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot read TR-069 devices.' };
    const explicitLimit = Number(String(message || '').match(/\b(\d{1,2})\b/)?.[1] || 10);
    const take = Math.max(1, Math.min(explicitLimit, 25));
    const statusFilter = operation === 'listTr069OnlineDevices' ? { status: 'online' } : {};
    const [total, online, offline, devices] = await Promise.all([
      prisma.tr069Device.count({ where: { ispId, isDeleted: false } }),
      prisma.tr069Device.count({ where: { ispId, isDeleted: false, status: 'online' } }),
      prisma.tr069Device.count({ where: { ispId, isDeleted: false, status: 'offline' } }),
      prisma.tr069Device.findMany({
        where: { ispId, isDeleted: false, ...statusFilter },
        select: { id: true, serialNumber: true, manufacturer: true, modelName: true, ipAddress: true, status: true, lastContact: true, firmwareVersion: true, macAddress: true, leadId: true },
        orderBy: [{ lastContact: 'desc' }, { updatedAt: 'desc' }],
        take
      })
    ]);
    return { operation, performed: ['listTR069Devices'], data: { total, online, offline, returned: devices.length, devices } };
  }

  if (operation === 'getTr069Summary') {
    if (!canAny(user, ['services_read', 'services_manage'])) return { operation, approvalRequired: true, error: 'Your role cannot read TR-069 devices.' };
    const [total, online, offline] = await Promise.all([
      prisma.tr069Device.count({ where: { ispId, isDeleted: false } }),
      prisma.tr069Device.count({ where: { ispId, isDeleted: false, status: 'online' } }),
      prisma.tr069Device.count({ where: { ispId, isDeleted: false, status: 'offline' } })
    ]);
    return { operation, performed: ['getTR069DeviceStatus'], data: { total, online, offline } };
  }

  if (operation === 'getNasSummary') {
    if (!canAny(user, ['nas_read', 'nas_update'])) return { operation, approvalRequired: true, error: 'Your role cannot read NAS devices.' };
    const requestedIp=String(message||'').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0]||null;
    if(requestedIp){
      const device=await prisma.nas.findFirst({where:{ispId,isDeleted:false,nasname:requestedIp}});
      return{operation,performed:['getNasSummary'],data:{found:Boolean(device),requestedIp,device:device?safeNas(device):null}};
    }
    const devices = await prisma.nas.findMany({ where: { ispId, isDeleted: false } });
    return {
      operation,
      performed: ['getNasSummary'],
      data: {
        total: devices.length,
        online: devices.filter(item => String(item.status).toLowerCase() === 'online').length,
        offline: devices.filter(item => String(item.status).toLowerCase() === 'offline').length,
        devices: devices.slice(0, 25).map(safeNas)
      }
    };
  }

  if (operation === 'getOltSummary') {
    if (!canAny(user, ['olt_read', 'services_read'])) return { operation, approvalRequired: true, error: 'Your role cannot read OLT status.' };
    const devices = await prisma.oLT.findMany({
      where: { ispId, isDeleted: false },
      select: { id: true, name: true, ipAddress: true, vendor: true, model: true, status: true, lastSeen: true, totalPorts: true, usedPorts: true, activeSubscribers: true, totalSubscribers: true },
      orderBy: { name: 'asc' },
      take: 25
    });
    return {
      operation,
      performed: ['getOLTStatus'],
      data: {
        total: devices.length,
        online: devices.filter(item => ['online', 'active', 'up'].includes(String(item.status).toLowerCase())).length,
        offline: devices.filter(item => ['offline', 'inactive', 'down'].includes(String(item.status).toLowerCase())).length,
        devices
      }
    };
  }

  if (operation === 'getSplitterSummary') {
    if (!canAny(user, ['splitter_read', 'olt_read', 'services_read'])) return { operation, approvalRequired: true, error: 'Your role cannot read splitter details.' };
    const devices = await prisma.splitter.findMany({
      where: { ispId, isDeleted: false },
      select: { id: true, splitterId: true, name: true, status: true, isActive: true, splitRatio: true, portCount: true, usedPorts: true, availablePorts: true, oltId: true, location: true },
      orderBy: { name: 'asc' },
      take: 25
    });
    return {
      operation,
      performed: ['getSplitterDetails'],
      data: {
        total: devices.length,
        active: devices.filter(item => item.isActive || ['online', 'active'].includes(String(item.status).toLowerCase())).length,
        inactive: devices.filter(item => item.isActive === false || ['offline', 'inactive'].includes(String(item.status).toLowerCase())).length,
        devices
      }
    };
  }

  if (operation === 'getTicketSummary' || operation === 'listTickets' || operation === 'listOpenTickets') {
    if (!canAny(user, ['tickets_read', 'tickets_manage', 'tickets_read_self'])) return { operation, approvalRequired: true, error: 'Your role cannot read tickets.' };
    const requestedPriorities = ['CRITICAL','HIGH','MEDIUM','LOW'].filter(priority => new RegExp(`\\b${priority}\\b`,'i').test(message));
    const assignedOnly = /\bassigned\b/i.test(message) && !/\bunassigned\b/i.test(message);
    const selfOnly = allowed(user,'tickets_read_self') && !canAny(user,['tickets_read','tickets_manage']);
    const activeCustomerRef=customerRefFrom(message)||customerRefFrom(contextMessage);
    const activeCustomer=activeCustomerRef?await findTicketCustomer(prisma,ispId,activeCustomerRef):null;
    const baseWhere = { ispId, isDeleted: false, ...(activeCustomer?{customerId:activeCustomer.id}:{}), ...(requestedPriorities.length?{priority:{in:requestedPriorities}}:{}), ...(assignedOnly?{assignedToId:{not:null}}:{}), ...(selfOnly?{assignedToId:user.id}:{}) };
    const [total, open, inProgress, closed] = await Promise.all([
      prisma.ticket.count({ where: baseWhere }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'OPEN' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: 'IN_PROGRESS' } }),
      prisma.ticket.count({ where: { ...baseWhere, status: { in: ['CLOSED', 'RESOLVED'] } } })
    ]);
    let tickets = [];
    if (operation === 'listTickets' || operation === 'listOpenTickets') {
      tickets = await prisma.ticket.findMany({
        where: {
          ...baseWhere,
          ...(operation === 'listOpenTickets' ? { status: 'OPEN' } : {})
        },
        select: {
          id: true,
          ticketNumber: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          category: true,
          contactName: true,
          contactPhone: true,
          contactEmail: true,
          createdAt: true,
          updatedAt: true,
          responseDueAt: true,
          resolutionDueAt: true,
          customer: { select: { id: true, customerUniqueId: true, lead: { select: { firstName: true, lastName: true, phoneNumber: true, email: true } } } },
          assignedTo: { select: { id: true, name: true, email: true } }
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 25
      });
    }
    return { operation, performed: ['getTicketSummary'], data: { total, open, inProgress, closed, tickets, customerRef:activeCustomer?.customerUniqueId||activeCustomerRef||null, filters:{priorities:requestedPriorities,assignedOnly,selfOnly} } };
  }

  if (operation === 'getLeadSummary') {
    if (!canAny(user, ['lead_read', 'leads_read', 'dashboard_view'])) return { operation, approvalRequired: true, error: 'Your role cannot read lead summary.' };
    const [total, newLeads, contacted, qualified, unqualified, converted] = await Promise.all([
      prisma.lead.count({ where: { ispId, isDeleted: false } }),
      prisma.lead.count({ where: { ispId, isDeleted: false, status: 'new' } }),
      prisma.lead.count({ where: { ispId, isDeleted: false, status: 'contacted' } }),
      prisma.lead.count({ where: { ispId, isDeleted: false, status: 'qualified' } }),
      prisma.lead.count({ where: { ispId, isDeleted: false, status: 'unqualified' } }),
      prisma.lead.count({ where: { ispId, isDeleted: false, status: 'converted' } })
    ]);
    return { operation, performed: ['getLeadSummary'], data: { total, newLeads, contacted, qualified, unqualified, converted } };
  }

  if (operation === 'getCustomerSummary') {
    if (!canAny(user, ['customer_read', 'dashboard_view'])) return { operation, approvalRequired: true, error: 'Your role cannot read customer summary.' };
    const [total, active, inactive] = await Promise.all([
      prisma.customer.count({ where: { ispId, isDeleted: false } }),
      prisma.customer.count({ where: { ispId, isDeleted: false, status: 'active' } }),
      prisma.customer.count({ where: { ispId, isDeleted: false, status: { not: 'active' } } })
    ]);
    return { operation, performed: ['getCustomerSummary'], data: { total, active, inactive } };
  }

  if (operation === 'listCustomers') {
    if (!canAny(user, ['customer_read', 'dashboard_view'])) return { operation, approvalRequired: true, error: 'Your role cannot read customers.' };
    const [total, customers] = await Promise.all([
      prisma.customer.count({ where: { ispId, isDeleted: false } }),
      prisma.customer.findMany({
        where: { ispId, isDeleted: false },
        select: {
          id: true, customerUniqueId: true, status: true, createdAt: true,
          lead: { select: { firstName: true, middleName: true, lastName: true, phoneNumber: true, email: true } },
          branch: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 25
      })
    ]);
    return { operation, performed: ['searchCustomers'], data: { total, customers: customers.map(customer => ({ ...customer, fullName: [customer.lead?.firstName,customer.lead?.middleName,customer.lead?.lastName].filter(Boolean).join(' ') })) } };
  }

  if (operation === 'syncTr069') {
    if (!allowed(user, 'services_manage')) return { operation, approvalRequired: true, error: 'Your role cannot synchronize TR-069 devices.' };
    const sync = await invoke(syncDevices, { prisma, ispId, branchId: user?.selectedBranchId || user?.branchId || null, selectedBranchId: user?.selectedBranchId || null, user, headers: {}, query: {}, params: {}, body: {} });
    const check = await executeOperation({ prisma, ispId, user, message: 'tr069 status' });
    return { operation, performed: ['syncTR069Devices', ...(check?.performed || [])], data: { sync, verification: check?.data || {} } };
  }

  if (operation === 'resyncNas') {
    if (!allowed(user, 'nas_update')) return { operation, approvalRequired: true, error: 'Your role cannot resynchronize NAS devices.' };
    const sync = await invoke(nasController.resyncNas, { prisma, ispId, branchId: user?.selectedBranchId || user?.branchId || null, selectedBranchId: user?.selectedBranchId || null, user, headers: {}, query: {}, params: {}, body: {} });
    const check = await executeOperation({ prisma, ispId, user, message: 'nas status' });
    return { operation, performed: ['resyncNas', ...(check?.performed || [])], data: { sync, verification: check?.data || {} } };
  }

  return null;
}

module.exports = { inferOperation, executeOperation, resolveCustomerDevices,resolveCustomerTr069Devices };
