const { detectLanguage } = require('./ai-agent-router.service');

const ACTIONS = new Set(['LIST','GET','SEARCH','CREATE','UPDATE','DELETE','EXECUTE','SYNC','RETRY','APPROVE','REJECT','CANCEL','EXPLAIN','COMPARE','CONVERSE']);
const DOMAINS = new Set(['NAS','TR069','CUSTOMER','TICKET','BILLING','PAYMENT','NETWORK','SERVICE','INVENTORY','LEAD','GENERAL']);
const AGENTS = new Set(['manager','noc','support','billing','finance','sales','inventory','field-operations','ceo']);
const TOOL_BY_INTENT = {
  CREATE_NAS:'createNas',UPDATE_NAS:'updateNas',LIST_NAS:'getNasSummary',GET_NAS:'getNasSummary',SYNC_NAS:'resyncNas',CONFIGURE_MIKROTIK_RADIUS:'configureMikrotikRadius',
  GET_CUSTOMER:'getCustomer',LIST_CUSTOMERS:'searchCustomers',GET_CUSTOMER_TICKETS:'getTicket',GET_TR069_DEVICE:'getTR069DeviceStatus',GET_TICKET:'getTicket',LIST_TICKETS:'getTicketSummary',
  GET_INVOICE:'getInvoice',LIST_INVOICES:'listInvoices',GET_INVOICE_SUMMARY:'getInvoiceSummary',GET_SERVICE_SUMMARY:'getServiceSummary',LIST_SERVICES:'listServices'
};

const maskText = value => String(value || '').replace(/\b(password|passwd|pwd|shared\s*secret|api\s*secret|secret(?:\s*key)?)\s*(?:is|=|:)?\s*["'`]?[^\s,;"'`]+["'`]?/gi,'$1 [masked]');
const customerRef = value => String(value||'').match(/\bK-CUST-\d+\b/i)?.[0]?.toUpperCase() || null;
const ipList = value => [...String(value||'').matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)].map(match=>match[0]);
const serialRef = value => String(value||'').match(/\b(?=[A-Z0-9:-]*[A-Z])(?=[A-Z0-9:-]*\d)[A-Z0-9][A-Z0-9:-]{6,}[A-Z0-9]\b/i)?.[0] || null;

function deterministicIntent(message, state = {}) {
  const text=String(message||'').toLowerCase(),ips=ipList(message),entities={};
  if(ips[0])entities.nasIp=ips[0];if(ips[1])entities.radiusServerIp=ips[1];if(customerRef(message))entities.customerRef=customerRef(message);
  const serial=serialRef(message);if(serial&&!/(?:k-)?cust-/i.test(serial))entities.deviceSerial=serial;
  let result={language:detectLanguage(message),intent:'CONVERSATION',action:'CONVERSE',domain:'GENERAL',targetAgentSlug:'manager',entities,requiresClarification:false,confidence:.55,source:'fallback'};
  const create=/\b(create|add|register|provision|connect|set up|setup)\b/.test(text),update=/\b(update|edit|change|modify)\b/.test(text),list=/\b(list|show|all|how many|count|summary)\b/.test(text),get=/\b(check|details?|status|find|get)\b/.test(text);
  if(/\b(nas|radius)\b/.test(text)){
    if(/\b(mikrotik|router)\b/.test(text)&&/\b(configure|add|set up|connect)\b/.test(text))result={...result,intent:'CONFIGURE_MIKROTIK_RADIUS',action:'EXECUTE',domain:'NETWORK',targetAgentSlug:'noc',confidence:.82};
    else if(update)result={...result,intent:'UPDATE_NAS',action:'UPDATE',domain:'NAS',targetAgentSlug:'noc',confidence:.86};
    else if(create)result={...result,intent:'CREATE_NAS',action:'CREATE',domain:'NAS',targetAgentSlug:'noc',confidence:.86};
    else if(/\b(resync|re-sync|synchroni[sz]e|sync)\b/.test(text))result={...result,intent:'SYNC_NAS',action:'SYNC',domain:'NAS',targetAgentSlug:'noc',confidence:.84};
    else if(list)result={...result,intent:'LIST_NAS',action:'LIST',domain:'NAS',targetAgentSlug:'noc',confidence:.8};
    else if(get||ips[0])result={...result,intent:'GET_NAS',action:'GET',domain:'NAS',targetAgentSlug:'noc',confidence:.76};
  }else if(/\b(tr-?069|device|router)\b/.test(text)&&(/\b(linked|details?|status|check|serial)\b/.test(text)||entities.deviceSerial))result={...result,intent:'GET_TR069_DEVICE',action:'GET',domain:'TR069',targetAgentSlug:'noc',confidence:.82};
  else if(/\btickets?\b/.test(text))result={...result,intent:state.selectedCustomerId||entities.customerRef?'GET_CUSTOMER_TICKETS':'LIST_TICKETS',action:'LIST',domain:'TICKET',targetAgentSlug:'support',confidence:.8};
  else if(/\bcustomers?|subscribers?\b/.test(text)&&list&&!/\b(summary|total|count|how many)\b/.test(text))result={...result,intent:'LIST_CUSTOMERS',action:'LIST',domain:'CUSTOMER',targetAgentSlug:'support',confidence:.84};
  else if(/\bcustomer\b/.test(text)&&(entities.customerRef||state.selectedCustomerId))result={...result,intent:'GET_CUSTOMER',action:'GET',domain:'CUSTOMER',targetAgentSlug:'support',confidence:.82};
  else if(/\binvoices?\b/.test(text))result={...result,intent:list?'LIST_INVOICES':'GET_INVOICE_SUMMARY',action:list?'LIST':'GET',domain:'BILLING',targetAgentSlug:'billing',confidence:.78};
  else if(/\bservices?\b/.test(text))result={...result,intent:list?'LIST_SERVICES':'GET_SERVICE_SUMMARY',action:list?'LIST':'GET',domain:'SERVICE',targetAgentSlug:'manager',confidence:.76};
  return result;
}

function validateStructuredIntent(candidate, fallback) {
  if(!candidate||typeof candidate!=='object')return null;
  const action=String(candidate.action||'').toUpperCase(),domain=String(candidate.domain||'').toUpperCase(),slug=String(candidate.targetAgentSlug||'');
  const confidence=Number(candidate.confidence);
  if(!ACTIONS.has(action)||!DOMAINS.has(domain)||!AGENTS.has(slug)||!Number.isFinite(confidence)||confidence<0||confidence>1)return null;
  const intent=String(candidate.intent||'').toUpperCase().replace(/[^A-Z0-9_]/g,'');if(!intent)return null;
  return {language:String(candidate.language||fallback.language||'en').slice(0,20),intent,action,domain,targetAgentSlug:slug,entities:candidate.entities&&typeof candidate.entities==='object'?candidate.entities:{},requiresClarification:Boolean(candidate.requiresClarification),confidence,source:'model'};
}

async function resolveStructuredIntent({ provider,message,state,history=[],authorizedTools=[] }) {
  const fallback=deterministicIntent(message,state);
  if(!provider||typeof provider.detectIntent!=='function')return {...fallback,toolName:TOOL_BY_INTENT[fallback.intent]||null,fallbackReason:'PROVIDER_INTENT_UNAVAILABLE'};
  try{
    const candidate=await provider.detectIntent({message:maskText(message),state,history:history.slice(-10),authorizedTools:authorizedTools.map(tool=>tool.name||tool)});
    const valid=validateStructuredIntent(candidate,fallback);
    if(!valid||valid.confidence<.65)return {...fallback,toolName:TOOL_BY_INTENT[fallback.intent]||null,fallbackReason:valid?'LOW_CONFIDENCE':'INVALID_MODEL_INTENT'};
    return {...valid,toolName:TOOL_BY_INTENT[valid.intent]||candidate.toolName||null,fallbackReason:null};
  }catch(error){return {...fallback,toolName:TOOL_BY_INTENT[fallback.intent]||null,fallbackReason:error.code||'PROVIDER_INTENT_ERROR'};}
}

module.exports={ACTIONS,DOMAINS,TOOL_BY_INTENT,deterministicIntent,validateStructuredIntent,resolveStructuredIntent,maskText};
