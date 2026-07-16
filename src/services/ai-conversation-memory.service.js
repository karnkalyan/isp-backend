const ACTIVE_ACTION_STATUSES = ['DRAFT','AWAITING_CLARIFICATION','AWAITING_CONFIRMATION','CONFIRMED','AWAITING_APPROVAL','APPROVED','EXECUTING','FAILED'];
const customerRef = value => String(value || '').match(/\bK-CUST-\d+\b/i)?.[0]?.toUpperCase() || null;
const serialRef = value => String(value || '').match(/\b(?=[A-Z0-9:-]*[A-Z])(?=[A-Z0-9:-]*\d)[A-Z0-9][A-Z0-9:-]{6,}[A-Z0-9]\b/i)?.[0] || null;

function classifyIntent(message, state = {}) {
  const text = String(message || '').toLowerCase();
  if (/\b(?:create|add|connect|configure|provision|register|setup|set up)\b.{0,80}\b(?:nas|radius)\b|\b(?:add new one|create new one)\b/.test(text)) return { intent:'CREATE_NAS', module:'NAS_MANAGEMENT', action:'CREATE', entityType:'NAS' };
  if (/\b(?:show|list|how many|count|total)\b.{0,50}\bnas\b/.test(text)) return { intent:'LIST_NAS', module:'NAS_MANAGEMENT', action:'LIST', entityType:'NAS' };
  if (/\b(?:support\s+)?tickets?\b/.test(text)) return { intent:'GET_CUSTOMER_TICKETS', module:'TICKETS', action:'LIST', entityType:'TICKET' };
  if (/\b(?:tr-?069|linked device|the device|a device|device details?)\b/.test(text) || serialRef(message)) return { intent:'GET_TR069_DEVICE', module:'TR069', action:'GET', entityType:'DEVICE' };
  if (/\b(?:customer|subscriber)\b/.test(text) && customerRef(text)) return { intent:'GET_CUSTOMER', module:'CUSTOMERS', action:'GET', entityType:'CUSTOMER' };
  if (/^(?:why|why\?|how come|what happened)[.!?\s]*$/.test(text.trim())) return { intent:'EXPLAIN_LAST_RESULT', module:state.currentModule || null, action:'EXPLAIN', entityType:state.currentEntityType || null };
  if (/\b(?:but you said|you said|earlier you|there is a device|how can you say|contradict|not correct|that's wrong|that is wrong)\b/.test(text)) return { intent:'RESOLVE_CONTRADICTION', module:state.currentModule || 'TR069', action:'CORRECT', entityType:state.currentEntityType || 'DEVICE' };
  return { intent:state.currentIntent || null, module:state.currentModule || null, action:null, entityType:state.currentEntityType || null };
}

function resolveFollowUp(message, state = {}, history = []) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const classified = classifyIntent(text, state);
  let resolvedMessage = text;
  let resolution = null;
  const selectedCustomer = state.selectedCustomerId;
  let selectedDevice = state.selectedDeviceId;
  const explicitDevice = serialRef(text);

  if (explicitDevice && /\b(?:device|tr-?069|serial)\b/i.test(text)) {
    selectedDevice = explicitDevice;
    resolvedMessage = `Validate and show TR-069 device details for serial ${explicitDevice}`;
    resolution = 'EXPLICIT_DEVICE';
  } else if (/\b(?:check|show|list|get)\s+(?:support\s+)?tickets?\b/i.test(text) && selectedCustomer && !customerRef(text)) {
    resolvedMessage = `${text} for customer ${selectedCustomer}`; resolution = 'ACTIVE_CUSTOMER';
  } else if (/\b(?:details? of (?:the )?linked tr-?069|linked device|the device|show details|device details?)\b/i.test(text)) {
    if (selectedDevice) { resolvedMessage = `Show TR-069 device details for serial ${selectedDevice}`; resolution = 'ACTIVE_DEVICE'; }
    else if (selectedCustomer) { resolvedMessage = `Show linked TR-069 device details for customer ${selectedCustomer}`; resolution = 'ACTIVE_CUSTOMER'; }
  } else if (/^(?:add new one|create new one|do it|retry|try again)[.!?\s]*$/i.test(text) && (state.currentIntent === 'CREATE_NAS' || state.pendingActionId)) {
    resolvedMessage = `Continue the pending CREATE_NAS action${state.selectedNasId ? ` for ${state.selectedNasId}` : ''}.`; resolution = 'PENDING_ACTION';
  } else if (/^(?:why|why\?|how come|what happened)[.!?\s]*$/i.test(text)) {
    const previous = state.lastToolResult || state.lastAssistantClaim || history.slice().reverse().find(item => item.role === 'assistant')?.content;
    resolvedMessage = `Explain the reason for the immediately previous result: ${typeof previous === 'string' ? previous : JSON.stringify(previous || {})}`; resolution = 'LAST_RESULT';
  } else if (classified.intent === 'RESOLVE_CONTRADICTION') {
    resolvedMessage = `Check TR-069 device details and resolve the contradiction. Customer ${selectedCustomer || 'unknown'}, device serial ${selectedDevice || serialRef(text) || 'unknown'}. User correction: ${text}`; resolution = 'CONTRADICTION';
  } else if (/\b(?:that customer|the customer|same customer)\b/i.test(text) && selectedCustomer) {
    resolvedMessage = `${text} (${selectedCustomer})`; resolution = 'ACTIVE_CUSTOMER';
  } else if (/^(?:show\s+)?details?\s+(?:of|for)\s+(?:it|this|that|the same one)[.!?\s]*$/i.test(text) && selectedCustomer) {
    resolvedMessage = `Show customer details for ${selectedCustomer}`; resolution = 'ACTIVE_CUSTOMER';
  }
  return { ...classified, originalMessage:text, resolvedMessage, resolution, selectedCustomer, selectedDevice };
}

async function loadConversationState(prisma, { ispId, conversationId, userId }) {
  const [context, pendingAction, entities, lastRoute] = await Promise.all([
    prisma.aiConversationContext.findFirst({ where:{ ispId, conversationId, userId } }),
    prisma.aiPendingAgentAction.findFirst({ where:{ ispId, conversationId, status:{ in:ACTIVE_ACTION_STATUSES },AND:[{OR:[{status:{notIn:['DRAFT','AWAITING_CONFIRMATION']}},{expiresAt:null},{expiresAt:{gt:new Date()}}]}] }, orderBy:{ updatedAt:'desc' } }),
    prisma.aiEntityReference.findMany({ where:{ ispId, conversationId, isActive:true }, orderBy:{ updatedAt:'desc' }, take:20 }),
    prisma.aiAgentRoute.findFirst({ where:{ ispId, conversationId }, orderBy:{ createdAt:'desc' } })
  ]);
  return { ...(context || {}), pendingAction:pendingAction || null, entities, lastRoute };
}

async function ensureConversationState(prisma, { ispId, conversationId, userId, selectedAgentId, chatId }) {
  return prisma.aiConversationContext.upsert({
    where:{ conversationId },
    update:{ selectedAgentId:selectedAgentId || undefined, chatId:String(chatId || conversationId), expiresAt:new Date(Date.now()+10*60*1000) },
    create:{ ispId, conversationId, userId, chatId:String(chatId || conversationId), selectedAgentId:selectedAgentId || null, expiresAt:new Date(Date.now()+10*60*1000), entityStack:[] }
  });
}

async function rememberEntity(prisma, { ispId, conversationId, messageId, entityType, entityId, displayLabel, source='TOOL', metadata }) {
  if (!entityType || !entityId) return null;
  await prisma.aiEntityReference.updateMany({ where:{ ispId, conversationId, entityType, isActive:true }, data:{ isActive:false } });
  return prisma.aiEntityReference.create({ data:{ ispId, conversationId, messageId:messageId || null, entityType, entityId:String(entityId), displayLabel:displayLabel || String(entityId), source, metadata:metadata || null } });
}

async function saveTurnState(prisma, args) {
  const { ispId, conversationId, userId, selectedAgentId, routedAgentId, resolution, operation, assistantMessage, route, debugTrace } = args;
  const current = await ensureConversationState(prisma,{ ispId, conversationId, userId, selectedAgentId, chatId:args.chatId });
  const data = operation?.data || {};
  const onlyListedCustomer = Array.isArray(data.customers) && data.customers.length === 1 ? data.customers[0]?.customerUniqueId : null;
  const customerId = customerRef(resolution.originalMessage) || data.customer?.customerUniqueId || onlyListedCustomer || data.customerRef || current.selectedCustomerId;
  const deviceId = data.device?.serialNumber || data.tr069Devices?.[0]?.serialNumber || serialRef(resolution.originalMessage) || current.selectedDeviceId;
  const ticketId = data.ticket?.ticketNumber || data.ticket?.id || current.selectedTicketId;
  const nasId = data.nas?.ipAddress || data.nas?.id || (resolution.intent === 'CREATE_NAS' ? (resolution.originalMessage.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || current.selectedNasId) : current.selectedNasId);
  const entityStack = [...(Array.isArray(current.entityStack)?current.entityStack:[]),...[customerId&&{type:'CUSTOMER',id:String(customerId)},deviceId&&{type:'DEVICE',id:String(deviceId)},ticketId&&{type:'TICKET',id:String(ticketId)},nasId&&{type:'NAS',id:String(nasId)}].filter(Boolean)].slice(-20);
  const update = {
    previousIntent:current.currentIntent || null,currentIntent:resolution.intent || current.currentIntent,currentModule:resolution.module || current.currentModule,currentAction:resolution.action || current.currentAction,currentEntityType:resolution.entityType || current.currentEntityType,
    selectedAgentId:selectedAgentId || current.selectedAgentId,routedAgentId:routedAgentId || current.routedAgentId,selectedCustomerId:customerId || null,selectedDeviceId:deviceId || null,selectedTicketId:ticketId?String(ticketId):null,selectedNasId:nasId?String(nasId):null,
    currentEntityId:String(deviceId || customerId || ticketId || nasId || current.currentEntityId || '') || null,lastToolCall:operation?{operation:operation.operation,resolvedMessage:resolution.resolvedMessage}:current.lastToolCall,lastToolResult:operation || current.lastToolResult,lastSuccessfulToolResult:operation&&!operation.error?operation:current.lastSuccessfulToolResult,lastAssistantClaim:assistantMessage?{messageId:assistantMessage.id,content:assistantMessage.content}:current.lastAssistantClaim,
    entityStack,conversationSummary:`Intent: ${resolution.intent || 'conversation'}. Customer: ${customerId || 'none'}. Device: ${deviceId || 'none'}. Pending action: ${current.pendingActionId || 'none'}.`,debugTrace,expiresAt:new Date(Date.now()+10*60*1000)
  };
  const saved = await prisma.aiConversationContext.update({ where:{ conversationId }, data:update });
  if(customerId)await rememberEntity(prisma,{ispId,conversationId,messageId:assistantMessage?.id,entityType:'CUSTOMER',entityId:customerId,source:operation?'TOOL':'USER'});
  if(deviceId)await rememberEntity(prisma,{ispId,conversationId,messageId:assistantMessage?.id,entityType:'DEVICE',entityId:deviceId,source:operation?'TOOL':'USER'});
  if(route?.toAgentId)await prisma.aiAgentRoute.create({data:{ispId,conversationId,messageId:assistantMessage?.id,fromAgentId:route.fromAgentId||null,toAgentId:route.toAgentId,resolvedIntent:resolution.intent,confidence:Number(route.confidence||0),reason:route.reason||resolution.resolution||'intent',contextSnapshot:{customerId,deviceId,pendingActionId:saved.pendingActionId,resolvedMessage:resolution.resolvedMessage}}});
  return saved;
}

async function createPendingAction(prisma, { ispId, conversationId, agentId, requestedBy, action }) {
  await prisma.aiPendingAgentAction.updateMany({ where:{ ispId, conversationId, status:{ in:['DRAFT','AWAITING_CONFIRMATION'] } }, data:{ status:'CANCELLED',error:'Replaced by a newer action in this conversation.' } });
  const confirmationExpiresAt=new Date(Date.now()+10*60*1000);
  const row=await prisma.aiPendingAgentAction.create({data:{ispId,conversationId,agentId,requestedBy,actionType:action.taskType || action.actionType || 'GENERAL',toolName:action.toolName || null,module:action.module || 'AI_OPERATIONS',argumentsEncrypted:action.input || null,displayArguments:action.displayArguments || null,status:'AWAITING_CONFIRMATION',riskLevel:action.riskLevel || 'HIGH',requiresApproval:action.requiresApproval!==false,idempotencyKey:action.idempotencyKey || `${conversationId}:${action.toolName||action.taskType||'action'}:${Date.now()}`,expiresAt:confirmationExpiresAt,confirmationExpiresAt}});
  await prisma.aiConversationContext.update({where:{conversationId},data:{pendingActionId:row.id,pendingConfirmation:true,currentIntent:action.intent || action.taskType || 'PENDING_ACTION',currentAction:'CREATE'}});
  return row;
}

async function updatePendingAction(prisma, { conversationId, actionId, status, approvalId, taskId, error }) {
  const row=await prisma.aiPendingAgentAction.update({where:{id:actionId},data:{status,approvalId:approvalId || undefined,taskId:taskId || undefined,error:error || null}});
  const terminal=['COMPLETED','CANCELLED','REJECTED','EXPIRED'].includes(status);
  await prisma.aiConversationContext.updateMany({where:{conversationId},data:{pendingActionId:terminal?null:row.id,pendingApprovalId:approvalId || (terminal?null:undefined),pendingConfirmation:status==='AWAITING_CONFIRMATION'}});
  return row;
}

module.exports={ACTIVE_ACTION_STATUSES,classifyIntent,resolveFollowUp,loadConversationState,ensureConversationState,saveTurnState,createPendingAction,updatePendingAction,rememberEntity,customerRef,serialRef};
