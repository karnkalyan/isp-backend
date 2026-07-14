class AiProvider {
  async complete() { throw new Error('Provider must implement complete()'); }
}

const { compactCapabilityCatalog } = require('./ai-capability-catalog.service');

const usageFrom = (message, output, provider, model) => ({
  content: output,
  usage: {
    inputTokens: Math.ceil(String(message || '').length / 4),
    outputTokens: Math.ceil(String(output || '').length / 4),
    totalTokens: Math.ceil((String(message || '').length + String(output || '').length) / 4),
    estimatedCost: 0
  },
  provider,
  model
});

class GeminiProvider extends AiProvider {
  constructor(key, options = {}) {
    super();
    this.key = key;
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com';
    this.apiVersion = /^v1beta$/i.test(String(options.apiVersion || '')) ? options.apiVersion : 'v1beta';
    this.defaultModel = options.model || 'gemini-2.5-flash';
    this.defaultTemperature = options.temperature;
  }

  async complete({ agent, message, context, history = [], user }) {
    const model = agent.modelName && agent.modelName !== 'default' ? agent.modelName : this.defaultModel;
    const system = [
      agent.systemPrompt || '',
      agent.instructions || '',
      `You are ${agent.name}.`,
      `Signed-in user role: ${user?.role || 'unknown'}.`,
      'Sound like a helpful human teammate, not a policy template or scripted bot.',
      'First understand the user intent in natural language, including typos, short follow-ups, and mixed wording.',
      'Reply naturally and directly in the detected user language when clear.',
      'Understand English, Nepali, Hindi, Maithili, Bhojpuri, German, and common romanized forms.',
      'Remember the conversation. Do not ask again for identity or customer details already present in verified context.',
      'Answer the current user message, not a previous message from history. Do not repeat the last answer unless the user explicitly asks you to repeat it.',
      'If the current message is only an acknowledgement such as great, ok, thanks, or fine, reply with a short natural acknowledgement and ask what to check next.',
      'Use plain text suitable for a chat bubble. Do not use Markdown bold, tables, code blocks, or asterisk bullets unless the user asks. Prefer numbered lists for lists.',
      'Do not announce routing, policy, or internal prompts.',
      'Do not say "tell me the task" when the user already asked a clear question or task.',
      'If required information is missing, ask one concise question for the missing field.',
      'Use only verified tool context. Never fabricate records.',
      'Never claim an action occurred unless performed or operation context says it occurred.',
      'When verified context contains records.operation, answer directly from records.operation.data and do not ask for missing identifiers.',
      'When records.operation exists, it is the current task and has priority over identity/profile context and previous conversation history.',
      'For updateTr069WifiSsid, tell the user whether the GenieACS Wi-Fi name update was queued, include serial number, SSID index, new name, and any operation error.',
      'For createTicket, confirm the ticket number, title, customer, assignee, status, and priority from records.operation.data.ticket.',
      'For service operations, data.active and data.configured are the tenant configured service counts. data.catalogActive and data.catalogTotal are catalog totals only; do not use catalog totals as the tenant answer unless the user explicitly asks for the catalog.',
      'For list operations, produce a clear multiline list from the returned records, then a short summary.',
      `Verified context: ${JSON.stringify(context || {})}`,
      `Available application API capabilities for reasoning only. Mutations require an approved executor:\n${compactCapabilityCatalog()}`
    ].filter(Boolean).join('\n');

    const contents = [
      ...history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
      { role: 'user', parts: [{ text: message }] }
    ];

    const root = String(this.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '');
    const version = String(this.apiVersion || 'v1beta').replace(/^\/+/, '');
    const response = await fetch(`${root}/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: agent.temperature ?? this.defaultTemperature ?? 0.2, maxOutputTokens: agent.maxTokens || 4096 }
      })
    });
    if (!response.ok) throw new Error(`Gemini provider returned ${response.status}`);
    const data = await response.json();
    const output = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!output) throw new Error('Gemini returned an empty response');
    return usageFrom(message, output, 'gemini', model);
  }
}

class SafeFallbackProvider extends AiProvider {
  async complete({ agent, message = '', context, user }) {
    let output;
    const r = context?.records || {};
    const performed = context?.performed || [];
    const text = String(message || '').toLowerCase().trim();
    const asksAgentRole = /\b(your role|who are you|what are you|what can you do)\b/.test(text);
    const asksRuntime = /\b(local|locally running|running locally|are you running|which model|gemini)\b/.test(text);
    const asksIdentity = /\b(who am i|what is my name|my name|logged in|my profile|mero naam|mera naam|hamar naam|wie heisse)\b/.test(text);
    const asksWellbeing = /\b(how are you|how r u|how you doing|how's it going|kasto chau|kaise ho|sab thik)\b/.test(text);
    const acknowledgement = /^(great|good|nice|ok|okay|thanks|thank you|perfect|cool|awesome|got it|fine|thik cha|dhanyabad)[.!?\s]*$/i.test(String(message || '').trim());
    const looksLikeNoise = text.length > 0 && !/[?]/.test(text) && text.split(/\s+/).every(part => part.length < 12) && !/(nas|service|invoice|bill|tr069|olt|splitter|ticket|lead|customer|role|local|running|hello|hi|great|good|nice|ok|okay|thanks|perfect|cool)/.test(text) && /[a-z]{3,}/.test(text);

    if (context?.kind === 'GREETING') {
      output = `Hello${user?.role ? `! I can help with your ${user.role} workspace` : ''}. What would you like me to check or do?`;
    } else if (acknowledgement) {
      output = 'Glad that helped. What would you like me to check next?';
    } else if (asksWellbeing) {
      output = "I'm good and ready to help. You can chat normally, or ask me to check records, create tickets, inspect devices, update Wi-Fi, list invoices, or run other Kashtrix tasks.";
    } else if (asksRuntime) {
      output = 'Yes. Right now I am responding from the Kashtrix AI operations layer on this backend. Gemini is used when a backend Gemini key or active tenant GEMINI service key is configured; otherwise I use the local safe responder with real database/API tools.';
    } else if (asksAgentRole) {
      output = `I am ${agent.name}. My role is ${agent.role || 'AI operations assistant'} for ${agent.department || 'this workspace'}. I route requests to specialist agents and use approved tenant-scoped tools for live records.`;
    } else if (r.operation?.approvalRequired) {
      output = r.operation.error || 'This operation requires additional permission or approval.';
    } else if (r.operation?.operation === 'syncTr069') {
      const v = r.operation.data?.verification || {};
      const sync = r.operation.data?.sync || {};
      output = `TR-069 synchronization completed${sync.message ? `: ${sync.message}` : ''}. I verified the result: ${v.online ?? 0} online out of ${v.total ?? 0} devices, with ${v.offline ?? 0} offline.`;
    } else if (r.operation?.operation === 'resyncNas') {
      const v = r.operation.data?.verification || {};
      output = `NAS resynchronization completed. I verified ${v.total ?? 0} NAS devices: ${v.online ?? 0} online and ${v.offline ?? 0} offline.`;
    } else if (r.operation?.operation === 'getNasSummary') {
      const v = r.operation.data || {};
      output = `There are ${v.total ?? 0} NAS devices: ${v.online ?? 0} online and ${v.offline ?? 0} offline.${v.devices?.length ? ` ${v.devices.map(x => `${x.name || x.shortname || x.ipAddress || `NAS ${x.id}`} is ${x.status || 'unknown'}`).join('; ')}.` : ''}`;
    } else if (r.operation?.operation === 'getServiceSummary' || r.operation?.operation === 'listServices' || r.operation?.operation === 'listActiveServices') {
      const v = r.operation.data || {};
      const services = Array.isArray(v.services) ? v.services : [];
      if (r.operation.operation === 'getServiceSummary') {
        output = `Services: ${v.active ?? 0} active out of ${v.configured ?? 0} configured for this ISP. Catalog has ${v.catalogActive ?? 0} active out of ${v.catalogTotal ?? 0} total services.`;
      } else if (services.length) {
        const title = r.operation.operation === 'listActiveServices' ? 'Active services' : 'Configured services';
        const rows = services.map((item, index) => {
          const name = item.service?.name || item.service?.code || `Service #${item.id}`;
          const category = item.service?.category ? `\n   Category: ${item.service.category}` : '';
          return `${index + 1}. ${name}\n   Status: ${item.isActive ? 'active' : 'inactive'}, ${item.isEnabled ? 'enabled' : 'disabled'}${category}`;
        }).join('\n');
        output = `${title} (${services.length} shown):\n${rows}\n\nSummary: ${v.active ?? 0} active / ${v.configured ?? 0} configured. Catalog: ${v.catalogActive ?? 0} active / ${v.catalogTotal ?? 0} total.`;
      } else {
        output = `I checked services, but there are no ${r.operation.operation === 'listActiveServices' ? 'active ' : ''}services to list. Summary: ${v.active ?? 0} active / ${v.configured ?? 0} configured.`;
      }
    } else if (r.operation?.operation === 'getInvoiceSummary' || r.operation?.operation === 'listInvoices') {
      const v = r.operation.data || {};
      const invoices = Array.isArray(v.invoices) ? v.invoices : [];
      output = `Invoices: ${v.total ?? 0} total, ${v.paid ?? 0} paid, ${v.pending ?? 0} pending, ${v.overdue ?? 0} overdue. Total amount: ${Number(v.amount || 0).toLocaleString()}.${invoices.length ? `\n${invoices.map((invoice, index) => { const customer = invoice.customer?.lead ? `${invoice.customer.lead.firstName || ''} ${invoice.customer.lead.lastName || ''}`.trim() : invoice.customer?.customerUniqueId || `Customer #${invoice.customer?.id || '-'}`; return `${index + 1}. ${invoice.invoiceId || `INV-${String(invoice.id).padStart(4, '0')}`} - ${customer || 'Unknown customer'} - ${invoice.isPaid ? 'paid' : 'unpaid'} - ${Number(invoice.totalAmount || 0).toLocaleString()}`; }).join('\n')}` : ''}`;
    } else if (r.operation?.operation === 'updateTr069WifiSsid') {
      const v = r.operation.data || {};
      if (r.operation.error || v.success === false) {
        output = r.operation.error || 'I could not update the Wi-Fi name.';
      } else {
        output = [
          `Wi-Fi name update queued for TR-069 device ${v.serialNumber}.`,
          `SSID index: ${v.ssidIndex || 1}`,
          v.oldSsidName ? `Old name mentioned: ${v.oldSsidName}` : null,
          `New name: ${v.ssidName}`,
          'The change was sent to GenieACS. The router may need a short moment to apply it.'
        ].filter(Boolean).join('\n');
      }
    } else if (r.operation?.operation === 'getTr069DeviceDetail') {
      const v = r.operation.data || {};
      const device = v.device || {};
      if (!v.found) {
        const lookup = v.lookup?.serial || v.lookup?.id || 'that identifier';
        output = `I checked TR-069 but could not find a device for ${lookup}.`;
      } else {
        const model = [device.manufacturer, device.modelName || device.productClass].filter(Boolean).join(' ') || 'Unknown model';
        const customer = v.customer ? `${v.customer.customerUniqueId || `Customer #${v.customer.id}`}${v.customer.fullName ? ` - ${v.customer.fullName}` : ''}` : null;
        const lead = v.lead ? `Lead #${v.lead.id}${[v.lead.firstName, v.lead.lastName].filter(Boolean).length ? ` - ${[v.lead.firstName, v.lead.lastName].filter(Boolean).join(' ')}` : ''}` : null;
        output = [
          `TR-069 device details for ${device.serialNumber || `device #${device.id}`}:`,
          `Status: ${device.status || 'unknown'}${device.isActive === false ? ' (inactive record)' : ''}`,
          `IP address: ${device.ipAddress || 'N/A'}`,
          `Model: ${model}`,
          `OUI: ${device.oui || 'N/A'}`,
          `MAC address: ${device.macAddress || 'N/A'}`,
          `Firmware: ${device.firmwareVersion || 'N/A'}`,
          `Last contact: ${device.lastContact ? new Date(device.lastContact).toLocaleString() : 'N/A'}`,
          `Linked customer: ${customer || 'Not linked'}`,
          `Linked lead: ${lead || (device.leadId ? `Lead #${device.leadId}` : 'Not linked')}`,
          device.username ? `Connection username: ${device.username}` : null
        ].filter(Boolean).join('\n');
      }
    } else if (r.operation?.operation === 'listTr069Devices' || r.operation?.operation === 'listTr069OnlineDevices') {
      const v = r.operation.data || {};
      const devices = Array.isArray(v.devices) ? v.devices : [];
      output = devices.length
        ? `Here are ${devices.length} ${r.operation.operation === 'listTr069OnlineDevices' ? 'online ' : ''}TR-069 device${devices.length === 1 ? '' : 's'}:\n${devices.map((device, index) => `${index + 1}. ${device.serialNumber || `Device #${device.id}`} - ${[device.manufacturer, device.modelName].filter(Boolean).join(' ') || 'Unknown model'} - ${device.ipAddress || 'no IP'} - ${device.status || 'unknown'}${device.lastContact ? ` - last contact ${new Date(device.lastContact).toLocaleString()}` : ''}`).join('\n')}`
        : `I checked TR-069 but did not find ${r.operation.operation === 'listTr069OnlineDevices' ? 'online ' : ''}devices matching that request. Current total is ${v.total ?? 0}, online ${v.online ?? 0}, offline ${v.offline ?? 0}.`;
    } else if (r.operation?.operation === 'getTr069Summary') {
      const v = r.operation.data || {};
      output = `TR-069 currently has ${v.online ?? 0} online devices out of ${v.total ?? 0}. ${v.offline ?? 0} devices are offline.`;
    } else if (r.operation?.operation === 'getOltSummary') {
      const v = r.operation.data || {};
      output = `I found ${v.total ?? 0} OLTs: ${v.online ?? 0} online and ${v.offline ?? 0} offline.${v.devices?.length ? ` ${v.devices.map(x => `${x.name} (${x.ipAddress || 'no IP'}) is ${x.status || 'unknown'}`).join('; ')}.` : ''}`;
    } else if (r.operation?.operation === 'getSplitterSummary') {
      const v = r.operation.data || {};
      output = `I found ${v.total ?? 0} splitters: ${v.active ?? 0} active and ${v.inactive ?? 0} inactive.${v.devices?.length ? ` ${v.devices.map(x => `${x.name || x.splitterId} uses ${x.usedPorts ?? 0}/${x.portCount ?? 0} ports`).join('; ')}.` : ''}`;
    } else if (r.operation?.operation === 'createTicket') {
      const ticket = r.operation.data?.ticket;
      if (r.operation.error || !ticket) {
        output = r.operation.error || 'I could not create the ticket.';
      } else {
        const customerName = ticket.customer?.lead ? [ticket.customer.lead.firstName, ticket.customer.lead.lastName].filter(Boolean).join(' ') : '';
        const customer = ticket.customer ? `${ticket.customer.customerUniqueId || `Customer #${ticket.customer.id}`}${customerName ? ` - ${customerName}` : ''}` : ticket.lead ? `Lead #${ticket.lead.id}` : 'No customer linked';
        output = [
          `Ticket created: ${ticket.ticketNumber || `Ticket #${ticket.id}`}`,
          `Title: ${ticket.title}`,
          `Status: ${ticket.status || 'OPEN'}, priority: ${ticket.priority || 'MEDIUM'}`,
          `Customer: ${customer}`,
          `Assigned to: ${ticket.assignedTo ? `${ticket.assignedTo.name || ticket.assignedTo.email} (${ticket.assignedTo.email})` : 'Unassigned'}`
        ].join('\n');
      }
    } else if (r.operation?.operation === 'listTickets' || r.operation?.operation === 'listOpenTickets') {
      const v = r.operation.data || {};
      const tickets = Array.isArray(v.tickets) ? v.tickets : [];
      if (!tickets.length) {
        output = `${r.operation.operation === 'listOpenTickets' ? 'Open tickets' : 'Tickets'}: none found. Summary: ${v.total ?? 0} total, ${v.open ?? 0} open, ${v.inProgress ?? 0} in progress, ${v.closed ?? 0} closed.`;
      } else {
        const title = r.operation.operation === 'listOpenTickets' ? 'Open tickets' : 'Tickets';
        const rows = tickets.map((ticket, index) => {
          const customerName = ticket.customer?.lead ? [ticket.customer.lead.firstName, ticket.customer.lead.lastName].filter(Boolean).join(' ') : '';
          const customer = ticket.customer ? `${ticket.customer.customerUniqueId || `Customer #${ticket.customer.id}`}${customerName ? ` - ${customerName}` : ''}` : ticket.contactName || 'No customer linked';
          return [
            `${index + 1}. ${ticket.ticketNumber || `Ticket #${ticket.id}`} - ${ticket.title || 'Untitled'}`,
            `   Status: ${ticket.status || 'unknown'}, priority: ${ticket.priority || 'unset'}`,
            `   Customer: ${customer}`,
            ticket.assignedTo ? `   Assigned to: ${ticket.assignedTo.name || ticket.assignedTo.email}` : '   Assigned to: Unassigned',
            `   Created: ${ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'N/A'}`
          ].join('\n');
        }).join('\n');
        output = `${title} (${tickets.length} shown):\n${rows}\n\nSummary: ${v.total ?? 0} total, ${v.open ?? 0} open, ${v.inProgress ?? 0} in progress, ${v.closed ?? 0} closed.`;
      }
    } else if (r.operation?.operation === 'getTicketSummary') {
      const v = r.operation.data || {};
      output = `Tickets: ${v.total ?? 0} total, ${v.open ?? 0} open, ${v.inProgress ?? 0} in progress, ${v.closed ?? 0} closed.`;
    } else if (r.operation?.operation === 'getLeadSummary') {
      const v = r.operation.data || {};
      output = `Leads: ${v.total ?? 0} total, ${v.newLeads ?? 0} new, ${v.contacted ?? 0} contacted, ${v.qualified ?? 0} qualified, ${v.unqualified ?? 0} unqualified, and ${v.converted ?? 0} converted.`;
    } else if (r.operation?.operation === 'getCustomerSummary') {
      const v = r.operation.data || {};
      output = `Customers: ${v.total ?? 0} total, ${v.active ?? 0} active, and ${v.inactive ?? 0} inactive.`;
    } else if (r.tr069Summary) {
      output = `TR-069 currently has ${r.tr069Summary.online ?? 0} online devices out of ${r.tr069Summary.total ?? 0}. ${r.tr069Summary.offline ?? 0} devices are offline.`;
    } else if (r.tr069Devices?.length) {
      output = `I found ${r.tr069Devices.length} TR-069 device${r.tr069Devices.length === 1 ? '' : 's'} for the verified customer: ${r.tr069Devices.map(x => `${`${x.manufacturer || ''} ${x.modelName || x.serialNumber || ''}`.trim()} is ${x.status || 'unknown'}${x.lastContact ? `, last contact ${new Date(x.lastContact).toLocaleString()}` : ''}`).join('; ')}.`;
    } else if (r.customer) {
      const network = [r.customer.olt && `OLT ${r.customer.olt.name} is ${r.customer.olt.status}`, r.customer.splitter && `splitter ${r.customer.splitter.name} is ${r.customer.splitter.status}`].filter(Boolean).join('; ');
      output = `I verified ${r.customer.customerUniqueId || `customer #${r.customer.id}`}: ${r.customer.fullName || [r.customer.firstName, r.customer.middleName, r.customer.lastName].filter(Boolean).join(' ')}. The account is ${r.customer.status}.${network ? ` ${network}.` : ''}`;
    } else if (r.olts?.length) {
      output = `I found ${r.olts.length} OLT${r.olts.length === 1 ? '' : 's'}: ${r.olts.map(x => `${x.name} (${x.ipAddress}) is ${x.status}; ${x.activeSubscribers}/${x.totalSubscribers} subscribers active`).join('; ')}.`;
    } else if (r.splitters?.length) {
      output = `I found ${r.splitters.length} splitter${r.splitters.length === 1 ? '' : 's'}: ${r.splitters.map(x => `${x.name} (${x.splitterId}) is ${x.status}; ${x.usedPorts}/${x.portCount} ports used`).join('; ')}.`;
    } else if (r.invoice) {
      output = `Invoice #${r.invoice.id} was found. Tell me whether you want its charges explained or payment status checked.`;
    } else if (r.ticket) {
      output = `Ticket #${r.ticket.id} is ${r.ticket.status || 'unknown'} with ${r.ticket.priority || 'unset'} priority.`;
    } else if (r.kpis) {
      output = `Current snapshot: ${r.kpis.totalCustomers ?? '-'} customers, ${r.kpis.activeCustomers ?? '-'} active, and ${r.kpis.openTickets ?? '-'} open or in-progress tickets.`;
    } else if (asksIdentity && performed.includes('getSignedInUser') && r.user) {
      const role = r.user.roleName || user?.role || 'user';
      const name = r.user.name || r.customer?.fullName || r.user.email || 'this signed-in account';
      output = `You are signed in as ${name}${r.user.email ? ` (${r.user.email})` : ''}. Your role is ${role}${r.user.department?.name ? `, department ${r.user.department.name}` : ''}${r.user.branch?.name ? `, branch ${r.user.branch.name}` : ''}.`;
    }

    if (!output) {
      if (looksLikeNoise) {
        output = "I could not understand that message as an operational request. Ask me in plain language, for example: total NAS devices, active services, invoice list, TR-069 online devices, OLT status, or customer details.";
        return usageFrom('', output, 'safe-fallback', 'operations-v4');
      }
      output = agent.slug === 'noc'
        ? 'Tell me the network object or action, for example OLT health, TR-069 devices, NAS status, splitter details, Wi-Fi changes, or resync.'
        : agent.slug === 'billing'
          ? 'Tell me the billing action, invoice, customer, due amount, payment, or report you want checked.'
          : "Tell me what you want to check or change. I can answer normally, or run the right Kashtrix task when your message asks for one.";
    }

    return usageFrom('', output, 'safe-fallback', 'operations-v4');
  }
}

const readNested = (source, paths) => {
  for (const path of paths) {
    let value = source;
    for (const part of path) value = value?.[part];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
};

async function getGeminiServiceConfig(prisma, ispId) {
  if (!prisma || !ispId) return null;
  try {
    const row = await prisma.iSPService.findFirst({
      where: {
        ispId,
        isDeleted: false,
        isActive: true,
        isEnabled: true,
        service: { code: 'GEMINI', isActive: true, isDeleted: false }
      },
      select: {
        baseUrl: true,
        apiVersion: true,
        config: true,
        credentials: {
          where: { isDeleted: false, isActive: true },
          select: { key: true, value: true }
        }
      }
    });
    if (!row) return null;
    const config = row.config && typeof row.config === 'object' ? row.config : {};
    const credentials = Object.fromEntries((row.credentials || []).map(item => [String(item.key || '').toLowerCase(), item.value]));
    const key = readNested(
      { ...config, credentials, credential: credentials },
      [
        ['credentials', 'api_key'],
        ['credentials', 'apiKey'],
        ['credentials', 'gemini_api_key'],
        ['credential', 'api_key'],
        ['defaultCredentials', 'api_key'],
        ['defaultCredentials', 'apiKey'],
        ['api_key'],
        ['apiKey'],
        ['geminiApiKey']
      ]
    );
    if (!key) return null;
    return {
      key,
      baseUrl: row.baseUrl,
      apiVersion: row.apiVersion || 'v1beta',
      model: config.model || 'gemini-2.5-flash',
      temperature: typeof config.temperature === 'number' ? config.temperature : undefined
    };
  } catch {
    return null;
  }
}

function providerWithFallback(gemini) {
  const fallback = new SafeFallbackProvider();
  return {
    async complete(input) {
      try {
        return await gemini.complete(input);
      } catch (error) {
        const result = await fallback.complete(input);
        return { ...result, provider: 'safe-fallback', model: `gemini-fallback:${result.model}` };
      }
    }
  };
}

async function getProvider(options = {}) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (key) return providerWithFallback(new GeminiProvider(key));
  const serviceConfig = await getGeminiServiceConfig(options.prisma, options.ispId);
  if (serviceConfig?.key) return providerWithFallback(new GeminiProvider(serviceConfig.key, serviceConfig));
  return new SafeFallbackProvider();
}

module.exports = { AiProvider, GeminiProvider, SafeFallbackProvider, getProvider };
