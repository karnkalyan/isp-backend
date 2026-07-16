class AiProvider {
  async complete() { throw new Error('Provider must implement complete()'); }
}

const { buildSystemPrompt } = require('./ai-prompt-builder.service');

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

const intentInstruction = `Return one JSON object only with: language, intent, action, domain, targetAgentSlug, entities, requiresClarification, confidence. Action must be one of LIST, GET, SEARCH, CREATE, UPDATE, DELETE, EXECUTE, SYNC, RETRY, APPROVE, REJECT, CANCEL, EXPLAIN, COMPARE, CONVERSE. Select only from the supplied agents and capabilities. Never include secrets.`;
const openAiTools = tools => (tools || []).map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema||{type:'object',properties:{}}}}));
// Gemini accepts a smaller function-schema subset than our local validator.
// Unsupported format/additionalProperties fields make it reject the request.
const geminiSchema = schema => {
  const source=schema&&typeof schema==='object'?schema:{};
  const result={type:String(source.type||'object').toUpperCase()};
  if(source.description)result.description=String(source.description);
  if(Array.isArray(source.enum))result.enum=source.enum.map(String);
  if(Array.isArray(source.required)&&source.required.length)result.required=source.required.map(String);
  if(source.properties&&typeof source.properties==='object')result.properties=Object.fromEntries(Object.entries(source.properties).map(([key,value])=>[key,geminiSchema(value)]));
  if(source.items)result.items=geminiSchema(source.items);
  return result;
};
const geminiTools = tools => [{functionDeclarations:(tools || []).map(tool=>({name:tool.name,description:tool.description,parameters:geminiSchema(tool.inputSchema)}))}];
const safeText = value => String(value || '').replace(/\b(password|passwd|pwd|shared\s*secret|api\s*secret|secret(?:\s*key)?)\s*(?:is|=|:)?\s*["'`]?[^\s,;"'`]+["'`]?/gi,'$1 [masked]');

async function throwProviderError(response,label){
  let detail='';
  try{const body=await response.json();detail=String(body?.error?.message||body?.message||'').replace(/\s+/g,' ').slice(0,500);}catch{}
  throw new Error(`${label} returned ${response.status}${detail?`: ${detail}`:''}`);
}

const providerSignal = () => AbortSignal.timeout(Math.max(1000,Number(process.env.AI_PROVIDER_TIMEOUT_MS||20000)));

class GeminiProvider extends AiProvider {
  constructor(key, options = {}) {
    super();
    this.key = key;
    this.baseUrl = options.baseUrl || 'https://generativelanguage.googleapis.com';
    this.apiVersion = /^v1beta$/i.test(String(options.apiVersion || '')) ? options.apiVersion : 'v1beta';
    this.defaultModel = options.model || 'gemini-2.5-flash';
    this.defaultTemperature = options.temperature;
  }

  async complete({ agent, message, context, history = [], user, runtime }) {
    const model = agent.modelName && agent.modelName !== 'default' ? agent.modelName : this.defaultModel;
    const system = buildSystemPrompt({ agent, context, user, runtime });
    /* Legacy prompt retained below as documentation of migrated behavior.
    const legacySystem = [
      agent.systemPrompt || '',
      agent.instructions || '',
      `You are ${agent.name}.`,
      `Signed-in user role: ${user?.role || 'unknown'}.`,
      'Sound like a helpful human teammate, not a policy template or scripted bot.',
      'Use conversational language, contractions, and brief context-aware follow-ups. Never expose internal tool names as the answer.',
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
    ].filter(Boolean).join('\n'); */

    const contents = [
      ...history.slice(-12).map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: safeText(item.content) }] })),
      { role: 'user', parts: [{ text: safeText(message) }] }
    ];

    const root = String(this.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '');
    const version = String(this.apiVersion || 'v1beta').replace(/^\/+/, '');
    const response = await fetch(`${root}/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.key)}`, {
      method: 'POST',
      signal: providerSignal(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: agent.temperature ?? this.defaultTemperature ?? 0.2, maxOutputTokens: agent.maxTokens || 4096 }
      })
    });
    if (!response.ok) await throwProviderError(response,'Gemini provider');
    const data = await response.json();
    const output = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!output) throw new Error('Gemini returned an empty response');
    return usageFrom(message, output, 'gemini', model);
  }

  async detectIntent({message,state,history=[],authorizedTools=[]}) {
    const model=this.defaultModel,root=String(this.baseUrl).replace(/\/+$/,'').replace(/\/v1(beta)?$/i,''),version=String(this.apiVersion).replace(/^\/+/, '');
    const response=await fetch(`${root}/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.key)}`,{method:'POST',signal:providerSignal(),headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:intentInstruction}]},contents:[{role:'user',parts:[{text:JSON.stringify({message,state,history:history.map(x=>({role:x.role,content:x.content})),authorizedTools})}]}],generationConfig:{temperature:0,responseMimeType:'application/json',maxOutputTokens:800}})});
    if(!response.ok)await throwProviderError(response,'Gemini intent');const data=await response.json();const text=data.candidates?.[0]?.content?.parts?.map(part=>part.text||'').join('');return JSON.parse(text);
  }

  async completeWithTools({agent,message,context,history=[],user,runtime,tools=[],toolHistory=[]}) {
    const model=agent.modelName&&agent.modelName!=='default'?agent.modelName:this.defaultModel;
    const contents=[...history.slice(-12).map(item=>({role:item.role==='assistant'?'model':'user',parts:[{text:safeText(item.content)}]})),{role:'user',parts:[{text:safeText(message)}]},...toolHistory.flatMap(item=>[{role:'model',parts:[{functionCall:{name:item.name,args:item.arguments}}]},{role:'user',parts:[{functionResponse:{name:item.name,response:{result:item.result}}}]}])];
    const root=String(this.baseUrl).replace(/\/+$/,'').replace(/\/v1(beta)?$/i,''),version=String(this.apiVersion).replace(/^\/+/, '');
    const response=await fetch(`${root}/${version}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.key)}`,{method:'POST',signal:providerSignal(),headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:buildSystemPrompt({agent,context,user,runtime})}]},contents,...(tools.length?{tools:geminiTools(tools),toolConfig:{functionCallingConfig:{mode:'AUTO'}}}:{}),generationConfig:{temperature:agent.temperature??.2,maxOutputTokens:agent.maxTokens||4096}})});
    if(!response.ok)await throwProviderError(response,'Gemini tool calling');const data=await response.json(),parts=data.candidates?.[0]?.content?.parts||[];
    return {content:parts.map(part=>part.text||'').join('').trim(),toolCalls:parts.filter(part=>part.functionCall).map((part,index)=>({id:`gemini-${index}`,name:part.functionCall.name,arguments:part.functionCall.args||{}})),provider:'gemini',model,usage:{inputTokens:data.usageMetadata?.promptTokenCount||0,outputTokens:data.usageMetadata?.candidatesTokenCount||0,totalTokens:data.usageMetadata?.totalTokenCount||0,estimatedCost:0}};
  }
}

class OpenAICompatibleProvider extends AiProvider {
  constructor(key, options = {}) {
    super();
    this.key = key;
    this.baseUrl = String(options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.defaultModel = options.model || 'gpt-4.1-mini';
  }
  async complete({ agent, message, context, history = [], user, runtime }) {
    const model = agent.modelName && agent.modelName !== 'default' ? agent.modelName : this.defaultModel;
    const messages = [{role:'system',content:buildSystemPrompt({agent,context,user,runtime})},...history.slice(-16).map(item=>({role:item.role==='assistant'?'assistant':'user',content:safeText(item.content)})),{role:'user',content:safeText(message)}];
    const response = await fetch(`${this.baseUrl}/chat/completions`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},body:JSON.stringify({model,messages,temperature:agent.temperature??0.2,max_tokens:agent.maxTokens||4096})});
    if(!response.ok)throw new Error(`OpenAI-compatible provider returned ${response.status}`);
    const data=await response.json();
    const output=data.choices?.[0]?.message?.content?.trim();
    if(!output)throw new Error('OpenAI-compatible provider returned an empty response');
    const result=usageFrom(message,output,'openai-compatible',model);
    if(data.usage)result.usage={inputTokens:data.usage.prompt_tokens||0,outputTokens:data.usage.completion_tokens||0,totalTokens:data.usage.total_tokens||0,estimatedCost:0};
    return result;
  }
  async detectIntent({message,state,history=[],authorizedTools=[]}) {
    const response=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},body:JSON.stringify({model:this.defaultModel,messages:[{role:'system',content:intentInstruction},{role:'user',content:JSON.stringify({message,state,history:history.map(x=>({role:x.role,content:x.content})),authorizedTools})}],temperature:0,response_format:{type:'json_object'},max_tokens:800})});
    if(!response.ok)throw new Error(`OpenAI-compatible intent returned ${response.status}`);const data=await response.json();return JSON.parse(data.choices?.[0]?.message?.content||'{}');
  }
  async completeWithTools({agent,message,context,history=[],user,runtime,tools=[],toolHistory=[]}) {
    const model=agent.modelName&&agent.modelName!=='default'?agent.modelName:this.defaultModel;
    const messages=[{role:'system',content:buildSystemPrompt({agent,context,user,runtime})},...history.slice(-16).map(item=>({role:item.role==='assistant'?'assistant':'user',content:safeText(item.content)})),{role:'user',content:safeText(message)}];
    for(const item of toolHistory){messages.push({role:'assistant',content:null,tool_calls:[{id:item.id,type:'function',function:{name:item.name,arguments:JSON.stringify(item.arguments)}}]},{role:'tool',tool_call_id:item.id,name:item.name,content:JSON.stringify(item.result)});}
    const response=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},body:JSON.stringify({model,messages,...(tools.length?{tools:openAiTools(tools),tool_choice:'auto'}:{}),temperature:agent.temperature??.2,max_tokens:agent.maxTokens||4096})});
    if(!response.ok)throw new Error(`OpenAI-compatible tool calling returned ${response.status}`);const data=await response.json(),choice=data.choices?.[0]?.message||{};
    return {content:String(choice.content||'').trim(),toolCalls:(choice.tool_calls||[]).filter(call=>call.type==='function').map(call=>{let args={};try{args=JSON.parse(call.function.arguments||'{}')}catch{args={__invalid:true}}return{id:call.id,name:call.function.name,arguments:args}}),provider:'openai-compatible',model,usage:{inputTokens:data.usage?.prompt_tokens||0,outputTokens:data.usage?.completion_tokens||0,totalTokens:data.usage?.total_tokens||0,estimatedCost:0}};
  }
}

class LegacySafeFallbackProvider extends AiProvider {
  async complete({ agent, message = '', context, user }) {
    let output;
    const r = context?.records || {};
    const performed = context?.performed || [];
    const text = String(message || '').toLowerCase().trim();
    const asksAgentRole = /\b(your role|who are you|what are you|what can you do)\b/.test(text);
    const asksRuntime = /\b(local|locally running|running locally|are you running|which model|gemini)\b/.test(text);
    const asksIdentity = /\b(who am i|what(?:'s| is) my (?:actual |real )?name|do you know my (?:actual |real )?name|my (?:actual |real )?name|logged in(?: as)?|my profile|mero naam|mera naam|hamar naam|wie heisse)\b/.test(text);
    const asksWellbeing = /\b(how are you|how r u|how you doing|how's it going|kasto chau|kaise ho|sab thik)\b/.test(text);
    const acknowledgement = /^(great|good|nice|ok|okay|yes|yeah|yep|sure|thanks|thank you|perfect|cool|awesome|got it|fine|thik cha|dhanyabad)[.!?\s]*$/i.test(String(message || '').trim());
    const looksLikeNoise = text.length > 0 && !/[?]/.test(text) && text.split(/\s+/).every(part => part.length < 12) && !/(nas|service|invoice|bill|tr069|olt|splitter|ticket|lead|customer|role|local|running|hello|hi|great|good|nice|ok|okay|thanks|perfect|cool)/.test(text) && /[a-z]{3,}/.test(text);

    if (context?.kind === 'GREETING') {
      const profileName = r.user?.name || user?.name;
      output = `Hi${profileName ? ` ${profileName}` : ''}! What can I help you with?`;
    } else if (acknowledgement) {
      output = 'Absolutely. What would you like me to help with next?';
    } else if (asksWellbeing) {
      output = "I'm good and ready to help. You can chat normally, or ask me to check records, create tickets, inspect devices, update Wi-Fi, list invoices, or run other Kashtrix tasks.";
    } else if (asksRuntime) {
      output = 'Yes. Right now I am responding from the Kashtrix AI operations layer on this backend. Gemini is used when a backend Gemini key or active tenant GEMINI service key is configured; otherwise I use the local safe responder with real database/API tools.';
    } else if (asksAgentRole) {
      output = `I'm ${agent.name}, your ${agent.department || 'operations'} teammate. I can understand normal conversation, keep track of the current issue, bring in the right specialist, check live records, and help move work through tasks, tickets, and approvals.`;
    } else if (asksIdentity && r.user) {
      const role = r.user.roleName || user?.role || 'user';
      const name = r.user.name || r.user.email || 'this signed-in account';
      output = `Your Kashtrix profile is registered as ${name}${r.user.email ? ` (${r.user.email})` : ''}. Your role is ${role}${r.user.department?.name ? ` in ${r.user.department.name}` : ''}. I only know the information saved in your account, so I can't confirm a different legal or personal name unless your profile contains it.`;
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
      if(v.requestedIp)output=v.found&&v.device?`NAS ${v.requestedIp} is record #${v.device.id} (${v.device.shortname||'no short name'}), type ${v.device.type||'other'}, ${v.device.isActive?'active':'inactive'}, Radius NAS ID ${v.device.radiusNasId||'not synchronized'}, server ${v.device.server||'not set'}. The shared secret is never displayed.`:`NAS ${v.requestedIp} was not found in this ISP.`;
      else output = `There are ${v.total ?? 0} NAS devices: ${v.online ?? 0} online and ${v.offline ?? 0} offline.${v.devices?.length ? ` ${v.devices.map(x => `${x.name || x.shortname || x.ipAddress || `NAS ${x.id}`} is ${x.status || 'unknown'}`).join('; ')}.` : ''}`;
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
    } else if (r.operation?.operation === 'getTr069WifiDetails') {
      const v = r.operation.data || {};
      if (!v.found) {
        output = v.reason || `I couldn't find Wi-Fi details for ${v.serialNumber || 'that device'}.`;
      } else {
        const rows = Array.isArray(v.wifi) ? v.wifi : [];
        output = [
          `I checked Wi-Fi on ${v.device.serialNumber}. The device is ${v.device.status || 'unknown'}.`,
          rows.length ? rows.map(item => `SSID ${item.ssidIndex}: ${item.ssidName || 'Name unavailable'} · password ${item.passwordConfigured ? 'configured' : 'not stored'} · last synced ${item.lastSyncedAt ? new Date(item.lastSyncedAt).toLocaleString() : 'unknown'}`).join('\n') : 'No synced SSID records are available yet. I can refresh the device before checking again.'
        ].join('\n');
      }
    } else if (r.operation?.operation === 'listCustomers') {
      const v = r.operation.data || {};
      const customers = Array.isArray(v.customers) ? v.customers : [];
      output = customers.length
        ? `Customers (${customers.length} shown of ${v.total ?? customers.length}):\n${customers.map((customer,index)=>`${index+1}. ${customer.customerUniqueId || `Customer #${customer.id}`} - ${customer.fullName || 'name unavailable'} - ${customer.status || 'unknown'}${customer.branch?.name ? ` - ${customer.branch.name}` : ''}`).join('\n')}\nAsk for details using the customer ID.`
        : 'No customers were found.';
    } else if (r.operation?.operation === 'getCustomerDetail') {
      const v = r.operation.data || {};
      const customer = v.customer;
      output = !v.found || !customer
        ? (v.reason || 'I could not find that customer.')
        : `I found ${customer.customerUniqueId} — ${customer.fullName || 'name unavailable'}. The account is ${customer.status || 'unknown'}, with ${customer.connectionUsers?.filter(item => item.isActive).length || 0} active connection login(s) and ${v.tr069Devices?.length || 0} linked TR-069 device(s).`;
    } else if (r.operation?.operation === 'diagnoseCustomerInternet') {
      const v = r.operation.data || {};
      const customer = v.customer;
      const d = v.diagnostic;
      if (!v.found || !customer || !d) {
        output = v.reason || 'I need the customer ID before I can check the connection.';
      } else {
        const checks = [
          `Account: ${d.accountActive ? 'active' : 'needs attention'}`,
          `Radius login: ${d.radiusActive ? 'active' : 'inactive'}`,
          `Customer router: ${d.tr069Online ? 'online' : 'offline or not synced'}`,
          `OLT: ${d.oltOnline ? 'online' : 'not reporting online'}`,
          `Splitter: ${d.splitterOnline ? 'healthy' : 'needs attention'}`
        ];
        output = `I checked ${customer.fullName || customer.customerUniqueId}'s connection (${customer.customerUniqueId}).\n${checks.join('\n')}\n${d.recommendation}`;
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
    }

    if (!output) {
      const conversationState = r.conversationState || {};
      if (looksLikeNoise) {
        if (conversationState.pendingAction) output = `I still have the pending ${conversationState.pendingAction.actionType || 'action'} in this conversation. Would you like me to confirm it or cancel it?`;
        else if (conversationState.selectedDeviceId) output = `Are you asking about device ${conversationState.selectedDeviceId}, or do you want me to run a different check on it?`;
        else if (conversationState.selectedCustomerId) output = `Are you asking me to check customer ${conversationState.selectedCustomerId}'s devices, tickets, billing, or connection?`;
        else output = 'Which record should I use for this request—for example, a customer ID, device serial, ticket number, or NAS IP?';
        return usageFrom('', output, 'safe-fallback', 'operations-v4');
      }
      output = agent.slug === 'noc'
        ? 'Which network action should I take: inspect an OLT or TR-069 device, check NAS status, update Wi-Fi, or prepare a network change?'
        : agent.slug === 'billing'
          ? 'Which billing record should I check—the invoice number, customer, payment, or outstanding balance?'
          : 'Which customer, device, ticket, invoice, or operational action should I work with?';
    }

    return usageFrom('', output, 'safe-fallback', 'operations-v4');
  }
}

class SafeFallbackProvider extends AiProvider {
  async complete({agent,message='',context,user}) {
    const records=context?.records||{},operation=records.operation,state=records.conversationState||{},text=String(message).toLowerCase();
    let output;
    if(context?.kind==='GREETING')output=`Hi${records.user?.name||user?.name?` ${records.user?.name||user?.name}`:''}! How can I help?`;
    else if(/\b(who am i|my (?:actual |real )?name|do you know my name|my profile)\b/.test(text)&&records.user){const name=records.user.name||records.user.email;output=`Your Kashtrix profile is registered as ${name}${records.user.email?` (${records.user.email})`:''}. Your role is ${records.user.roleName||user?.role||'user'}.`;}
    else if(operation?.error)output=`I couldn't complete that verified operation: ${operation.error}`;
    else if(operation?.approvalRequired)output=`This ${operation.operation||'operation'} is ready but requires approval before any change is made.`;
    else if(operation?.operation==='listCustomers'&&Array.isArray(operation.data?.customers)){const customers=operation.data.customers;output=customers.length?`Customers (${customers.length} shown):\n${customers.map((customer,index)=>`${index+1}. ${customer.customerUniqueId||`Customer #${customer.id}`} - ${customer.fullName||'name unavailable'} - ${customer.status||'unknown'}`).join('\n')}`:'No customers were found.';}
    else if(operation?.operation==='getCustomerDetail'&&operation.data?.customer){const c=operation.data.customer;output=`I found ${c.customerUniqueId} — ${c.fullName||'name unavailable'}. The account is ${c.status||'unknown'} and has ${operation.data.tr069Devices?.length||0} linked TR-069 device(s).`;}
    else if(operation?.operation==='getTr069DeviceDetail'&&operation.data?.device){const d=operation.data.device;output=`TR-069 device ${d.serialNumber||d.id} is ${d.status||'unknown'}${d.ipAddress?` at ${d.ipAddress}`:''}.`;}
    else if((operation?.operation==='listTickets'||operation?.operation==='listOpenTickets')&&Array.isArray(operation.data?.tickets)){const tickets=operation.data.tickets;output=tickets.length?`I found ${tickets.length} ticket(s):\n${tickets.map((ticket,index)=>`${index+1}. ${ticket.ticketNumber||ticket.id} — ${ticket.title} — ${ticket.status} — ${ticket.priority}`).join('\n')}`:`No support tickets were found${operation.data.customerRef?` for ${operation.data.customerRef}`:''}.`;}
    else if(operation?.data)output=`I completed the verified ${operation.operation||'operation'} check. Result: ${JSON.stringify(operation.data)}`;
    else if(state.pendingAction)output=`The ${state.pendingAction.actionType||'current action'} is still pending. You can confirm it or cancel it.`;
    else output=`The configured AI provider is unavailable right now. I can still run approved, deterministic Kashtrix tools, but I need a specific customer, device, ticket, invoice, or operation.`;
    return usageFrom(message,output,'safe-fallback','verified-local-v1');
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
        return { ...result, content:`The configured AI provider is temporarily unavailable, so I used verified local operations only.\n\n${result.content}`, provider: 'safe-fallback', model: `provider-fallback:${result.model}`, providerError:error.message };
      }
    },
    detectIntent(input){return gemini.detectIntent(input);},
    completeWithTools(input){return gemini.completeWithTools(input);},
    dynamicProvider:true
  };
}

async function getProvider(options = {}) {
  const openAiKey=process.env.OPENAI_API_KEY||process.env.OPENAI_COMPATIBLE_API_KEY;
  if(openAiKey)return providerWithFallback(new OpenAICompatibleProvider(openAiKey,{baseUrl:process.env.OPENAI_BASE_URL,model:process.env.OPENAI_MODEL}));
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (key) return providerWithFallback(new GeminiProvider(key));
  const serviceConfig = await getGeminiServiceConfig(options.prisma, options.ispId);
  if (serviceConfig?.key) return providerWithFallback(new GeminiProvider(serviceConfig.key, serviceConfig));
  return new SafeFallbackProvider();
}

module.exports = { AiProvider, GeminiProvider, OpenAICompatibleProvider, SafeFallbackProvider, getProvider };
