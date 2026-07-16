const crypto = require('crypto');
const net = require('net');
const { tools: metadataTools } = require('./ai-tool.registry');
const { executeOperation } = require('./ai-operation-executor.service');
const { ServiceFactory } = require('../lib/clients/ServiceFactory');
const { SERVICE_CODES } = require('../lib/serviceConstants');
const { MikrotikClient } = require('./mikrotikClient');

const SECRET_KEYS = /secret|password|passwd|pwd|token|api.?key|credential/i;
const jsonSafe = value => JSON.parse(JSON.stringify(value ?? null));
const mask = value => {
  if (Array.isArray(value)) return value.map(mask);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '••••••••' : mask(item)]));
};

class ToolExecutionError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

class ExecutableToolRegistry {
  constructor() { this.tools = new Map(); }
  registerTool(definition) {
    if (!definition?.name || typeof definition.execute !== 'function') throw new Error('Executable tools require name and execute().');
    this.tools.set(definition.name, Object.freeze({ retryPolicy:{ maxAttempts:1 }, idempotencyRequired:false, ...definition }));
    return this.tools.get(definition.name);
  }
  getTool(name) { return this.tools.get(name) || null; }
  listTools() { return [...this.tools.values()]; }
  listAuthorizedTools({ userPermissions = [], agentToolKeys = [] }) {
    return this.listTools().filter(tool => agentToolKeys.includes(tool.name) && (tool.requiredPermissions || []).every(permission => userPermissions.includes(permission)));
  }
  validateInput(tool, input = {}) {
    const schema = tool.inputSchema || { type:'object' };
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolExecutionError('INVALID_INPUT', `${tool.displayName || tool.name} requires an object input.`);
    for (const key of schema.required || []) if (input[key] === undefined || input[key] === null || input[key] === '') throw new ToolExecutionError('MISSING_ARGUMENT', `${key} is required.`);
    for (const [key, rule] of Object.entries(schema.properties || {})) {
      if (input[key] === undefined || input[key] === null) continue;
      if (rule.type === 'string' && typeof input[key] !== 'string') throw new ToolExecutionError('INVALID_ARGUMENT', `${key} must be a string.`);
      if (rule.format === 'ipv4' && net.isIP(String(input[key])) !== 4) throw new ToolExecutionError('INVALID_IP', `${key} must be a valid IPv4 address.`);
    }
    return input;
  }
  authorize(tool, context) {
    const userPermissions = context.user?.permissions || [];
    const agentToolKeys = context.agentToolKeys || [];
    if (!agentToolKeys.includes(tool.name)) throw new ToolExecutionError('AGENT_TOOL_DENIED', `${tool.displayName || tool.name} is not enabled for this specialist.`, 403);
    const missing = (tool.requiredPermissions || []).filter(permission => !userPermissions.includes(permission));
    if (missing.length) throw new ToolExecutionError('USER_PERMISSION_DENIED', `The signed-in user lacks permission: ${missing.join(', ')}.`, 403);
    if (!context.ispId || Number(context.ispId) !== Number(context.tenantId || context.ispId)) throw new ToolExecutionError('TENANT_DENIED', 'Tenant context is invalid.', 403);
    return true;
  }
  async execute(name, input, context) {
    const tool = this.getTool(name);
    if (!tool) throw new ToolExecutionError('UNKNOWN_TOOL', `Tool ${name} is not registered.`, 404);
    this.authorize(tool, context);
    this.validateInput(tool, input);
    if (tool.requiresApproval && !context.approved) return { status:'AWAITING_APPROVAL', approvalRequired:true, toolName:name, riskLevel:tool.riskLevel, input:mask(input) };
    const idempotencyKey = context.idempotencyKey || crypto.createHash('sha256').update(`${context.ispId}:${context.conversationId}:${name}:${JSON.stringify(mask(input))}`).digest('hex');
    if (tool.idempotencyRequired && context.prisma?.aiToolExecution) {
      const prior = await context.prisma.aiToolExecution.findUnique({ where:{ ispId_idempotencyKey:{ ispId:context.ispId, idempotencyKey } } }).catch(()=>null);
      if (prior?.status === 'COMPLETED') return { ...prior.result, idempotentReplay:true, executionId:prior.id };
      if (prior?.status === 'EXECUTING') throw new ToolExecutionError('DUPLICATE_EXECUTION', 'This operation is already executing.', 409);
    }
    const started = Date.now();
    let execution = null;
    if (context.prisma?.aiToolExecution) execution = await context.prisma.aiToolExecution.upsert({
      where:{ ispId_idempotencyKey:{ ispId:context.ispId,idempotencyKey } },
      update:{ status:'EXECUTING',startedAt:new Date(),errorCode:null,errorMessage:null },
      create:{ ispId:context.ispId,conversationId:context.conversationId,agentId:context.agent.id,userId:context.user.id,pendingActionId:context.pendingActionId||null,toolName:name,idempotencyKey,requestId:context.requestId||null,status:'EXECUTING',inputMasked:mask(input),startedAt:new Date() }
    });
    try {
      const timeoutMs = tool.timeoutMs || 15000;
      let timeout;
      const timeoutPromise = new Promise((_,reject)=>{ timeout=setTimeout(()=>reject(new ToolExecutionError('TOOL_TIMEOUT', `${tool.displayName || name} timed out.`)),timeoutMs); });
      let result;
      try { result = await Promise.race([tool.execute({ ...context, input }),timeoutPromise]); }
      finally { clearTimeout(timeout); }
      const safeResult = jsonSafe(result);
      if (execution) await context.prisma.aiToolExecution.update({ where:{id:execution.id},data:{status:'COMPLETED',result:safeResult,durationMs:Date.now()-started,completedAt:new Date()} });
      return { ...safeResult, status:'COMPLETED', executionId:execution?.id || null, durationMs:Date.now()-started };
    } catch (error) {
      if (execution) await context.prisma.aiToolExecution.update({ where:{id:execution.id},data:{status:'FAILED',errorCode:error.code||'TOOL_ERROR',errorMessage:String(error.message||error),durationMs:Date.now()-started,completedAt:new Date()} }).catch(()=>null);
      throw error;
    }
  }
  healthCheck() { return { healthy:true, registered:this.tools.size, executable:this.listTools().filter(tool=>typeof tool.execute==='function').length }; }
  toModelTools(tools) { return tools.map(tool => ({ name:tool.name,description:tool.description,inputSchema:tool.inputSchema })); }
}

const registry = new ExecutableToolRegistry();
const meta = name => metadataTools.find(item => item.name === name) || {};
const register = definition => registry.registerTool({ ...meta(definition.name),displayName:definition.displayName || definition.name,category:definition.category || 'OPERATIONS',...definition });

const legacyHandler = name => async context => {
  const operation = await executeOperation({ prisma:context.prisma,ispId:context.ispId,user:context.user,message:context.resolvedMessage || context.message,contextMessage:context.contextMessage || '' });
  if (!operation) throw new ToolExecutionError('NO_RESULT', `${name} did not return a verified result.`);
  return { operation:operation.operation,performed:operation.performed || [name],data:operation.data || null,error:operation.error || null };
};

for (const name of ['getCustomer','searchCustomers','getTicket','getInvoice','getInvoiceSummary','listInvoices','getServiceSummary','listServices','getNasSummary','resyncNas','getSplitterDetails','getTicketSummary','getLeadSummary','getCustomerSummary','getTR069DeviceStatus','getOLTStatus']) {
  register({ name,execute:legacyHandler(name) });
}

register({
  name:'createNas',displayName:'Create NAS',category:'NAS',riskLevel:'HIGH',requiresApproval:true,idempotencyRequired:true,timeoutMs:30000,
  inputSchema:{type:'object',additionalProperties:false,required:['nasIp','secret'],properties:{nasIp:{type:'string',format:'ipv4'},shortname:{type:'string'},secret:{type:'string'},server:{type:'string',format:'ipv4'},description:{type:'string'}}},
  async execute({ prisma,ispId,user,agent,input }) {
    const existing = await prisma.nas.findFirst({where:{ispId,nasname:input.nasIp,isDeleted:false}});
    if (existing) throw new ToolExecutionError('NAS_EXISTS', `NAS ${input.nasIp} already exists as NAS #${existing.id}.`,409);
    let nas;
    try {
      nas = await prisma.nas.create({data:{nasname:input.nasIp,shortname:input.shortname || `nas-${input.nasIp.replace(/\./g,'-')}`,type:'other',secret:input.secret,server:input.server || null,description:input.description || `Created by ${agent.name}`,isActive:true,isDeleted:false,ispId,branchId:user.selectedBranchId || user.branchId || null}});
      const radius = await ServiceFactory.getClient(SERVICE_CODES.RADIUS,ispId);
      const radiusNas = await radius.createNas({nasname:nas.nasname,shortname:nas.shortname,type:nas.type,secret:input.secret,server:nas.server,description:nas.description});
      if (!radiusNas?.id) throw new ToolExecutionError('RADIUS_SYNC_FAILED','Radius did not return a verified NAS ID.');
      nas = await prisma.nas.update({where:{id:nas.id},data:{radiusNasId:Number(radiusNas.id)}});
      return { verified:true,nas:{id:nas.id,ipAddress:nas.nasname,shortname:nas.shortname,status:nas.isActive?'ACTIVE':'INACTIVE'},radius:{synchronized:true,nasId:Number(radiusNas.id)} };
    } catch (error) {
      if (nas?.id && !nas.radiusNasId) await prisma.nas.delete({where:{id:nas.id}}).catch(()=>null);
      throw error;
    }
  }
});

register({
  name:'updateNas',displayName:'Update NAS',category:'NAS',riskLevel:'HIGH',requiresApproval:true,idempotencyRequired:true,timeoutMs:30000,
  inputSchema:{type:'object',additionalProperties:false,required:['nasIp'],properties:{nasIp:{type:'string',format:'ipv4'},shortname:{type:'string'},secret:{type:'string'},server:{type:'string',format:'ipv4'},description:{type:'string'}}},
  async execute({prisma,ispId,input}){
    const existing=await prisma.nas.findFirst({where:{ispId,nasname:input.nasIp,isDeleted:false}});if(!existing)throw new ToolExecutionError('NAS_NOT_FOUND',`NAS ${input.nasIp} does not exist.`,404);
    const nas=await prisma.nas.update({where:{id:existing.id},data:{...(input.shortname?{shortname:input.shortname}:{}),...(input.secret?{secret:input.secret}:{}),...(input.server?{server:input.server}:{}),...(input.description?{description:input.description}:{})}});
    const radius=await ServiceFactory.getClient(SERVICE_CODES.RADIUS,ispId),payload={nasname:nas.nasname,shortname:nas.shortname,type:nas.type,ports:nas.ports,secret:nas.secret,server:nas.server,community:nas.community,description:nas.description};
    const radiusNas=nas.radiusNasId?await radius.updateNas(nas.radiusNasId,payload):await radius.createNas(payload);
    if(!nas.radiusNasId&&radiusNas?.id)await prisma.nas.update({where:{id:nas.id},data:{radiusNasId:Number(radiusNas.id)}});
    return{verified:true,nas:{id:nas.id,ipAddress:nas.nasname,shortname:nas.shortname,status:nas.isActive?'ACTIVE':'INACTIVE'},radius:{synchronized:true,nasId:Number(radiusNas?.id||nas.radiusNasId)}};
  }
});

register({
  name:'configureMikrotikRadius',displayName:'Configure MikroTik Radius',category:'NETWORK',riskLevel:'HIGH',requiresApproval:true,idempotencyRequired:true,timeoutMs:30000,
  inputSchema:{type:'object',additionalProperties:false,required:['routerIp','radiusServerIp','routerCredentialRef','nasSecretRef'],properties:{routerIp:{type:'string',format:'ipv4'},radiusServerIp:{type:'string',format:'ipv4'},routerCredentialRef:{type:'string'},nasSecretRef:{type:'string'}}},
  async execute(context) {
    if (typeof context.resolveCredentialRef !== 'function') throw new ToolExecutionError('VAULT_UNAVAILABLE','The credential vault resolver is not configured.');
    const routerCredential = await context.resolveCredentialRef(context.input.routerCredentialRef);
    const nasSecret = await context.resolveCredentialRef(context.input.nasSecretRef);
    if (!routerCredential?.username || !routerCredential?.password || !nasSecret?.secret) throw new ToolExecutionError('CREDENTIAL_REF_INVALID','One or more credential references could not be resolved.');
    const client = new MikrotikClient({host:context.input.routerIp,port:8728,user:routerCredential.username,password:routerCredential.password});
    const connection = await client.testConnection();
    if (!connection.connected) throw new ToolExecutionError('ROUTER_CONNECTION_FAILED',connection.message || 'MikroTik connection failed.');
    const current = await client.executeCustomCommand('/radius','print');
    const found = (current || []).find(item=>String(item.address||'')===context.input.radiusServerIp);
    const params={service:'ppp,login',address:context.input.radiusServerIp,secret:nasSecret.secret,'authentication-port':1812,'accounting-port':1813,comment:`Kashtrix approval ${context.approvalId||''}`.trim()};
    if(found?.['.id'])await client.executeCustomCommand('/radius','set',{'.id':found['.id'],...params});else await client.executeCustomCommand('/radius','add',params);
    const verified=(await client.executeCustomCommand('/radius','print')||[]).some(item=>String(item.address||'')===context.input.radiusServerIp);
    if(!verified)throw new ToolExecutionError('ROUTER_VERIFY_FAILED','MikroTik did not return the configured Radius server.');
    return {verified:true,routerIp:context.input.routerIp,radiusServerIp:context.input.radiusServerIp,configured:true};
  }
});

module.exports = { ExecutableToolRegistry,ToolExecutionError,registry,registerTool:definition=>registry.registerTool(definition),mask };
